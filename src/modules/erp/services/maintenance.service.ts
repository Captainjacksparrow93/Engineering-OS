import type { ErpMaintenanceKind, ErpMaintenanceStatus } from '@prisma/client';
import { prisma, type Tx } from '@/core/db/prisma';
import { audit } from '@/core/audit/audit';
import { notify } from '@/core/notifications/notify';
import { DomainError, NotFoundError } from '@/core/rbac/errors';
import type { Principal } from '@/core/rbac/types';
import { hoursBetween, nextDue } from '../domain/assets';
import { D, money, sum } from '../domain/money';
import {
  breakdownSchema,
  maintenanceDoneSchema,
  maintenanceScheduleSchema,
  repairDoneSchema,
  type BreakdownInput,
  type MaintenanceDoneInput,
  type MaintenanceScheduleInput,
  type Raw,
  type RepairDoneInput,
} from '../validation';
import { manageArea, readArea, userNames } from './access';
import { depreciationDue } from './asset.service';
import { nextNumber, SERIES } from './series';

/**
 * Maintenance (ERPNext Asset Maintenance + Asset Repair): preventive tasks that repeat on a
 * frequency, and breakdowns reported, repaired and timed. Logging a preventive job moves the
 * task's next due date on from the day it was done.
 *   Breakdown: Open → In progress → Done (or Cancelled)
 */

export const MAINT_STATUS_LABEL: Record<ErpMaintenanceStatus, string> = { OPEN: 'Open', IN_PROGRESS: 'In progress', DONE: 'Done', CANCELLED: 'Cancelled' };
export const MAINT_KIND_LABEL: Record<ErpMaintenanceKind, string> = { PREVENTIVE: 'Preventive', BREAKDOWN: 'Breakdown' };

const today = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};

async function assetInUse(tx: Tx, companyId: string, assetId: string) {
  const asset = await tx.erpAsset.findFirst({ where: { id: assetId, companyId } });
  if (!asset) throw new NotFoundError('Asset not found.');
  if (asset.status !== 'SUBMITTED') throw new DomainError(`${asset.number} is not in use.`);
  return asset;
}

async function assertEmployee(tx: Tx, companyId: string, userId: string | null | undefined) {
  if (!userId) return null;
  const u = await tx.user.findFirst({ where: { id: userId, companyId, status: 'ACTIVE' } });
  if (!u) throw new DomainError('Pick an active employee.');
  return u.id;
}

// ---------------------------------------------------------------- schedules

export async function listSchedules(p: Principal, f: { due?: boolean; assetId?: string | null } = {}) {
  await readArea(p, 'assets');
  const soon = new Date(today().getTime() + 7 * 86_400_000);
  const rows = await prisma.erpMaintenanceSchedule.findMany({
    where: { companyId: p.companyId, isActive: true, ...(f.due ? { nextDueDate: { lte: soon } } : {}), ...(f.assetId ? { assetId: f.assetId } : {}) },
    orderBy: { nextDueDate: 'asc' },
    take: 500,
  });
  const [assets, people] = await Promise.all([
    prisma.erpAsset.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.assetId))] } }, select: { id: true, number: true, name: true, location: true } }),
    userNames(rows.map((r) => r.assignedToId)),
  ]);
  const asset = new Map(assets.map((a) => [a.id, a]));
  const t = today();
  return rows.map((r) => ({ ...r, asset: asset.get(r.assetId), assignedTo: r.assignedToId ? people.get(r.assignedToId) ?? '—' : '—', overdue: r.nextDueDate < t }));
}

export async function createSchedule(p: Principal, input: Raw<MaintenanceScheduleInput>) {
  await manageArea(p, 'assets');
  const data = maintenanceScheduleSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const asset = await assetInUse(tx, p.companyId, data.assetId);
    const row = await tx.erpMaintenanceSchedule.create({
      data: { companyId: p.companyId, assetId: asset.id, task: data.task, frequency: data.frequency, nextDueDate: data.nextDueDate, assignedToId: await assertEmployee(tx, p.companyId, data.assignedToId), checklist: data.checklist, createdById: p.userId },
    });
    if (!asset.maintenanceRequired) await tx.erpAsset.update({ where: { id: asset.id }, data: { maintenanceRequired: true } });
    await audit({ actorId: p.userId, module: 'erp', action: 'erp.maintenance.scheduled', entityType: 'ErpAsset', entityId: asset.id, diff: { task: row.task, frequency: row.frequency } }, tx);
    return row;
  });
}

export async function setScheduleActive(p: Principal, id: string, isActive: boolean) {
  await manageArea(p, 'assets');
  const row = await prisma.erpMaintenanceSchedule.findFirst({ where: { id, companyId: p.companyId } });
  if (!row) throw new NotFoundError('Maintenance task not found.');
  if (isActive) await assetInUse(prisma, p.companyId, row.assetId);
  return prisma.erpMaintenanceSchedule.update({ where: { id }, data: { isActive } });
}

