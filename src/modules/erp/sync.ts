import type { Prisma } from '@prisma/client';
import { prisma } from '@/core/db/prisma';
import { audit } from '@/core/audit/audit';
import { notify } from '@/core/notifications/notify';
import { startOfDay } from '@/core/utils/dates';
import { createPanelTasks } from '@/modules/project-management/services/automation-project.service';
import { renameClientCascade } from '@/modules/project-management/services/client.service';
import { recomputeTaskDerivedState } from '@/modules/project-management/services/task.service';
import { D } from './domain/money';

/**
 * Plan 015: when a sales order changes after its project exists, PM follows safely.
 * PO, dates, WO and client name follow ERP; added panels are appended to the PM;
 * removals, cancellations and clashes only raise an "Order changed" alert. Nothing is deleted.
 * Pull only: the project page syncs its order, the projects list syncs all. Plan 022: the
 * order is our own ERP sales order; any change to it bumps its updatedAt, which is compared
 * with the project's stored erpOrderModified.
 */

interface OrderLine {
  name: string;
  idx: number;
  item_code: string;
  qty: number;
  delivery_date?: string;
}

interface Order {
  name: string;
  docstatus: number;
  status?: string;
  modified: string;
  customerId: string;
  po_no?: string | null;
  custom_wo_number?: string | null;
  delivery_date?: string | null;
  items: OrderLine[];
}

/** Our sales order in the shape the plan 015 rules were written against. */
async function loadOrder(companyId: string, number: string): Promise<Order | null> {
  const so = await prisma.erpSalesOrder.findUnique({ where: { companyId_number: { companyId, number } }, include: { lines: { orderBy: { sortOrder: 'asc' } } } });
  if (!so) return null;
  const templates = new Set((await prisma.checklistTemplate.findMany({ where: { isActive: true }, select: { code: true } })).map((t) => t.code));
  const items = await prisma.erpItem.findMany({ where: { id: { in: so.lines.map((l) => l.itemId) } }, select: { id: true, code: true } });
  const code = new Map(items.map((i) => [i.id, i.code]));
  return {
    name: so.number,
    docstatus: so.status === 'DRAFT' ? 0 : so.status === 'SUBMITTED' ? 1 : 2,
    status: so.isClosed ? 'Closed' : undefined,
    modified: so.updatedAt.toISOString(),
    customerId: so.customerId,
    po_no: so.poNo,
    custom_wo_number: so.woNumber,
    delivery_date: day(so.deliveryDate),
    // Only panel lines matter to PM; freight, services and spares stay commercial.
    items: so.lines
      .filter((l) => templates.has(code.get(l.itemId) ?? ''))
      .map((l, i) => ({ name: l.id, idx: i, item_code: code.get(l.itemId)!, qty: D(l.qty).toNumber(), delivery_date: day(l.deliveryDate) ?? undefined })),
  };
}

const LIST_THROTTLE_MS = 60_000;
const lastListSync = new Map<string, number>();

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const asDate = (s: string) => new Date(`${s}T00:00:00.000Z`);
const kept = (titles: string[]) => `${titles.join(', ')} ${titles.length === 1 ? 'was' : 'were'} kept.`;
const PANEL_TITLE = /^([A-Za-z0-9]+)\s+Panel\s+(\d+)$/i;
const DONE = new Set(['COMPLETED', 'CLOSED', 'CANCELLED']);

