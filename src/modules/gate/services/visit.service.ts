import type { GateVisitStatus, Prisma } from '@prisma/client';
import { prisma, type Tx } from '@/core/db/prisma';
import { audit } from '@/core/audit/audit';
import { notify } from '@/core/notifications/notify';
import { hasPermissionAnywhere } from '@/core/rbac/engine';
import { DomainError, ForbiddenError, NotFoundError } from '@/core/rbac/errors';
import { assertCan } from '@/core/rbac/guard';
import type { Principal } from '@/core/rbac/types';
import { REPLY_LABEL, visitorLabel } from '../domain/labels';
import { formatWhen, istDateString, istDateTime, istDayRange } from '../domain/time';
import {
  registerFilterSchema,
  replySchema,
  scheduleSchema,
  walkInSchema,
  type ReplyInput,
  type ScheduleInput,
  type WalkInInput,
} from '../validation';

/**
 * Gate & Visitors (plan 019). People only.
 *
 * - The front desk (`gate.desk`) schedules visits for anyone, logs walk-ins and checks
 *   visitors in and out.
 * - Every employee schedules visits to themselves, sees their own visitors and answers the
 *   arrival alert. That is tied to who they are, so it needs no permission key.
 * - The full register is for the desk and Directors (`gate.register.read`).
 */

export const isDesk = (principal: Principal) => hasPermissionAnywhere(principal, 'gate.desk');
export const seesRegister = (principal: Principal) => isDesk(principal) || hasPermissionAnywhere(principal, 'gate.register.read');

const hostSelect = { select: { id: true, fullName: true, designation: true } } as const;
const visitInclude = { host: hostSelect, createdBy: { select: { id: true, fullName: true } } } satisfies Prisma.GateVisitInclude;
export type VisitRow = Prisma.GateVisitGetPayload<{ include: typeof visitInclude }>;

