import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { prisma } from '@/core/db/prisma';
import { erpCall, erpGet, erpInsert, erpList, erpUpdate } from './client';
import { runBackfill } from './backfill';
import { projectLink } from './order.service';

vi.mock('@/modules/erp/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/modules/erp/client')>();
  return { ...actual, erpGet: vi.fn(), erpList: vi.fn(), erpInsert: vi.fn(), erpUpdate: vi.fn(), erpCall: vi.fn() };
});

type Doc = Record<string, unknown> & { name: string };
type Filter = [string, string, string, unknown];

/** A tiny in-memory ERPNext: just enough of Customer, Sales Order and Company for the backfill. */
const erp = { Customer: new Map<string, Doc>(), 'Sales Order': new Map<string, Doc>(), Company: new Map<string, Doc>() };
let orderSeq = 0;
let rowSeq = 0;

function table(doctype: string) {
  const t = erp[doctype as keyof typeof erp];
  if (!t) throw new Error(`fake ERP has no ${doctype}`);
  return t;
}

function installFakeErp() {
  vi.mocked(erpList).mockImplementation(async (doctype, options = {}) => {
    const filters = (options.filters ?? []) as Filter[];
    const rows = [...table(doctype).values()].filter((row) =>
      filters.every(([, field, op, value]) => {
        const v = row[field];
        if (op === '=') return v === value;
        if (op === '!=') return v !== value;
        throw new Error(`fake ERP: unsupported op ${op}`);
      }),
    );
    return rows.slice(0, options.limit ? options.limit : undefined) as never;
  });
  vi.mocked(erpGet).mockImplementation(async (doctype, name) => structuredClone(table(doctype).get(name)) as never);
  vi.mocked(erpInsert).mockImplementation(async (doctype, doc) => {
    let created: Doc;
    if (doctype === 'Customer') {
      created = { ...doc, name: String(doc.customer_name) };
    } else {
      const items = (doc.items as Array<Record<string, unknown>>).map((item, i) => ({
        ...item,
        name: `row${++rowSeq}`,
        idx: i + 1,
      }));
      created = { ...doc, items, name: `SAL-ORD-T-${++orderSeq}`, docstatus: 0, status: 'Draft', modified: `2026-10-02 12:00:0${orderSeq}` };
    }
    table(doctype).set(created.name, created);
    return structuredClone(created) as never;
  });
  vi.mocked(erpUpdate).mockImplementation(async (doctype, name, fields) => {
    const row = table(doctype).get(name)!;
    Object.assign(row, fields);
    if (doctype === 'Sales Order' && fields.docstatus === 1) row.status = 'To Deliver and Bill';
    return structuredClone(row) as never;
  });
  vi.mocked(erpCall).mockImplementation(async (method, args = {}) => {
    if (!method.endsWith('sales_order.update_status')) throw new Error(`fake ERP: ${method}`);
    erp['Sales Order'].get(String(args.name))!.status = args.status;
    return undefined as never;
  });
}