/** Syncs linked orders changed since the project last read them. */
export async function syncOrderChanges(companyId: string, { projectId }: { projectId?: string } = {}): Promise<{ synced: number }> {
  const linked = await prisma.project.findMany({
    where: { companyId, erpSalesOrder: { not: null }, ...(projectId ? { id: projectId } : {}) },
    select: { id: true, erpSalesOrder: true, erpOrderModified: true },
  });
  if (linked.length === 0) return { synced: 0 };
  const orders = await prisma.erpSalesOrder.findMany({ where: { companyId, number: { in: linked.map((p) => p.erpSalesOrder!) } }, select: { number: true, updatedAt: true } });
  const modified = new Map(orders.map((o) => [o.number, o.updatedAt.toISOString()]));
  let synced = 0;
  for (const project of linked) {
    const m = modified.get(project.erpSalesOrder!);
    if (!m || !(m > (project.erpOrderModified ?? ''))) continue;
    await applyOrder(companyId, project.id, project.erpSalesOrder!);
    synced++;
  }
  return { synced };
}

/** Project page: sync this project's order. Never throws. */
export async function syncProjectOrderSafely(companyId: string, projectId: string): Promise<void> {
  try {
    await syncOrderChanges(companyId, { projectId });
  } catch (err) {
    console.error('[erp] order sync failed', { projectId, error: err instanceof Error ? err.message : String(err) });
  }
}

/** Projects list: sync every linked order, at most once a minute per server process. Never throws. */
export async function syncAllOrdersSafely(companyId: string): Promise<void> {
  const last = lastListSync.get(companyId) ?? 0;
  if (Date.now() - last < LIST_THROTTLE_MS) return;
  lastListSync.set(companyId, Date.now());
  try {
    await syncOrderChanges(companyId);
  } catch (err) {
    console.error('[erp] order sync failed', { error: err instanceof Error ? err.message : String(err) });
  }
}

/** Tests only: forget the list throttle. */
export function resetSyncThrottle() {
  lastListSync.clear();
}