/** Record a preventive job as done and move the task's next due date on. */
export async function logScheduleDone(p: Principal, scheduleId: string, input: Raw<MaintenanceDoneInput>) {
  await manageArea(p, 'assets');
  const data = maintenanceDoneSchema.parse(input);
  if (data.doneOn > today()) throw new DomainError('The date it was done can’t be in the future.');
  return prisma.$transaction(async (tx) => {
    const s = await tx.erpMaintenanceSchedule.findFirst({ where: { id: scheduleId, companyId: p.companyId, isActive: true } });
    if (!s) throw new NotFoundError('Maintenance task not found.');
    await assetInUse(tx, p.companyId, s.assetId);
    const number = await nextNumber(tx, p.companyId, SERIES.maintenance, data.doneOn);
    const log = await tx.erpMaintenanceLog.create({
      data: {
        companyId: p.companyId,
        number,
        assetId: s.assetId,
        scheduleId: s.id,
        kind: 'PREVENTIVE',
        status: 'DONE',
        description: s.task,
        reportedAt: data.doneOn,
        completedAt: data.doneOn,
        actionTaken: data.actionTaken,
        cost: money(D(data.cost)),
        downtimeHours: data.downtimeHours ? money(data.downtimeHours) : null,
        assignedToId: s.assignedToId,
        doneById: p.userId,
        createdById: p.userId,
      },
    });
    const next = nextDue(data.doneOn, s.frequency);
    await tx.erpMaintenanceSchedule.update({ where: { id: s.id }, data: { lastDoneDate: data.doneOn, nextDueDate: next } });
    await audit({ actorId: p.userId, module: 'erp', action: 'erp.maintenance.done', entityType: 'ErpMaintenanceLog', entityId: log.id, diff: { number, task: s.task, nextDue: next.toISOString().slice(0, 10) } }, tx);
    return log;
  });
}

// ---------------------------------------------------------------- logs and breakdowns

export async function listLogs(p: Principal, f: { kind?: string | null; status?: string | null; assetId?: string | null } = {}) {
  await readArea(p, 'assets');
  const rows = await prisma.erpMaintenanceLog.findMany({
    where: {
      companyId: p.companyId,
      ...(f.kind ? { kind: f.kind as ErpMaintenanceKind } : {}),
      ...(f.status === 'OPEN_ALL' ? { status: { in: ['OPEN', 'IN_PROGRESS'] } } : f.status ? { status: f.status as ErpMaintenanceStatus } : {}),
      ...(f.assetId ? { assetId: f.assetId } : {}),
    },
    orderBy: { reportedAt: 'desc' },
    take: 300,
  });
  const [assets, people] = await Promise.all([
    prisma.erpAsset.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.assetId))] } }, select: { id: true, number: true, name: true } }),
    userNames(rows.flatMap((r) => [r.assignedToId, r.doneById])),
  ]);
  const asset = new Map(assets.map((a) => [a.id, a]));
  return rows.map((r) => ({ ...r, asset: asset.get(r.assetId), assignedTo: r.assignedToId ? people.get(r.assignedToId) ?? '—' : '—', doneBy: r.doneById ? people.get(r.doneById) ?? '—' : null }));
}

export async function getLog(p: Principal, id: string) {
  await readArea(p, 'assets');
  const log = await prisma.erpMaintenanceLog.findFirst({ where: { id, companyId: p.companyId } });
  if (!log) throw new NotFoundError('Maintenance record not found.');
  const [asset, schedule, people] = await Promise.all([
    prisma.erpAsset.findUnique({ where: { id: log.assetId }, select: { id: true, number: true, name: true, location: true } }),
    log.scheduleId ? prisma.erpMaintenanceSchedule.findUnique({ where: { id: log.scheduleId }, select: { id: true, task: true, checklist: true } }) : null,
    userNames([log.assignedToId, log.doneById, log.createdById]),
  ]);
  return { log, asset, schedule, people };
}

/** Report a breakdown. The assignee (or every maintenance manager) is told at once. */
export async function reportBreakdown(p: Principal, input: Raw<BreakdownInput>) {
  await manageArea(p, 'assets');
  const data = breakdownSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const asset = await assetInUse(tx, p.companyId, data.assetId);
    const open = await tx.erpMaintenanceLog.findFirst({ where: { assetId: asset.id, kind: 'BREAKDOWN', status: { in: ['OPEN', 'IN_PROGRESS'] } } });
    if (open) throw new DomainError(`${asset.name} already has an open breakdown, ${open.number}.`);
    const assignedToId = await assertEmployee(tx, p.companyId, data.assignedToId);
    const number = await nextNumber(tx, p.companyId, SERIES.maintenance);
    const log = await tx.erpMaintenanceLog.create({
      data: { companyId: p.companyId, number, assetId: asset.id, kind: 'BREAKDOWN', status: 'OPEN', description: data.description, assignedToId, createdById: p.userId },
    });
    const to = assignedToId
      ? [assignedToId]
      : (await tx.user.findMany({ where: { companyId: p.companyId, status: 'ACTIVE', roleAssignments: { some: { role: { key: 'MAINTENANCE_MANAGER' } } } }, select: { id: true } })).map((u) => u.id);
    const recipients = to.filter((u) => u !== p.userId);
    if (recipients.length) await notify({ userIds: recipients, title: `Breakdown: ${asset.name}`, body: data.description.slice(0, 200), link: `/erp/assets/maintenance/${log.id}` }, tx);
    await audit({ actorId: p.userId, module: 'erp', action: 'erp.maintenance.breakdown_reported', entityType: 'ErpMaintenanceLog', entityId: log.id, diff: { number, asset: asset.number } }, tx);
    return log;
  });
}