async function deskUserIds(companyId: string, tx: Tx) {
  const users = await tx.user.findMany({
    where: { companyId, status: 'ACTIVE', roleAssignments: { some: { role: { permissions: { some: { permission: { key: 'gate.desk' } } } } } } },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

async function loadActiveHost(principal: Principal, hostId: string, tx: Tx) {
  const host = await tx.user.findFirst({ where: { id: hostId, companyId: principal.companyId, status: 'ACTIVE' }, select: { id: true, fullName: true } });
  if (!host) throw new NotFoundError('That employee was not found.');
  return host;
}

/** A visit the principal may see: the desk and register readers see all, others only their own. */
async function loadVisibleVisit(principal: Principal, visitId: string, tx: Tx = prisma) {
  const visit = await tx.gateVisit.findFirst({
    where: { id: visitId, companyId: principal.companyId, ...(seesRegister(principal) ? {} : { hostId: principal.userId }) },
    include: visitInclude,
  });
  if (!visit) throw new NotFoundError('Visit not found.');
  return visit;
}

/** Moves a visit on only if nobody else moved it first (two desk screens, a double click). */
async function transition(tx: Tx, visitId: string, from: GateVisitStatus, data: Prisma.GateVisitUpdateManyMutationInput, message: string) {
  const { count } = await tx.gateVisit.updateMany({ where: { id: visitId, status: from }, data });
  if (count === 0) throw new DomainError(message);
}

// ---------------------------------------------------------------- scheduling

/**
 * Puts a visit on the expected list. Without `hostId` the visit is to the principal
 * themselves; naming anyone else needs the front desk.
 */
export async function scheduleVisit(principal: Principal, input: ScheduleInput, now: Date = new Date()) {
  const data = scheduleSchema.parse(input);
  const forOther = !!data.hostId && data.hostId !== principal.userId;
  if (forOther) assertCan(principal, 'gate.desk', {}, 'Only the front desk can schedule a visit to someone else.');
  const expectedAt = istDateTime(data.date, data.time);
  if (Number.isNaN(expectedAt.getTime())) throw new DomainError('Pick a valid date and time.');
  if (data.date < istDateString(now)) throw new DomainError('The visit date cannot be in the past.');

  return prisma.$transaction(async (tx) => {
    const host = await loadActiveHost(principal, data.hostId ?? principal.userId, tx);
    const visit = await tx.gateVisit.create({
      data: {
        companyId: principal.companyId,
        visitorName: data.visitorName,
        visitorPhone: data.visitorPhone,
        visitorCompany: data.visitorCompany,
        purpose: data.purpose,
        hostId: host.id,
        expectedAt,
        source: forOther ? 'DESK' : 'HOST',
        createdById: principal.userId,
      },
    });
    if (forOther) {
      await notify(
        {
          userIds: [host.id],
          title: `Visitor scheduled: ${visitorLabel(visit)}`,
          body: `The front desk expects ${visit.visitorName} for you at ${formatWhen(expectedAt, now)}. Purpose: ${visit.purpose}.`,
          link: '/gate/my-visitors',
        },
        tx,
      );
    }
    await audit({ actorId: principal.userId, module: 'gate', action: 'gate.visit.scheduled', entityType: 'GateVisit', entityId: visit.id, diff: { hostId: host.id, expectedAt: expectedAt.toISOString(), source: visit.source } }, tx);
    return visit;
  });
}

/** A visitor who arrived without notice: logged and checked in at once, and the host is told. */
export async function logWalkIn(principal: Principal, input: WalkInInput, now: Date = new Date()) {
  assertCan(principal, 'gate.desk');
  const data = walkInSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const host = await loadActiveHost(principal, data.hostId, tx);
    const visit = await tx.gateVisit.create({
      data: {
        companyId: principal.companyId,
        visitorName: data.visitorName,
        visitorPhone: data.visitorPhone,
        visitorCompany: data.visitorCompany,
        purpose: data.purpose,
        hostId: host.id,
        expectedAt: now,
        status: 'CHECKED_IN',
        checkedInAt: now,
        source: 'WALK_IN',
        createdById: principal.userId,
      },
    });
    await notifyArrival(visit, tx);
    await audit({ actorId: principal.userId, module: 'gate', action: 'gate.visit.walk_in', entityType: 'GateVisit', entityId: visit.id, diff: { hostId: host.id } }, tx);
    return visit;
  });
}

async function notifyArrival(visit: { hostId: string; visitorName: string; visitorCompany: string | null; purpose: string }, tx: Tx) {
  await notify(
    {
      userIds: [visit.hostId],
      title: `${visitorLabel(visit)} is at reception`,
      body: `Purpose: ${visit.purpose}. Let the front desk know if you are coming down.`,
      link: '/gate/my-visitors',
    },
    tx,
  );
}

// ---------------------------------------------------------------- desk actions

export async function checkIn(principal: Principal, visitId: string, now: Date = new Date()) {
  assertCan(principal, 'gate.desk');
  const visit = await loadVisibleVisit(principal, visitId);
  return prisma.$transaction(async (tx) => {
    await transition(tx, visit.id, 'EXPECTED', { status: 'CHECKED_IN', checkedInAt: now }, 'Only an expected visitor can be checked in.');
    await notifyArrival(visit, tx);
    await audit({ actorId: principal.userId, module: 'gate', action: 'gate.visit.checked_in', entityType: 'GateVisit', entityId: visit.id }, tx);
  });
}

export async function checkOut(principal: Principal, visitId: string, now: Date = new Date()) {
  assertCan(principal, 'gate.desk');
  const visit = await loadVisibleVisit(principal, visitId);
  return prisma.$transaction(async (tx) => {
    await transition(tx, visit.id, 'CHECKED_IN', { status: 'CHECKED_OUT', checkedOutAt: now }, 'Only a visitor who is inside can be checked out.');
    await audit({ actorId: principal.userId, module: 'gate', action: 'gate.visit.checked_out', entityType: 'GateVisit', entityId: visit.id }, tx);
  });
}

/** The desk cancels any expected visit; an employee cancels the ones to them. */
export async function cancelVisit(principal: Principal, visitId: string, now: Date = new Date()) {
  const visit = await loadVisibleVisit(principal, visitId);
  const desk = isDesk(principal);
  if (!desk && visit.hostId !== principal.userId) throw new ForbiddenError('Only the front desk or the person being visited can cancel this visit.');
  return prisma.$transaction(async (tx) => {
    await transition(tx, visit.id, 'EXPECTED', { status: 'CANCELLED', cancelledAt: now }, 'Only a visit that has not started can be cancelled.');
    if (visit.hostId !== principal.userId) {
      await notify(
        { userIds: [visit.hostId], title: `Visit cancelled: ${visitorLabel(visit)}`, body: `The front desk cancelled the visit expected at ${formatWhen(visit.expectedAt, now)}.`, link: '/gate/my-visitors' },
        tx,
      );
    }
    await audit({ actorId: principal.userId, module: 'gate', action: 'gate.visit.cancelled', entityType: 'GateVisit', entityId: visit.id }, tx);
  });
}

// ---------------------------------------------------------------- host reply

/** The host answers the arrival alert; the front desk sees the answer on its screen. */
export async function replyToVisitor(principal: Principal, visitId: string, input: ReplyInput, now: Date = new Date()) {
  const data = replySchema.parse(input);
  const visit = await loadVisibleVisit(principal, visitId);
  if (visit.hostId !== principal.userId) throw new ForbiddenError('Only the person being visited can reply.');
  if (visit.status !== 'CHECKED_IN') throw new DomainError('This visitor is no longer at reception.');
  return prisma.$transaction(async (tx) => {
    await tx.gateVisit.update({ where: { id: visit.id }, data: { hostReply: data.reply, hostReplyNote: data.note, hostRepliedAt: now } });
    await notify(
      {
        userIds: (await deskUserIds(principal.companyId, tx)).filter((id) => id !== principal.userId),
        title: `${principal.fullName}: ${REPLY_LABEL[data.reply]}`,
        body: `For ${visitorLabel(visit)}.${data.note ? ` "${data.note}"` : ''}`,
        link: '/gate',
      },
      tx,
    );
    await audit({ actorId: principal.userId, module: 'gate', action: 'gate.visit.replied', entityType: 'GateVisit', entityId: visit.id, diff: { reply: data.reply } }, tx);
  });
}

// ---------------------------------------------------------------- reads

/** The front desk's day: who is expected, who is inside, who has left, and what is coming. */
export async function getDesk(principal: Principal, now: Date = new Date()) {
  assertCan(principal, 'gate.desk');
  const { start, end } = istDayRange(istDateString(now));
  const companyId = principal.companyId;
  const [expected, inside, left, upcoming] = await Promise.all([
    prisma.gateVisit.findMany({ where: { companyId, status: 'EXPECTED', expectedAt: { gte: start, lt: end } }, include: visitInclude, orderBy: { expectedAt: 'asc' } }),
    prisma.gateVisit.findMany({ where: { companyId, status: 'CHECKED_IN' }, include: visitInclude, orderBy: { checkedInAt: 'asc' } }),
    prisma.gateVisit.findMany({ where: { companyId, status: 'CHECKED_OUT', checkedOutAt: { gte: start, lt: end } }, include: visitInclude, orderBy: { checkedOutAt: 'desc' } }),
    prisma.gateVisit.findMany({ where: { companyId, status: 'EXPECTED', expectedAt: { gte: end } }, include: visitInclude, orderBy: { expectedAt: 'asc' }, take: 50 }),
  ]);
  return { expected, inside, left, upcoming };
}

/** Active employees to pick as the host. */
export async function listHosts(principal: Principal) {
  assertCan(principal, 'gate.desk');
  return prisma.user.findMany({
    where: { companyId: principal.companyId, status: 'ACTIVE' },
    select: { id: true, fullName: true, designation: true, employeeCode: true },
    orderBy: { fullName: 'asc' },
  });
}

/** The full register for a date range (by expected or arrival time), newest first. */
export async function listRegister(principal: Principal, filter: { from: string; to: string; q?: string | null }) {
  if (!seesRegister(principal)) throw new ForbiddenError('Only the front desk and Directors can see the visitor register.');
  const { from, to, q } = registerFilterSchema.parse(filter);
  if (from > to) throw new DomainError('The start date is after the end date.');
  const contains = q ? { contains: q, mode: 'insensitive' as const } : undefined;
  return prisma.gateVisit.findMany({
    where: {
      companyId: principal.companyId,
      expectedAt: { gte: istDayRange(from).start, lt: istDayRange(to).end },
      ...(contains
        ? { OR: [{ visitorName: contains }, { visitorCompany: contains }, { visitorPhone: contains }, { purpose: contains }, { host: { fullName: contains } }] }
        : {}),
    },
    include: visitInclude,
    orderBy: { expectedAt: 'desc' },
    take: 500,
  });
}

/** An employee's own visitors: at reception now, coming up, and the last 30 days. */
export async function listMyVisits(principal: Principal, now: Date = new Date()) {
  const where = { companyId: principal.companyId, hostId: principal.userId };
  const { start } = istDayRange(istDateString(now));
  const [atReception, upcoming, recent] = await Promise.all([
    prisma.gateVisit.findMany({ where: { ...where, status: 'CHECKED_IN' }, include: visitInclude, orderBy: { checkedInAt: 'desc' } }),
    prisma.gateVisit.findMany({ where: { ...where, status: 'EXPECTED', expectedAt: { gte: start } }, include: visitInclude, orderBy: { expectedAt: 'asc' } }),
    prisma.gateVisit.findMany({
      where: { ...where, expectedAt: { gte: new Date(start.getTime() - 30 * 24 * 60 * 60 * 1000) }, OR: [{ status: { in: ['CHECKED_OUT', 'CANCELLED'] } }, { status: 'EXPECTED', expectedAt: { lt: start } }] },
      include: visitInclude,
      orderBy: { expectedAt: 'desc' },
      take: 100,
    }),
  ]);
  return { atReception, upcoming, recent };
}

/** Visitors at reception for this person that they have not answered yet: the alert on every page. */
export async function listWaitingForMe(principal: Principal) {
  return prisma.gateVisit.findMany({
    where: { companyId: principal.companyId, hostId: principal.userId, status: 'CHECKED_IN', hostReply: null },
    select: { id: true, visitorName: true, visitorCompany: true, purpose: true, checkedInAt: true },
    orderBy: { checkedInAt: 'asc' },
  });
}
