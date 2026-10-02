import type { Prisma } from '@prisma/client';
import { prisma } from '@/core/db/prisma';
import { audit } from '@/core/audit/audit';
import { notify } from '@/core/notifications/notify';
import { startOfDay } from '@/core/utils/dates';
import { createPanelTasks } from '@/modules/project-management/services/automation-project.service';
import { renameClientCascade } from '@/modules/project-management/services/client.service';
import { recomputeTaskDerivedState } from '@/modules/project-management/services/task.service';
import { erpGet, erpList, isErpEnabled } from './client';

/**
 * Plan 015: when a sales order changes after its project exists, PM follows safely.
 * PO, dates, WO and client name follow ERP; added panels are appended to the PM;
 * removals, cancellations and clashes only raise an "Order changed" alert. Nothing is deleted.
 * Pull only (no webhook): the project page syncs its order, the projects list syncs all.
 */

interface ErpOrderItem {
  name: string;
  idx: number;
  item_code: string;
  qty: number;
  delivery_date?: string;
}

interface ErpOrder {
  name: string;
  docstatus: number;
  status?: string;
  modified: string;
  customer: string;
  po_no?: string | null;
  custom_wo_number?: string | null;
  delivery_date?: string | null;
  items?: ErpOrderItem[];
}

interface ErpCustomer {
  name: string;
  customer_name?: string;
  custom_acs_reference?: string | null;
}

const LIST_THROTTLE_MS = 5 * 60_000;
const DOWN_BACKOFF_MS = 60_000;
const lastListSync = new Map<string, number>();
let erpDownUntil = 0;

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const asDate = (s: string) => new Date(`${s}T00:00:00.000Z`);
const kept = (titles: string[]) => `${titles.join(', ')} ${titles.length === 1 ? 'was' : 'were'} kept.`;
const PANEL_TITLE = /^([A-Za-z0-9]+)\s+Panel\s+(\d+)$/i;
const DONE = new Set(['COMPLETED', 'CLOSED', 'CANCELLED']);

/** Syncs linked orders changed in ERPNext since we last read them. Throws when ERPNext fails. */
export async function syncOrderChanges(
  companyId: string,
  { projectId }: { projectId?: string } = {},
): Promise<{ synced: number }> {
  if (!isErpEnabled()) return { synced: 0 };
  const linked = await prisma.project.findMany({
    where: { companyId, erpSalesOrder: { not: null }, ...(projectId ? { id: projectId } : {}) },
    select: { id: true, erpSalesOrder: true, erpOrderModified: true },
  });
  if (linked.length === 0) return { synced: 0 };

  // The oldest stored timestamp, so no project misses a change; each is then compared to its own.
  const since = linked.map((p) => p.erpOrderModified || '2000-01-01 00:00:00').sort()[0]!;
  const changed = await erpList<{ name: string; modified: string }>('Sales Order', {
    filters: [
      ['Sales Order', 'modified', '>', since],
      projectId
        ? ['Sales Order', 'name', '=', linked[0]!.erpSalesOrder]
        : ['Sales Order', 'custom_project_link', 'is', 'set'],
    ],
    fields: ['name', 'modified'],
    limit: 0,
  });

  const byOrder = new Map(linked.map((p) => [p.erpSalesOrder!, p]));
  let synced = 0;
  for (const row of changed) {
    const project = byOrder.get(row.name);
    if (!project || !(row.modified > (project.erpOrderModified ?? ''))) continue;
    await applyOrder(project.id, row.name);
    synced++;
  }
  return { synced };
}

/** Project page: sync this project's order. Never throws; backs off for a minute when ERP is down. */
export async function syncProjectOrderSafely(companyId: string, projectId: string): Promise<void> {
  if (!isErpEnabled() || Date.now() < erpDownUntil) return;
  try {
    await syncOrderChanges(companyId, { projectId });
  } catch (err) {
    erpDownUntil = Date.now() + DOWN_BACKOFF_MS;
    console.error('[erp] order sync failed', { projectId, error: err instanceof Error ? err.message : String(err) });
  }
}

/** Projects list: sync every linked order, at most once per 5 minutes per server process. Never throws. */
export async function syncAllOrdersSafely(companyId: string): Promise<void> {
  if (!isErpEnabled() || Date.now() < erpDownUntil) return;
  const last = lastListSync.get(companyId) ?? 0;
  if (Date.now() - last < LIST_THROTTLE_MS) return;
  lastListSync.set(companyId, Date.now());
  try {
    await syncOrderChanges(companyId);
  } catch (err) {
    erpDownUntil = Date.now() + DOWN_BACKOFF_MS;
    console.error('[erp] order sync failed', { error: err instanceof Error ? err.message : String(err) });
  }
}

async function applyOrder(projectId: string, orderName: string): Promise<void> {
  const order = await erpGet<ErpOrder>('Sales Order', orderName);
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

    // Customer: same customer (same ACS reference) renamed → rename our client; another customer → alert.
    const client = project.client;
    if (client && order.customer) {
      const customer = await erpGet<ErpCustomer>('Customer', order.customer);
      const sameCustomer =
        order.customer === client.erpCustomer || customer.custom_acs_reference?.trim() === client.refNumber;
      if (!sameCustomer) {
        alerts.push(`Order moved to customer "${order.customer}" in ERP. Client not changed here.`);
      } else {
        if (order.customer !== client.erpCustomer) relinkCustomer = order.customer;
        const newName = (customer.customer_name ?? '').trim();
        if (newName && newName !== client.name) {
          const clash = await prisma.client.findFirst({
            where: { companyId: project.companyId, name: newName, id: { not: client.id } },
          });
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