async function openLog(tx: Tx, p: Principal, id: string) {
  const log = await tx.erpMaintenanceLog.findFirst({ where: { id, companyId: p.companyId } });
  if (!log) throw new NotFoundError('Maintenance record not found.');
  if (log.status !== 'OPEN' && log.status !== 'IN_PROGRESS') throw new DomainError(`${log.number} is already ${MAINT_STATUS_LABEL[log.status].toLowerCase()}.`);
  return log;
}

export async function startRepair(p: Principal, id: string) {
  await manageArea(p, 'assets');
  return prisma.$transaction(async (tx) => {
    const log = await openLog(tx, p, id);
    if (log.status !== 'OPEN') throw new DomainError('The repair has already started.');
    await tx.erpMaintenanceLog.update({ where: { id }, data: { status: 'IN_PROGRESS', startedAt: new Date(), assignedToId: log.assignedToId ?? p.userId } });
  });
}

/** Repair done: downtime runs from the report to now unless entered. */
export async function completeRepair(p: Principal, id: string, input: Raw<RepairDoneInput>) {
  await manageArea(p, 'assets');
  const data = repairDoneSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const log = await openLog(tx, p, id);
    const now = new Date();
    const downtime = data.downtimeHours ? money(data.downtimeHours) : hoursBetween(log.reportedAt, now);
    await tx.erpMaintenanceLog.update({ where: { id }, data: { status: 'DONE', startedAt: log.startedAt ?? now, completedAt: now, actionTaken: data.actionTaken, cost: money(D(data.cost)), downtimeHours: downtime, doneById: p.userId } });
    await audit({ actorId: p.userId, module: 'erp', action: 'erp.maintenance.repaired', entityType: 'ErpMaintenanceLog', entityId: id, diff: { number: log.number, downtimeHours: downtime.toFixed(2) } }, tx);
  });
}

export async function cancelLog(p: Principal, id: string) {
  await manageArea(p, 'assets');
  return prisma.$transaction(async (tx) => {
    await openLog(tx, p, id);
    await tx.erpMaintenanceLog.update({ where: { id }, data: { status: 'CANCELLED' } });
  });
}

/** Workstations whose machine is down (an open breakdown on its asset). */
export async function downWorkstations(companyId: string): Promise<Set<string>> {
  const rows = await prisma.erpMaintenanceLog.findMany({ where: { companyId, kind: 'BREAKDOWN', status: { in: ['OPEN', 'IN_PROGRESS'] } }, select: { assetId: true } });
  if (rows.length === 0) return new Set();
  const assets = await prisma.erpAsset.findMany({ where: { id: { in: rows.map((r) => r.assetId) }, workstationId: { not: null } }, select: { workstationId: true } });
  return new Set(assets.map((a) => a.workstationId!));
}

/** Assets and maintenance home: counts, what's due, open breakdowns and depreciation due. */
export async function assetsOverview(p: Principal) {
  await readArea(p, 'assets');
  const t = today();
  const monthEnd = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0));
  const since = new Date(t.getTime() - 30 * 86_400_000);
  const [inUse, value, due, breakdowns, recent, dep] = await Promise.all([
    prisma.erpAsset.count({ where: { companyId: p.companyId, status: 'SUBMITTED' } }),
    prisma.erpAsset.aggregate({ where: { companyId: p.companyId, status: 'SUBMITTED' }, _sum: { grossValue: true } }),
    listSchedules(p, { due: true }),
    listLogs(p, { kind: 'BREAKDOWN', status: 'OPEN_ALL' }),
    prisma.erpMaintenanceLog.findMany({ where: { companyId: p.companyId, status: 'DONE', completedAt: { gte: since } }, select: { downtimeHours: true, cost: true } }),
    depreciationDue(p, monthEnd),
  ]);
  return {
    inUse,
    grossValue: D(value._sum.grossValue),
    due,
    breakdowns,
    downtime30: sum(recent, (r) => r.downtimeHours),
    cost30: sum(recent, (r) => r.cost),
    depreciationDue: dep,
    monthEnd,
  };
}