async function applyOrder(companyId: string, projectId: string, orderName: string): Promise<void> {
  const order = await loadOrder(companyId, orderName);
  if (!order) return;
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, include: { client: true } });
  const allTasks = await prisma.task.findMany({ where: { projectId }, select: { id: true, code: true, title: true, type: true, plannedEnd: true, erpOrderItem: true } });
  const phases = allTasks.filter((t) => t.type === 'PHASE');

  const alerts: string[] = [];
  const data: Prisma.ProjectUncheckedUpdateInput = {};
  const diff: Record<string, unknown> = {};
  const set = <K extends 'clientPoNumber' | 'workOrderNo'>(field: K, from: string | null, to: string | null) => {
    if (from === to) return;
    data[field] = to;
    diff[field] = { from, to };
  };
  let rename: { clientId: string; from: string; to: string } | null = null;
  let relinkCustomer: string | null = null;
  const phaseDates: Array<{ id: string; title: string; from: string | null; to: string }> = [];
  const additions: Array<{ code: string; row: string; unitInRow: number; date: string }> = [];

  if (order.docstatus === 2) {
    alerts.push('Order cancelled in ERP. Nothing was changed or deleted here.');
  } else {
    if (order.status === 'Closed' && !DONE.has(project.status)) {
      alerts.push('Order closed in ERP while the project is still open.');
    }

    set('clientPoNumber', project.clientPoNumber, order.po_no?.trim() || null);

    if (order.delivery_date && order.delivery_date !== day(project.targetEndDate)) {
      data.targetEndDate = asDate(order.delivery_date);
      diff.targetEndDate = { from: day(project.targetEndDate), to: order.delivery_date };
    }

    const wo = (order.custom_wo_number ?? '').trim();
    if (wo && wo !== project.workOrderNo) {
      const other = await prisma.project.findFirst({ where: { workOrderNo: wo, id: { not: projectId } }, select: { code: true } });
      if (!/^\d+$/.test(wo)) alerts.push(`WO changed to "${wo}" in ERP, but a WO must be digits only. WO not changed here.`);
      else if (other) alerts.push(`WO changed to ${wo} in ERP, but project ${other.code} already uses WO ${wo}. WO not changed here.`);
      else set('workOrderNo', project.workOrderNo, wo);
    }

    // Customer: the same customer renamed → rename our client; another customer → alert.
    const client = project.client;
    if (client) {
      const customer = await prisma.erpParty.findUnique({ where: { id: order.customerId } });
      const sameCustomer = !!customer && (customer.clientId === client.id || customer.code === client.erpCustomer);
      if (!customer || !sameCustomer) {
        alerts.push(`Order moved to customer "${customer?.name ?? 'unknown'}" in ERP. Client not changed here.`);
      } else {
        if (customer.code !== client.erpCustomer) relinkCustomer = customer.code;
        const newName = customer.name.trim();
        if (newName && newName !== client.name) {
          const clash = await prisma.client.findFirst({ where: { companyId: project.companyId, name: newName, id: { not: client.id } } });
          if (clash) alerts.push(`Customer renamed to "${newName}" in ERP, but another client already has that name. Client not renamed here.`);
          else rename = { clientId: client.id, from: client.name, to: newName };
        }
      }
    }

    // Panels, matched by Task.erpOrderItem = "<row>#<unit>".
    const linkedPhases = phases.filter((t) => t.erpOrderItem);
    if (phases.length > 0 && linkedPhases.length === 0) {
      console.warn('[erp] order sync: project has panels but none linked to order rows; panel rules skipped', { projectId });
    } else {
      const byRow = new Map<string, Array<{ unit: number; task: (typeof phases)[number] }>>();
      for (const task of linkedPhases) {
        const [row, unit] = task.erpOrderItem!.split('#');
        const list = byRow.get(row!) ?? [];
        list.push({ unit: Number(unit), task });
        byRow.set(row!, list);
      }
      const templates = new Set(
        (await prisma.checklistTemplate.findMany({ where: { isActive: true }, select: { code: true } })).map((t) => t.code),
      );
      const items = [...(order.items ?? [])].sort((a, b) => a.idx - b.idx);
      for (const item of items) {
        const qty = Math.round(Number(item.qty) || 0);
        const existing = (byRow.get(item.name) ?? []).sort((a, b) => a.unit - b.unit);
        if (item.delivery_date) {
          for (const { task } of existing) {
            if (day(task.plannedEnd) !== item.delivery_date) {
              phaseDates.push({ id: task.id, title: task.title, from: day(task.plannedEnd), to: item.delivery_date });
            }
          }
        }
        const highest = existing.at(-1)?.unit ?? 0;
        if (qty > highest) {
          if (!templates.has(item.item_code)) {
            alerts.push(`Item "${item.item_code}" isn't a checklist template, so no panel was added for it.`);
          } else {
            const date = item.delivery_date || order.delivery_date || day(project.targetEndDate)!;
            for (let u = highest + 1; u <= qty; u++) additions.push({ code: item.item_code, row: item.name, unitInRow: u, date });
          }
        } else if (qty < existing.length) {
          const extra = existing.filter((e) => e.unit > qty).map((e) => e.task.title);
          alerts.push(`${item.item_code} quantity reduced from ${existing.length} to ${qty} in ERP. ${kept(extra)}`);
        }
      }
      const rowNames = new Set(items.map((i) => i.name));
      for (const [row, list] of byRow) {
        if (!rowNames.has(row)) alerts.push(`A row was removed from the order in ERP. ${kept(list.map((l) => l.task.title))}`);
      }
    }
  }

  // Appended panels: next unit per type, next PH and T numbers, assigned to the PM.
  const addedTitles: string[] = [];
  const nextUnit = new Map<string, number>();
  for (const t of phases) {
    const m = t.title.match(PANEL_TITLE);
    if (m) nextUnit.set(m[1]!.toUpperCase(), Math.max(nextUnit.get(m[1]!.toUpperCase()) ?? 0, Number(m[2])));
  }
  let phaseNumber = Math.max(0, ...phases.map((t) => Number(t.code.match(/-PH(\d+)$/)?.[1] ?? 0)));
  let taskNumber = Math.max(0, ...allTasks.map((t) => Number(t.code.match(/-T(\d+)$/)?.[1] ?? 0)));
  const plannedAdds = additions.map((a) => {
    const unit = (nextUnit.get(a.code) ?? 0) + 1;
    nextUnit.set(a.code, unit);
    addedTitles.push(`${a.code} Panel ${unit}`);
    return { ...a, unit };
  });
  if (plannedAdds.length > 0) {
    alerts.push(`${addedTitles.join(', ')} added from the sales order and assigned to the PM: assign engineers.`);
    const types = new Set([...project.automationTypes, ...plannedAdds.map((a) => a.code)]);
    if (types.size !== project.automationTypes.length) data.automationTypes = [...types];
  }

  const previous = project.erpOrderAlert ? project.erpOrderAlert.split('\n') : [];
  const newAlerts = alerts.filter((a) => !previous.includes(a));
  if (newAlerts.length > 0) {
    data.erpOrderAlert = [...previous, ...newAlerts].join('\n');
    data.erpOrderAlertAt = new Date();
  }
  data.erpOrderModified = order.modified;

  const templateMap = plannedAdds.length
    ? new Map(
        (await prisma.checklistTemplate.findMany({ where: { isActive: true }, include: { items: { orderBy: { stepNumber: 'asc' } } } })).map(
          (t) => [t.code, t],
        ),
      )
    : new Map();
  const directors = newAlerts.length
    ? await prisma.user.findMany({
        where: { companyId: project.companyId, status: 'ACTIVE', roleAssignments: { some: { role: { key: 'DIRECTOR' } } } },
        select: { id: true },
      })
    : [];

  await prisma.$transaction(async (tx) => {
    await tx.project.update({ where: { id: projectId }, data });
    for (const pd of phaseDates) await tx.task.update({ where: { id: pd.id }, data: { plannedEnd: asDate(pd.to) } });
    if (relinkCustomer && project.clientId) {
      await tx.client.update({ where: { id: project.clientId }, data: { erpCustomer: relinkCustomer } });
    }
    if (rename) await renameClientCascade(tx, project.companyId, rename.clientId, rename.to);
    const start = startOfDay(new Date());
    for (const add of plannedAdds) {
      const created = await createPanelTasks(tx, {
        projectId,
        projectCode: project.code,
        template: templateMap.get(add.code)!,
        unit: add.unit,
        phaseNumber: ++phaseNumber,
        firstTaskNumber: taskNumber + 1,
        start: project.startDate && project.startDate > start ? project.startDate : start,
        deliveryDate: asDate(add.date),
        createdById: project.managerId,
        defaultAssigneeId: project.managerId,
        erpOrderItem: `${add.row}#${add.unitInRow}`,
      });
      taskNumber += created;
    }

    const changes = {
      ...diff,
      ...(phaseDates.length ? { panelDates: phaseDates.map((p) => ({ panel: p.title, from: p.from, to: p.to })) } : {}),
      ...(rename ? { clientName: { from: rename.from, to: rename.to } } : {}),
      ...(relinkCustomer ? { erpCustomer: relinkCustomer } : {}),
      ...(addedTitles.length ? { panelsAdded: addedTitles } : {}),
      ...(newAlerts.length ? { alerts: newAlerts } : {}),
    };
    if (Object.keys(changes).length > 0) {
      await audit(
        {
          actorId: null,
          module: 'erp',
          action: 'order_synced',
          entityType: 'Project',
          entityId: projectId,
          diff: { erpSalesOrder: order.name, ...changes },
        },
        tx,
      );
    }
    if (newAlerts.length > 0) {
      await notify(
        {
          userIds: directors.map((d) => d.id),
          title: `Order changed: review ${project.code}`,
          body: newAlerts.join(' '),
          link: `/pm/projects/${projectId}`,
        },
        tx,
      );
    }
  });

  if (plannedAdds.length > 0 || phaseDates.length > 0 || data.targetEndDate) await recomputeTaskDerivedState(projectId);
}
