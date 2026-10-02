import { prisma } from '@/core/db/prisma';
import { DomainError } from '@/core/rbac/errors';
import { erpCall, erpGet, erpInsert, erpList, erpUpdate } from './client';
import { projectLink } from './order.service';

/**
 * Plan 015: give every existing client an ERPNext customer and every existing work order a
 * submitted, imported sales order. Dry run unless `apply`. Re-running skips what's done.
 * Run by hand through `prisma/scripts/erp-backfill.ts`; never from entrypoint.sh.
 */

export interface BackfillCounts {
  created: number;
  linked: number;
  skipped: number;
  failed: number;
}

export interface BackfillReport {
  clients: BackfillCounts;
  projects: BackfillCounts;
}

interface ErpCustomerRow {
  name: string;
  custom_acs_reference?: string | null;
}

interface ErpOrderRow {
  name: string;
  docstatus: number;
  status?: string;
}

interface ErpOrderDoc extends ErpOrderRow {
  modified: string;
  items: Array<{ name: string; idx: number; item_code: string; qty: number }>;
}

interface PlannedRow {
  item_code: string;
  qty: number;
  delivery_date: string;
  panelTaskIds: string[];
}

const PANEL_TITLE = /^([A-Za-z0-9]+)\s+Panel\s+(\d+)$/i;
const FINISHED = new Set(['COMPLETED', 'CLOSED']);

const day = (d: Date) => d.toISOString().slice(0, 10);
const zero = (): BackfillCounts => ({ created: 0, linked: 0, skipped: 0, failed: 0 });
const reason = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** One row per panel type; one row per panel when panels of the same type have different dates. */
export function planOrderRows(
  panels: Array<{ id: string; title: string; plannedEnd: Date | null }>,
  targetEndDate: Date | null,
): PlannedRow[] {
  const byCode = new Map<string, Array<{ id: string; unit: number; date: string }>>();
  for (const panel of panels) {
    const match = panel.title.match(PANEL_TITLE);
    if (!match) continue;
    const code = match[1]!.toUpperCase();
    const date = panel.plannedEnd ?? targetEndDate;
    if (!date) continue;
    const list = byCode.get(code) ?? [];
    list.push({ id: panel.id, unit: Number(match[2]), date: day(date) });
    byCode.set(code, list);
  }
  const rows: PlannedRow[] = [];
  for (const [code, list] of byCode) {
    list.sort((a, b) => a.unit - b.unit);
    if (list.every((p) => p.date === list[0]!.date)) {
      rows.push({ item_code: code, qty: list.length, delivery_date: list[0]!.date, panelTaskIds: list.map((p) => p.id) });
    } else {
      for (const p of list) rows.push({ item_code: code, qty: 1, delivery_date: p.date, panelTaskIds: [p.id] });
    }
  }
  return rows;
}

async function findCustomer(field: 'custom_acs_reference' | 'customer_name', value: string) {
  const rows = await erpList<ErpCustomerRow>('Customer', {
    filters: [['Customer', field, '=', value]],
    fields: ['name', 'custom_acs_reference'],
    limit: 2,
  });
  return rows[0] ?? null;
}

