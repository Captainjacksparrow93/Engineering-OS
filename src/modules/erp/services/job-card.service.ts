import type { ErpJobCardStatus } from '@prisma/client';
import { prisma } from '@/core/db/prisma';
import { DomainError, NotFoundError } from '@/core/rbac/errors';
import type { Principal } from '@/core/rbac/types';
import { D, Dec, formatQty, sum } from '../domain/money';
import { jobCardLogSchema, type JobCardLogInput, type Raw } from '../validation';
import { manageArea, readArea } from './access';

/**
 * Job Card (ERPNext): one operation of a work order at a workstation. People log the time they
 * spent and how many they finished; the logged time prices the work order's operating cost.
 */

export const JOB_STATUS_LABEL: Record<ErpJobCardStatus, string> = { OPEN: 'Open', WORK_IN_PROGRESS: 'Work in progress', COMPLETED: 'Completed', CANCELLED: 'Cancelled' };

export async function listJobCards(p: Principal, f: { status?: string | null; workstationId?: string | null } = {}) {
  await readArea(p, 'manufacturing');
  const rows = await prisma.erpJobCard.findMany({
    where: { companyId: p.companyId, ...(f.status ? { status: f.status as ErpJobCardStatus } : { status: { in: ['OPEN', 'WORK_IN_PROGRESS'] } }), ...(f.workstationId ? { workstationId: f.workstationId } : {}) },
    orderBy: [{ createdAt: 'asc' }, { sequence: 'asc' }],
    take: 300,
  });
  const [orders, workstations] = await Promise.all([
    prisma.erpWorkOrder.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.workOrderId))] } }, select: { id: true, number: true, itemId: true, expectedEnd: true } }),
    prisma.erpWorkstation.findMany({ where: { companyId: p.companyId }, select: { id: true, name: true } }),
  ]);
  const items = await prisma.erpItem.findMany({ where: { id: { in: orders.map((o) => o.itemId) } }, select: { id: true, code: true } });
  const code = new Map(items.map((i) => [i.id, i.code]));
  const wo = new Map(orders.map((o) => [o.id, { ...o, itemCode: code.get(o.itemId) }]));
  const ws = new Map(workstations.map((w) => [w.id, w.name]));
  return rows.map((r) => ({ ...r, workOrder: wo.get(r.workOrderId), workstationName: ws.get(r.workstationId) ?? '—' }));
}

export async function getJobCard(p: Principal, id: string) {
  await readArea(p, 'manufacturing');
  const card = await prisma.erpJobCard.findFirst({ where: { id, companyId: p.companyId }, include: { logs: { orderBy: { fromTime: 'asc' } } } });
  if (!card) throw new NotFoundError('Job card not found.');
  const [wo, ws, people] = await Promise.all([
    prisma.erpWorkOrder.findUniqueOrThrow({ where: { id: card.workOrderId }, select: { id: true, number: true, itemId: true, status: true } }),
    prisma.erpWorkstation.findUnique({ where: { id: card.workstationId }, select: { name: true } }),
    prisma.user.findMany({ where: { id: { in: card.logs.map((l) => l.employeeId) } }, select: { id: true, fullName: true } }),
  ]);
  return { card, wo, workstationName: ws?.name ?? '—', people: new Map(people.map((u) => [u.id, u.fullName])) };
}

/** Logs time on a job card. Overlapping time for the same person is refused. */
export async function addJobCardLog(p: Principal, id: string, input: Raw<JobCardLogInput> & { employeeId?: string }) {
  await manageArea(p, 'manufacturing');
  const data = jobCardLogSchema.parse(input);
  const employeeId = input.employeeId || p.userId;
  return prisma.$transaction(async (tx) => {
    const card = await tx.erpJobCard.findFirst({ where: { id, companyId: p.companyId } });
    if (!card) throw new NotFoundError('Job card not found.');
    if (card.status === 'COMPLETED' || card.status === 'CANCELLED') throw new DomainError(`This job card is ${card.status.toLowerCase()}.`);
    const wo = await tx.erpWorkOrder.findUniqueOrThrow({ where: { id: card.workOrderId } });
    if (wo.status !== 'SUBMITTED' || wo.isStopped) throw new DomainError(`${wo.number} is not running.`);
    const person = await tx.user.findFirst({ where: { id: employeeId, companyId: p.companyId, status: 'ACTIVE' } });
    if (!person) throw new DomainError('Pick an active employee.');
    const clash = await tx.erpJobCardLog.findFirst({ where: { employeeId, fromTime: { lt: data.toTime }, toTime: { gt: data.fromTime } } });
    if (clash) throw new DomainError(`${person.fullName} already has time logged in that period.`);
    const completed = data.completedQty ?? D(0);
    if (D(card.completedQty).plus(completed).greaterThan(D(card.forQty))) throw new DomainError(`Only ${formatQty(D(card.forQty).minus(D(card.completedQty)))} is left on this job card.`);
    const minutes = new Dec(data.toTime.getTime() - data.fromTime.getTime()).dividedBy(60_000).toDecimalPlaces(2);
    await tx.erpJobCardLog.create({ data: { jobCardId: id, employeeId, fromTime: data.fromTime, toTime: data.toTime, minutes, completedQty: completed, note: data.note } });
    const logs = await tx.erpJobCardLog.findMany({ where: { jobCardId: id } });
    const done = sum(logs, (l) => l.completedQty);
    await tx.erpJobCard.update({ where: { id }, data: { totalMinutes: sum(logs, (l) => l.minutes), completedQty: done, status: done.greaterThanOrEqualTo(D(card.forQty)) ? 'COMPLETED' : 'WORK_IN_PROGRESS' } });
  });
}

export async function removeJobCardLog(p: Principal, id: string, logId: string) {
  await manageArea(p, 'manufacturing');
  return prisma.$transaction(async (tx) => {
    const card = await tx.erpJobCard.findFirst({ where: { id, companyId: p.companyId } });
    if (!card) throw new NotFoundError('Job card not found.');
    await tx.erpJobCardLog.deleteMany({ where: { id: logId, jobCardId: id } });
    const logs = await tx.erpJobCardLog.findMany({ where: { jobCardId: id } });
    const done = sum(logs, (l) => l.completedQty);
    await tx.erpJobCard.update({ where: { id }, data: { totalMinutes: sum(logs, (l) => l.minutes), completedQty: done, status: logs.length === 0 ? 'OPEN' : done.greaterThanOrEqualTo(D(card.forQty)) ? 'COMPLETED' : 'WORK_IN_PROGRESS' } });
  });
}

/** Marks the operation done for the whole quantity. */
export async function completeJobCard(p: Principal, id: string) {
  await manageArea(p, 'manufacturing');
  const card = await prisma.erpJobCard.findFirst({ where: { id, companyId: p.companyId } });
  if (!card) throw new NotFoundError('Job card not found.');
  if (card.status === 'CANCELLED') throw new DomainError('This job card is cancelled.');
  return prisma.erpJobCard.update({ where: { id }, data: { status: 'COMPLETED', completedQty: card.forQty } });
}
