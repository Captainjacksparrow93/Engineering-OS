import { describe, it, expect, vi, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { prisma } from '@/core/db/prisma';
import { loadPrincipal } from '@/core/rbac/principal';
import { DomainError } from '@/core/rbac/errors';
import { erpGet, erpList, isErpEnabled } from './client';
import { syncOrderChanges } from './sync';
import {
  createAutomationProject,
  getPMTeamData,
} from '@/modules/project-management/services/automation-project.service';
import { getProjectWorkspace, listProjects } from '@/modules/project-management/services/project.service';
import type { Principal } from '@/core/rbac/types';

vi.mock('@/modules/erp/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/modules/erp/client')>();
  return { ...actual, isErpEnabled: vi.fn(() => false), erpGet: vi.fn(), erpList: vi.fn(), erpUpdate: vi.fn() };
});

const iso = (days: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

type Row = { name: string; idx: number; item_code: string; qty: number; delivery_date: string };
type Order = {
  name: string;
  docstatus: number;
  status: string;
  modified: string;
  customer: string;
  po_no: string | null;
  custom_wo_number: string;
  delivery_date: string;
  items: Row[];
};

describe('Plan 015 step 3: order changes flow into PM safely', () => {
  const run = `${Date.now()}`.slice(-6);
  let director: Principal;
  let pmId: string;
  let directorIds: string[];
  let client: { id: string; name: string; refNumber: string };
  let projectId: string;
  let woSeq = 0;
  let order: Order;
  let customer: { name: string; customer_name: string; custom_acs_reference: string };
  const projectIds: string[] = [];

  function installFakeErp() {
    vi.mocked(isErpEnabled).mockReturnValue(true);
    vi.mocked(erpList).mockImplementation(async (doctype, options = {}) => {
      if (doctype !== 'Sales Order') throw new Error(`unexpected list ${doctype}`);
      const filters = (options.filters ?? []) as Array<[string, string, string, unknown]>;
      const after = filters.find(([, f, op]) => f === 'modified' && op === '>')?.[3] as string | undefined;
      const named = filters.find(([, f]) => f === 'name')?.[3];
      if (named !== undefined && named !== order.name) return [];
      return after === undefined || order.modified > after ? ([{ name: order.name, modified: order.modified }] as never) : [];
    });
    vi.mocked(erpGet).mockImplementation(async (doctype, name) => {
      if (doctype === 'Sales Order' && name === order.name) return structuredClone(order) as never;
      if (doctype === 'Customer' && name === customer.name) return structuredClone(customer) as never;
      throw new Error(`unexpected get ${doctype} ${name}`);
    });
  }

  /** Changes the order in "ERPNext": bumps `modified` like ERPNext does on every save. */
  let tick = 0;
  function change(edit: (o: Order) => void) {
    edit(order);
    order.modified = `2026-10-02 14:00:${String(++tick).padStart(2, '0')}.000000`;
  }

  const panels = () =>
    prisma.task.findMany({ where: { projectId, type: 'PHASE' }, orderBy: { code: 'asc' }, include: { _count: { select: { children: true } } } });
  const reload = () => prisma.project.findUniqueOrThrow({ where: { id: projectId } });

  beforeAll(async () => {
    const acs = await prisma.company.findFirstOrThrow({ where: { code: 'ACS' } });
    const directors = await prisma.user.findMany({
      where: { companyId: acs.id, status: 'ACTIVE', roleAssignments: { some: { role: { key: 'DIRECTOR' } } } },
    });
    directorIds = directors.map((d) => d.id);
    director = (await loadPrincipal(directors[0]!.id))!;
    pmId = (await getPMTeamData(director.companyId)).managers[0]!.id;
    client = await prisma.client.create({
      data: { companyId: director.companyId, name: `Sync Client ${run}`, refNumber: `ACS-S3-${run}`, erpCustomer: `Sync Customer ${run}` },
    });
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(isErpEnabled).mockReturnValue(false);
    const project = await createAutomationProject(director, {
      kind: 'WORK_ORDER',
      workOrderNo: `9${run}${++woSeq}`,
      clientId: client.id,
      clientName: client.name,
      managerId: pmId,
      targetEndDate: iso(150),
      scopes: [{ templateCode: 'PLC', quantity: 2 }, { templateCode: 'SCADA', quantity: 1 }],
      panelDeliveryDates: { PLC_1: iso(120), PLC_2: iso(120), SCADA_1: iso(150) },
    });
    projectId = project.id;
    projectIds.push(project.id);
    order = {
      name: `SO-SYNC-${run}-${woSeq}`,
      docstatus: 1,
      status: 'To Deliver and Bill',
      modified: '2026-10-02 14:00:00.000000',
      customer: `Sync Customer ${run}`,
      po_no: null,
      custom_wo_number: project.workOrderNo!,
      delivery_date: iso(150),
      items: [
        { name: `rowA${woSeq}`, idx: 1, item_code: 'PLC', qty: 2, delivery_date: iso(120) },
        { name: `rowB${woSeq}`, idx: 2, item_code: 'SCADA', qty: 1, delivery_date: iso(150) },
      ],
    };
    customer = { name: order.customer, customer_name: client.name, custom_acs_reference: client.refNumber };
    await prisma.project.update({ where: { id: projectId }, data: { erpSalesOrder: order.name, erpOrderModified: order.modified } });
    const [p1, p2, s1] = await panels();
    await prisma.task.update({ where: { id: p1!.id }, data: { erpOrderItem: `rowA${woSeq}#1` } });
    await prisma.task.update({ where: { id: p2!.id }, data: { erpOrderItem: `rowA${woSeq}#2` } });
    await prisma.task.update({ where: { id: s1!.id }, data: { erpOrderItem: `rowB${woSeq}#1` } });
    installFakeErp();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(async () => {
    for (const id of projectIds) {
      await prisma.notification.deleteMany({ where: { link: { contains: id } } });
      await prisma.taskDependency.deleteMany({ where: { predecessor: { projectId: id } } });
      await prisma.taskAssignment.deleteMany({ where: { task: { projectId: id } } });
      await prisma.task.deleteMany({ where: { projectId: id, parentId: { not: null } } });
      await prisma.task.deleteMany({ where: { projectId: id } });
      await prisma.projectMember.deleteMany({ where: { projectId: id } });
      await prisma.roleAssignment.deleteMany({ where: { scopeType: 'PROJECT', scopeId: id } });
      await prisma.project.delete({ where: { id } });
    }
    await prisma.client.deleteMany({ where: { companyId: director.companyId, refNumber: { startsWith: 'ACS-S3' } } });
  });

  it('ERP off: no ERP call, the page data is returned', async () => {
    vi.mocked(isErpEnabled).mockReturnValue(false);
    const ws = await getProjectWorkspace(director, projectId);
    expect(ws.project.id).toBe(projectId);
    expect(erpList).not.toHaveBeenCalled();
    expect(erpGet).not.toHaveBeenCalled();
  });

  it('no change in ERP: nothing is written', async () => {
    const before = await reload();
    const result = await syncOrderChanges(director.companyId, { projectId });
    expect(result.synced).toBe(0);
    expect(erpGet).not.toHaveBeenCalled();
    const after = await reload();
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    expect(await prisma.auditLog.count({ where: { entityId: projectId, module: 'erp' } })).toBe(0);
  });

  it('client PO, order date and row dates follow ERP, without an alert; audited with ERP as the source', async () => {
    change((o) => {
      o.po_no = 'PO-NEW-1';
      o.delivery_date = iso(160);
      o.items[0]!.delivery_date = iso(130);
    });
    await syncOrderChanges(director.companyId, { projectId });

    const p = await reload();
    expect(p.clientPoNumber).toBe('PO-NEW-1');
    expect(p.targetEndDate?.toISOString().slice(0, 10)).toBe(iso(160));
    expect(p.erpOrderModified).toBe(order.modified);
    expect(p.erpOrderAlert).toBeNull();
    const [p1, p2, s1] = await panels();
    expect([p1, p2, s1].map((t) => t!.plannedEnd?.toISOString().slice(0, 10))).toEqual([iso(130), iso(130), iso(150)]);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { entityId: projectId, module: 'erp', action: 'order_synced' } });
    expect(log.actorId).toBeNull();
    expect(log.diff).toMatchObject({ clientPoNumber: { from: null, to: 'PO-NEW-1' } });
  });

  it('WO follows ERP; a WO used by another project alerts instead', async () => {
    change((o) => (o.custom_wo_number = `8${run}1`));
    await syncOrderChanges(director.companyId, { projectId });
    expect((await reload()).workOrderNo).toBe(`8${run}1`);

    const other = await prisma.project.findFirstOrThrow({ where: { id: projectIds[0] } });
    change((o) => (o.custom_wo_number = other.workOrderNo!));
    await syncOrderChanges(director.companyId, { projectId });
    const p = await reload();
    expect(p.workOrderNo).toBe(`8${run}1`);
    expect(p.erpOrderAlert).toContain(`already uses WO ${other.workOrderNo}`);
  });

  it('a renamed customer renames our client (and its projects); a name clash alerts instead', async () => {
    const renamed = `Sync Client Renamed ${run}`;
    customer.customer_name = renamed;
    change(() => {});
    await syncOrderChanges(director.companyId, { projectId });
    expect((await prisma.client.findUniqueOrThrow({ where: { id: client.id } })).name).toBe(renamed);
    expect((await reload()).clientName).toBe(renamed);

    const taken = await prisma.client.create({
      data: { companyId: director.companyId, name: `Sync Taken ${run}`, refNumber: `ACS-S3T-${run}` },
    });
    customer.customer_name = taken.name;
    change(() => {});
    await syncOrderChanges(director.companyId, { projectId });
    expect((await prisma.client.findUniqueOrThrow({ where: { id: client.id } })).name).toBe(renamed);
    expect((await reload()).erpOrderAlert).toContain(`"${taken.name}"`);
    customer.customer_name = client.name; // restore for later tests
    await prisma.client.update({ where: { id: client.id }, data: { name: client.name } });
  });

  it('added panels are appended, assigned to the PM, linked to the row, and the Directors are alerted', async () => {
    change((o) => {
      o.items[0]!.qty = 3;
      o.items.push({ name: `rowC${woSeq}`, idx: 3, item_code: 'HMI', qty: 1, delivery_date: iso(140) });
    });
    await syncOrderChanges(director.companyId, { projectId });

    const all = await panels();
    expect(all.map((t) => [t.title, t.erpOrderItem])).toEqual([
      ['PLC Panel 1', `rowA${woSeq}#1`],
      ['PLC Panel 2', `rowA${woSeq}#2`],
      ['SCADA Panel 1', `rowB${woSeq}#1`],
      ['PLC Panel 3', `rowA${woSeq}#3`],
      ['HMI Panel 1', `rowC${woSeq}#1`],
    ]);
    const added = all.slice(3);
    for (const panel of added) {
      expect(panel._count.children).toBeGreaterThan(0);
      const steps = await prisma.task.findMany({ where: { parentId: panel.id }, include: { assignments: true } });
      expect(steps.every((s) => s.assignments.some((a) => a.userId === pmId))).toBe(true);
    }
    expect(added[1]!.plannedEnd?.toISOString().slice(0, 10)).toBe(iso(140));
    const p = await reload();
    expect(p.automationTypes).toContain('HMI');
    expect(p.erpOrderAlert).toContain('PLC Panel 3, HMI Panel 1 added');
    expect(p.erpOrderAlertAt).not.toBeNull();
    const notes = await prisma.notification.findMany({ where: { link: `/pm/projects/${projectId}` } });
    expect(new Set(notes.map((n) => n.userId))).toEqual(new Set(directorIds));
  });

  it('a reduced quantity, a removed row and a cancelled order only alert; nothing is deleted', async () => {
    const countBefore = await prisma.task.count({ where: { projectId } });
    change((o) => {
      o.items[0]!.qty = 1;
      o.items.splice(1, 1);
    });
    await syncOrderChanges(director.companyId, { projectId });
    let p = await reload();
    expect(p.erpOrderAlert).toContain('PLC Panel 2 was kept');
    expect(p.erpOrderAlert).toContain('SCADA Panel 1 was kept');

    change((o) => {
      o.docstatus = 2;
      o.status = 'Cancelled';
    });
    await syncOrderChanges(director.companyId, { projectId });
    p = await reload();
    expect(p.erpOrderAlert).toContain('Order cancelled in ERP');
    expect(await prisma.task.count({ where: { projectId } })).toBe(countBefore);
    expect(p.status).not.toBe('CANCELLED');
  });

  it('syncing the same change twice adds no duplicate panels or alerts', async () => {
    change((o) => (o.items[1]!.qty = 2));
    await syncOrderChanges(director.companyId, { projectId });
    await syncOrderChanges(director.companyId, { projectId });
    expect((await panels()).filter((t) => t.title.startsWith('SCADA'))).toHaveLength(2);
    const alert = (await reload()).erpOrderAlert ?? '';
    expect(alert.split('\n')).toHaveLength(1);
    expect(await prisma.notification.count({ where: { link: `/pm/projects/${projectId}` } })).toBe(directorIds.length);
  });

  it('a standing condition (order still closed) is not alerted again on a later change', async () => {
    change((o) => (o.status = 'Closed'));
    await syncOrderChanges(director.companyId, { projectId });
    change((o) => (o.po_no = 'PO-AFTER-CLOSE'));
    await syncOrderChanges(director.companyId, { projectId });
    const p = await reload();
    expect(p.clientPoNumber).toBe('PO-AFTER-CLOSE');
    expect(p.erpOrderAlert).toBe('Order closed in ERP while the project is still open.');
    expect(await prisma.notification.count({ where: { link: `/pm/projects/${projectId}` } })).toBe(directorIds.length);
  });

  it('ERP down: the project page still loads', async () => {
    vi.mocked(erpList).mockRejectedValue(new DomainError("ERP isn't responding. Try again in a minute."));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const ws = await getProjectWorkspace(director, projectId);
    expect(ws.project.id).toBe(projectId);
  });

  it('the project page syncs its order; the projects list syncs all, at most once per 5 minutes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-01-01T10:00:00Z')); // past any earlier ERP-down backoff
    change((o) => (o.po_no = 'PO-PAGE'));
    const ws = await getProjectWorkspace(director, projectId);
    expect(ws.project.clientPoNumber).toBe('PO-PAGE');

    change((o) => (o.po_no = 'PO-LIST'));
    await listProjects(director);
    expect((await reload()).clientPoNumber).toBe('PO-LIST');

    change((o) => (o.po_no = 'PO-THROTTLED'));
    vi.setSystemTime(new Date('2030-01-01T10:04:00Z'));
    await listProjects(director);
    expect((await reload()).clientPoNumber).toBe('PO-LIST');
    vi.setSystemTime(new Date('2030-01-01T10:06:00Z'));
    await listProjects(director);
    expect((await reload()).clientPoNumber).toBe('PO-THROTTLED');
  });
});