export async function runBackfill({
  companyId,
  apply,
  log = console.log,
}: {
  companyId: string;
  apply: boolean;
  log?: (line: string) => void;
}): Promise<BackfillReport> {
  const report: BackfillReport = { clients: zero(), projects: zero() };
  const would = apply ? '' : 'would ';

  // 1. Clients → customers. In a dry run, remember the customer each client would get.
  const customerOf = new Map<string, string>();
  for (const c of await prisma.client.findMany({ where: { companyId }, orderBy: { refNumber: 'asc' } })) {
    if (c.erpCustomer) customerOf.set(c.id, c.erpCustomer);
  }
  const clients = await prisma.client.findMany({
    where: { companyId, erpCustomer: null },
    orderBy: { refNumber: 'asc' },
  });
  for (const client of clients) {
    const label = `client ${client.refNumber} "${client.name}"`;
    try {
      let customer = await findCustomer('custom_acs_reference', client.refNumber);
      let how = 'linked by ACS reference';
      if (!customer) {
        const byName = await findCustomer('customer_name', client.name);
        if (byName?.custom_acs_reference && byName.custom_acs_reference !== client.refNumber) {
          report.clients.skipped++;
          log(`${label}: skipped: customer "${byName.name}" has ACS reference ${byName.custom_acs_reference}`);
          continue;
        }
        customer = byName;
        how = 'linked by name';
      }
      if (customer) {
        const taken = await prisma.client.findFirst({ where: { companyId, erpCustomer: customer.name } });
        if (taken) {
          report.clients.skipped++;
          log(`${label}: skipped: customer "${customer.name}" is already linked to ${taken.refNumber}`);
          continue;
        }
      }
      if (!apply) {
        customerOf.set(client.id, customer?.name ?? client.name);
        if (customer) report.clients.linked++;
        else report.clients.created++;
        log(`${label}: ${would}${customer ? `be ${how} to "${customer.name}"` : 'create a customer'}`);
        continue;
      }
      if (!customer) {
        customer = await erpInsert<ErpCustomerRow>('Customer', {
          customer_name: client.name,
          customer_type: 'Company',
          custom_acs_reference: client.refNumber,
        });
        report.clients.created++;
        log(`${label}: created customer "${customer.name}"`);
      } else {
        if (!customer.custom_acs_reference) {
          await erpUpdate('Customer', customer.name, { custom_acs_reference: client.refNumber });
        }
        report.clients.linked++;
        log(`${label}: ${how} to "${customer.name}"`);
      }
      await prisma.client.update({ where: { id: client.id }, data: { erpCustomer: customer.name } });
      customerOf.set(client.id, customer.name);
    } catch (err) {
      report.clients.failed++;
      log(`${label}: failed: ${reason(err)}`);
    }
  }

  // 2. Work orders → imported sales orders.
  const projects = await prisma.project.findMany({
    where: { companyId, kind: 'WORK_ORDER', erpSalesOrder: null, status: { not: 'CANCELLED' } },
    orderBy: { createdAt: 'asc' },
  });
  let erpCompany: string | null = null;

  for (const project of projects) {
    const wo = project.workOrderNo?.trim() ?? '';
    const label = `project ${project.code}${wo ? ` (WO ${wo})` : ''}`;
    const skip = (why: string) => {
      report.projects.skipped++;
      log(`${label}: skipped: ${why}`);
    };
    try {
      if (!wo) { skip('no WO number'); continue; }
      if (!/^\d+$/.test(wo)) { skip(`WO number "${wo}" is not digits only`); continue; }

      const client = project.clientId
        ? await prisma.client.findFirst({ where: { id: project.clientId, companyId } })
        : await prisma.client.findFirst({
            where: { companyId, name: { equals: project.clientName, mode: 'insensitive' } },
          });
      if (!client) { skip(`no client "${project.clientName}" in the client list`); continue; }
      const customer = customerOf.get(client.id);
      if (!customer) { skip(`client ${client.refNumber} has no ERP customer`); continue; }

      const panels = await prisma.task.findMany({
        where: { projectId: project.id, type: 'PHASE' },
        orderBy: { code: 'asc' },
        select: { id: true, title: true, plannedEnd: true },
      });
      const rows = planOrderRows(panels, project.targetEndDate);
      if (rows.length === 0) {
        skip(panels.length ? `no panels named "<type> Panel <n>" (found "${panels[0]!.title}")` : 'no panels');
        continue;
      }

      const summary = rows.map((r) => `${r.qty} × ${r.item_code} ${r.delivery_date}`).join(', ');
      const finished = FINISHED.has(project.status);
      if (!apply) {
        report.projects.created++;
        log(`${label}: ${would}create an imported order for "${customer}": ${summary}${finished ? ', then close it' : ''}`);
        continue;
      }

      // Resume: a crash after creating the order leaves it findable by its project link.
      const link = projectLink(project.id);
      const [existing] = await erpList<ErpOrderRow>('Sales Order', {
        filters: [
          ['Sales Order', 'custom_project_link', '=', link],
          ['Sales Order', 'docstatus', '!=', 2],
        ],
        fields: ['name', 'docstatus', 'status'],
        limit: 1,
      });
      let order: ErpOrderRow;
      if (existing) {
        order = existing;
      } else {
        if (!erpCompany) {
          const companies = await erpList<{ name: string }>('Company', { fields: ['name'], limit: 0 });
          if (companies.length !== 1) throw new DomainError(`ERP has ${companies.length} companies; expected exactly one.`);
          erpCompany = companies[0]!.name;
        }
        const lastDelivery = rows.map((r) => r.delivery_date).sort().at(-1)!;
        const target = project.targetEndDate ? day(project.targetEndDate) : lastDelivery;
        order = await erpInsert<ErpOrderRow>('Sales Order', {
          company: erpCompany,
          customer,
          transaction_date: day(project.createdAt),
          delivery_date: target > lastDelivery ? target : lastDelivery,
          po_no: project.clientPoNumber || undefined,
          custom_wo_number: wo,
          custom_project_code: project.code,
          custom_project_link: link,
          custom_imported: 1,
          items: rows.map((r) => ({ item_code: r.item_code, qty: r.qty, rate: 0, delivery_date: r.delivery_date })),
        });
      }
      if (order.docstatus === 0) {
        order = await erpUpdate<ErpOrderRow>('Sales Order', order.name, { docstatus: 1 });
      }
      if (finished && order.status !== 'Closed') {
        await erpCall('erpnext.selling.doctype.sales_order.sales_order.update_status', {
          status: 'Closed',
          name: order.name,
        });
      }

      const full = await erpGet<ErpOrderDoc>('Sales Order', order.name);
      const items = [...full.items].sort((a, b) => a.idx - b.idx);
      const matches =
        items.length === rows.length &&
        items.every((item, i) => item.item_code === rows[i]!.item_code && Number(item.qty) === rows[i]!.qty);
      if (!matches) throw new DomainError(`order ${order.name} rows differ from the project's panels; fix by hand`);

      await prisma.$transaction(async (tx) => {
        await tx.project.update({
          where: { id: project.id },
          data: { erpSalesOrder: full.name, erpOrderModified: full.modified },
        });
        for (const [i, row] of rows.entries()) {
          for (const [unit, taskId] of row.panelTaskIds.entries()) {
            await tx.task.update({ where: { id: taskId }, data: { erpOrderItem: `${items[i]!.name}#${unit + 1}` } });
          }
        }
      });
      if (existing) report.projects.linked++;
      else report.projects.created++;
      log(`${label}: ${existing ? 'linked existing' : 'created'} ${full.name}: ${summary}${finished ? ', closed' : ''}`);
    } catch (err) {
      report.projects.failed++;
      log(`${label}: failed: ${reason(err)}`);
    }
  }

  const line = (what: string, c: BackfillCounts) =>
    apply
      ? `${what}: ${c.created} created, ${c.linked} linked, ${c.skipped} skipped, ${c.failed} failed`
      : `${what}: ${c.created} to create, ${c.linked} to link, ${c.skipped} skipped, ${c.failed} failed (dry run)`;
  log(line('Clients', report.clients));
  log(line('Projects', report.projects));
  return report;
}