describe('Plan 015 step 2: backfill clients and work orders into ERPNext', () => {
  const run = `${Date.now()}`.slice(-6);
  let companyId: string;
  let userId: string;
  const ids: Record<string, string> = {};
  const lines: string[] = [];
  const log = (l: string) => lines.push(l);

  async function client(key: string, name: string) {
    const c = await prisma.client.create({ data: { companyId, name: `${name} ${run}`, refNumber: `ACS-${key}-${run}` } });
    ids[key] = c.id;
    return c;
  }

  async function project(
    key: string,
    opts: { wo?: string; clientKey?: string; status?: 'PLANNING' | 'COMPLETED' | 'CANCELLED'; kind?: 'WORK_ORDER' | 'SERVICE_CALL'; panels?: Array<[string, string]> },
  ) {
    const p = await prisma.project.create({
      data: {
        companyId,
        code: `BF-${key}-${run}`,
        name: key,
        kind: opts.kind ?? 'WORK_ORDER',
        workOrderNo: opts.wo ?? null,
        clientId: opts.clientKey ? ids[opts.clientKey] : null,
        clientName: 'n/a',
        status: opts.status ?? 'PLANNING',
        managerId: userId,
        targetEndDate: new Date('2027-03-31T00:00:00Z'),
        createdAt: new Date('2026-06-15T09:00:00Z'),
      },
    });
    ids[key] = p.id;
    for (const [i, [title, date]] of (opts.panels ?? []).entries()) {
      await prisma.task.create({
        data: {
          projectId: p.id,
          code: `${p.code}-PH${i + 1}`,
          title,
          type: 'PHASE',
          createdById: userId,
          plannedEnd: new Date(`${date}T00:00:00Z`),
        },
      });
    }
    return p;
  }

  beforeAll(async () => {
    userId = (await prisma.user.findFirstOrThrow({ where: { status: 'ACTIVE' } })).id;
    companyId = (await prisma.company.create({ data: { name: `Backfill Co ${run}`, code: `BF${run}` } })).id;
    await client('A', 'Alpha'); // ERP already has a customer with its ACS reference
    await client('B', 'Beta'); // ERP has a customer with its name, no reference
    await client('C', 'Gamma'); // nothing in ERP: create
    await client('D', 'Delta'); // ERP has its name with another reference: skip
    await project('P1', { wo: `81${run}`, clientKey: 'C', panels: [['PLC Panel 1', '2027-01-10'], ['PLC Panel 2', '2027-01-10'], ['SCADA Panel 1', '2027-02-01']] });
    await project('P2', { wo: `82${run}`, clientKey: 'A', status: 'COMPLETED', panels: [['PLC Panel 1', '2027-01-10'], ['PLC Panel 2', '2027-02-20']] });
    await project('P3', { clientKey: 'A', panels: [['PLC Panel 1', '2027-01-10']] });
    await project('P4', { wo: `84${run}`, clientKey: 'A' });
    await project('P5', { wo: `85${run}`, clientKey: 'A', status: 'CANCELLED', panels: [['PLC Panel 1', '2027-01-10']] });
    await project('P6', { kind: 'SERVICE_CALL', clientKey: 'A' });
    await project('P7', { wo: `87${run}`, clientKey: 'D', panels: [['HMI Panel 1', '2027-01-10']] });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    installFakeErp();
    lines.length = 0;
  });

  afterAll(async () => {
    await prisma.task.deleteMany({ where: { project: { companyId } } });
    await prisma.project.deleteMany({ where: { companyId } });
    await prisma.client.deleteMany({ where: { companyId } });
    await prisma.company.delete({ where: { id: companyId } });
  });

  function seedErp() {
    erp.Customer.clear();
    erp['Sales Order'].clear();
    erp.Company.set('ACS Engitech', { name: 'ACS Engitech' });
    erp.Customer.set('Alpha Industries', { name: 'Alpha Industries', customer_name: 'Alpha Industries', custom_acs_reference: `ACS-A-${run}` });
    erp.Customer.set(`Beta ${run}`, { name: `Beta ${run}`, customer_name: `Beta ${run}`, custom_acs_reference: '' });
    erp.Customer.set(`Delta ${run}`, { name: `Delta ${run}`, customer_name: `Delta ${run}`, custom_acs_reference: 'ACS-0999' });
  }

  it('dry run: reports what it would do and writes nothing', async () => {
    seedErp();
    const report = await runBackfill({ companyId, apply: false, log });

    expect(report.clients).toEqual({ created: 1, linked: 2, skipped: 1, failed: 0 });
    expect(report.projects).toEqual({ created: 2, linked: 0, skipped: 3, failed: 0 });
    expect(erpInsert).not.toHaveBeenCalled();
    expect(erpUpdate).not.toHaveBeenCalled();
    expect(erpCall).not.toHaveBeenCalled();
    expect(await prisma.client.count({ where: { companyId, erpCustomer: { not: null } } })).toBe(0);
    expect(await prisma.project.count({ where: { companyId, erpSalesOrder: { not: null } } })).toBe(0);
    expect(lines).toContain(`project BF-P3-${run}: skipped: no WO number`);
    expect(lines).toContain(`project BF-P4-${run} (WO 84${run}): skipped: no panels`);
    expect(lines.some((l) => l.startsWith(`client ACS-D-${run}`) && l.includes('skipped: customer'))).toBe(true);
    expect(lines.some((l) => l.includes('BF-P5') || l.includes('BF-P6'))).toBe(false);
  });

  it('--apply: links or creates customers, creates submitted imported orders, closes finished ones, links PM', async () => {
    seedErp();
    const report = await runBackfill({ companyId, apply: true, log });

    expect(report.clients).toEqual({ created: 1, linked: 2, skipped: 1, failed: 0 });
    expect(report.projects).toEqual({ created: 2, linked: 0, skipped: 3, failed: 0 });

    const clients = await prisma.client.findMany({ where: { companyId }, orderBy: { refNumber: 'asc' } });
    expect(clients.map((c) => c.erpCustomer)).toEqual(['Alpha Industries', `Beta ${run}`, `Gamma ${run}`, null]);
    expect(erp.Customer.get(`Beta ${run}`)!.custom_acs_reference).toBe(`ACS-B-${run}`);
    expect(erp.Customer.get(`Gamma ${run}`)!.custom_acs_reference).toBe(`ACS-C-${run}`);

    const p1 = await prisma.project.findUniqueOrThrow({ where: { id: ids.P1 } });
    const o1 = erp['Sales Order'].get(p1.erpSalesOrder!)!;
    expect(o1).toMatchObject({
      customer: `Gamma ${run}`,
      custom_wo_number: `81${run}`,
      custom_imported: 1,
      custom_project_code: `BF-P1-${run}`,
      custom_project_link: projectLink(ids.P1!),
      transaction_date: '2026-06-15',
      delivery_date: '2027-03-31',
      docstatus: 1,
      status: 'To Deliver and Bill',
    });
    const o1Items = o1.items as Array<{ name: string; item_code: string; qty: number; delivery_date: string }>;
    expect(o1Items.map((i) => [i.item_code, i.qty, i.delivery_date])).toEqual([
      ['PLC', 2, '2027-01-10'],
      ['SCADA', 1, '2027-02-01'],
    ]);
    expect(p1.erpOrderModified).toBe(o1.modified);
    const p1Panels = await prisma.task.findMany({ where: { projectId: ids.P1, type: 'PHASE' }, orderBy: { code: 'asc' } });
    expect(p1Panels.map((t) => t.erpOrderItem)).toEqual([`${o1Items[0]!.name}#1`, `${o1Items[0]!.name}#2`, `${o1Items[1]!.name}#1`]);

    // Same type, different dates: one row per panel. Finished project: order closed.
    const p2 = await prisma.project.findUniqueOrThrow({ where: { id: ids.P2 } });
    const o2 = erp['Sales Order'].get(p2.erpSalesOrder!)!;
    expect((o2.items as Array<{ qty: number; delivery_date: string }>).map((i) => [i.qty, i.delivery_date])).toEqual([
      [1, '2027-01-10'],
      [1, '2027-02-20'],
    ]);
    expect(o2.status).toBe('Closed');
    expect(o1.status).not.toBe('Closed');

    // PM work untouched: status and code unchanged; cancelled and service-call projects untouched.
    expect(p2.status).toBe('COMPLETED');
    for (const key of ['P3', 'P4', 'P5', 'P6', 'P7']) {
      expect((await prisma.project.findUniqueOrThrow({ where: { id: ids[key] } })).erpSalesOrder).toBeNull();
    }
  });

  it('a second --apply creates nothing', async () => {
    const report = await runBackfill({ companyId, apply: true, log });
    expect(report.clients.created + report.clients.linked).toBe(0);
    expect(report.projects.created + report.projects.linked).toBe(0);
    expect(erpInsert).not.toHaveBeenCalled();
  });

  it('resumes after a crash: an order already in ERP for the project is submitted and linked, not duplicated', async () => {
    const p8 = await project('P8', { wo: `88${run}`, clientKey: 'B', panels: [['HMI Panel 1', '2027-01-15']] });
    // The crashed run had created (not submitted) this order before stopping.
    erp['Sales Order'].set('SAL-ORD-CRASH', {
      name: 'SAL-ORD-CRASH',
      docstatus: 0,
      status: 'Draft',
      custom_project_link: projectLink(p8.id),
      modified: '2026-10-02 13:00:00',
      items: [{ name: 'rowX', idx: 1, item_code: 'HMI', qty: 1 }],
    });

    const report = await runBackfill({ companyId, apply: true, log });

    expect(report.projects.linked).toBe(1);
    expect(report.projects.created).toBe(0);
    expect(erpInsert).not.toHaveBeenCalled();
    expect(erp['Sales Order'].get('SAL-ORD-CRASH')!.docstatus).toBe(1);
    const linked = await prisma.project.findUniqueOrThrow({ where: { id: p8.id } });
    expect(linked.erpSalesOrder).toBe('SAL-ORD-CRASH');
    const panel = await prisma.task.findFirstOrThrow({ where: { projectId: p8.id, type: 'PHASE' } });
    expect(panel.erpOrderItem).toBe('rowX#1');
  });
});
