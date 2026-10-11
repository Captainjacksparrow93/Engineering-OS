import type { HrLeaveStatus, Prisma } from '@prisma/client';
import { prisma, type Tx } from '@/core/db/prisma';
import { audit } from '@/core/audit/audit';
import { notify } from '@/core/notifications/notify';
import { hasPermissionAnywhere } from '@/core/rbac/engine';
import { DomainError, ForbiddenError, NotFoundError } from '@/core/rbac/errors';
import { assertCan } from '@/core/rbac/guard';
import type { Principal } from '@/core/rbac/types';
import { addDays, formatDate, todayInIndia } from '@/core/utils/dates';
import { dayDate, dayKey, leaveDays } from '../domain/time';
import {
  allocationSchema,
  decisionSchema,
  holidaySchema,
  leaveRequestSchema,
  leaveTypeSchema,
  type AllocationInput,
  type DecisionInput,
  type HolidayInput,
  type LeaveRequestInput,
  type LeaveTypeInput,
} from '../validation';
import { activeManagerId, canApproveAsHead, headApproverIds, type Applicant } from './approvers';
import { directoryScope } from './employee.service';

/**
 * Leave (plan 020, phase 2).
 *
 * An employee applies; the reporting manager approves, then the department head. On the final
 * approval a `core_leaves` row is written, which Project Management already reads for capacity,
 * so PM follows HR leave with no change on its side. Balances run per calendar year.
 */

export const OPEN_STATUSES: HrLeaveStatus[] = ['PENDING_MANAGER', 'PENDING_HEAD'];
const HOLDING: HrLeaveStatus[] = ['PENDING_MANAGER', 'PENDING_HEAD', 'APPROVED'];
const BACKDATE_DAYS = 60;

export const managesTime = (principal: Principal) => hasPermissionAnywhere(principal, 'hr.attendance.manage');

const yearRange = (year: number) => ({ start: dayDate(`${year}-01-01`), end: dayDate(`${year}-12-31`) });
const num = (d: Prisma.Decimal | number | null) => (d === null ? null : Number(d));

export async function holidaySet(companyId: string, from: Date, to: Date, tx: Tx = prisma): Promise<Set<string>> {
  const rows = await tx.hrHoliday.findMany({ where: { companyId, date: { gte: from, lte: to } }, select: { date: true } });
  return new Set(rows.map((h) => dayKey(h.date)));
}

// ---------------------------------------------------------------- balances

/** Entitled, used, pending and left, per active leave type, for one employee and year. */
export async function leaveBalances(companyId: string, userId: string, year: number, tx: Tx = prisma) {
  const { start, end } = yearRange(year);
  const [types, allocations, requests] = await Promise.all([
    tx.hrLeaveType.findMany({ where: { companyId, active: true }, orderBy: { code: 'asc' } }),
    tx.hrLeaveAllocation.findMany({ where: { userId, year } }),
    tx.hrLeaveRequest.groupBy({ by: ['leaveTypeId', 'status'], where: { userId, status: { in: HOLDING }, startDate: { gte: start, lte: end } }, _sum: { days: true } }),
  ]);
  return types.map((type) => {
    const allocation = allocations.find((a) => a.leaveTypeId === type.id);
    const sum = (statuses: HrLeaveStatus[]) => requests.filter((r) => r.leaveTypeId === type.id && statuses.includes(r.status)).reduce((t, r) => t + Number(r._sum.days ?? 0), 0);
    const entitled = allocation ? Number(allocation.days) : num(type.annualDays);
    const used = sum(['APPROVED']);
    const pending = sum(OPEN_STATUSES);
    return {
      type: { id: type.id, code: type.code, name: type.name, paid: type.paid, allowHalfDay: type.allowHalfDay },
      entitled,
      allocated: !!allocation,
      used,
      pending,
      left: entitled === null ? null : entitled - used - pending,
    };
  });
}

// ---------------------------------------------------------------- applying

const requestInclude = {
  leaveType: { select: { id: true, code: true, name: true } },
  user: { select: { id: true, fullName: true, employeeCode: true, departmentId: true, managerId: true, department: { select: { name: true } } } },
  managerBy: { select: { fullName: true } },
  headBy: { select: { fullName: true } },
} satisfies Prisma.HrLeaveRequestInclude;
export type LeaveRow = Prisma.HrLeaveRequestGetPayload<{ include: typeof requestInclude }>;

const describe = (r: { startDate: Date; endDate: Date; halfDay: boolean; days: Prisma.Decimal | number }) =>
  `${formatDate(r.startDate, { forceYear: true })}${r.endDate.getTime() !== r.startDate.getTime() ? ` to ${formatDate(r.endDate, { forceYear: true })}` : ''}${r.halfDay ? ' (half day)' : ''}, ${Number(r.days)} day${Number(r.days) === 1 ? '' : 's'}`;

async function notifyNextApprovers(companyId: string, request: { id: string; status: HrLeaveStatus; userId: string; startDate: Date; endDate: Date; halfDay: boolean; days: Prisma.Decimal | number }, applicant: Applicant & { fullName: string }, typeName: string, tx: Tx) {
  const userIds = request.status === 'PENDING_MANAGER' ? [applicant.managerId!] : await headApproverIds(companyId, applicant, tx);
  await notify({ userIds, title: `Leave to approve: ${applicant.fullName}`, body: `${typeName}, ${describe(request)}.`, link: '/hrms/approvals' }, tx);
}

export async function applyLeave(principal: Principal, input: LeaveRequestInput, now: Date = new Date()) {
  const data = leaveRequestSchema.parse(input);
  const start = dayDate(data.startDate);
  const end = dayDate(data.endDate);
  const today = todayInIndia(now);
  if (end < start) throw new DomainError('The last day cannot be before the first day.');
  if (start.getUTCFullYear() !== end.getUTCFullYear()) throw new DomainError('Leave cannot cross 31 December. Apply for each year separately.');
  if (start < addDays(today, -BACKDATE_DAYS)) throw new DomainError(`Leave can be applied up to ${BACKDATE_DAYS} days after it was taken.`);
  if (data.halfDay && start.getTime() !== end.getTime()) throw new DomainError('A half day is a single day: make the first and last day the same.');

  return prisma.$transaction(async (tx) => {
    const type = await tx.hrLeaveType.findFirst({ where: { id: data.leaveTypeId, companyId: principal.companyId, active: true } });
    if (!type) throw new NotFoundError('That leave type was not found.');
    if (data.halfDay && !type.allowHalfDay) throw new DomainError(`${type.name} cannot be taken as a half day.`);
    const days = leaveDays(start, end, data.halfDay, await holidaySet(principal.companyId, start, end, tx));
    if (days === 0) throw new DomainError('Those dates are all Sundays or holidays, so no leave is needed.');

    const overlap = await tx.hrLeaveRequest.findFirst({ where: { userId: principal.userId, status: { in: HOLDING }, startDate: { lte: end }, endDate: { gte: start } } });
    if (overlap) throw new DomainError(`You already have leave from ${formatDate(overlap.startDate)} to ${formatDate(overlap.endDate)}. Cancel it first to change the dates.`);

    const balance = (await leaveBalances(principal.companyId, principal.userId, start.getUTCFullYear(), tx)).find((b) => b.type.id === type.id);
    if (balance?.left != null && days > balance.left) {
      throw new DomainError(`You have ${balance.left} day${balance.left === 1 ? '' : 's'} of ${type.name.toLowerCase()} left in ${start.getUTCFullYear()}. Pick fewer days or another leave type.`);
    }

    const applicant = await tx.user.findUniqueOrThrow({ where: { id: principal.userId }, select: { id: true, fullName: true, departmentId: true, managerId: true } });
    const managerId = await activeManagerId(applicant, tx);
    const request = await tx.hrLeaveRequest.create({
      data: {
        companyId: principal.companyId,
        userId: principal.userId,
        leaveTypeId: type.id,
        startDate: start,
        endDate: end,
        halfDay: data.halfDay,
        days,
        reason: data.reason,
        status: managerId ? 'PENDING_MANAGER' : 'PENDING_HEAD',
      },
    });
    await notifyNextApprovers(principal.companyId, request, { ...applicant, managerId }, type.name, tx);
    await audit({ actorId: principal.userId, module: 'hr', action: 'hr.leave.applied', entityType: 'HrLeaveRequest', entityId: request.id, diff: { type: type.code, start: data.startDate, end: data.endDate, days } }, tx);
    return request;
  });
}

// ---------------------------------------------------------------- deciding

/** Which step, if any, this principal can decide on this request right now. */
export function decisionStep(principal: Principal, request: { status: HrLeaveStatus; user: Applicant }): 'MANAGER' | 'HEAD' | null {
  if (request.status === 'PENDING_MANAGER' && request.user.managerId === principal.userId && request.user.id !== principal.userId) return 'MANAGER';
  if (request.status === 'PENDING_HEAD' && canApproveAsHead(principal, request.user)) return 'HEAD';
  return null;
}

async function moveRequest(tx: Tx, id: string, from: HrLeaveStatus, data: Prisma.HrLeaveRequestUncheckedUpdateManyInput) {
  const { count } = await tx.hrLeaveRequest.updateMany({ where: { id, status: from }, data });
  if (count === 0) throw new DomainError('Someone has already acted on this request. Refresh to see where it is.');
}

export async function decideLeave(principal: Principal, requestId: string, input: DecisionInput, now: Date = new Date()) {
  const data = decisionSchema.parse(input);
  const request = await prisma.hrLeaveRequest.findFirst({ where: { id: requestId, companyId: principal.companyId }, include: requestInclude });
  if (!request) throw new NotFoundError('Leave request not found.');
  const step = decisionStep(principal, request);
  if (!step) throw new ForbiddenError(request.status === 'PENDING_MANAGER' ? 'This request is waiting for the reporting manager.' : OPEN_STATUSES.includes(request.status) ? 'Only the department head or HR can approve this step.' : 'This request is already decided.');

  return prisma.$transaction(async (tx) => {
    const stamp = step === 'MANAGER' ? { managerById: principal.userId, managerAt: now, managerNote: data.note } : { headById: principal.userId, headAt: now, headNote: data.note };
    if (data.decision === 'REJECT') {
      await moveRequest(tx, request.id, request.status, { ...stamp, status: 'REJECTED' });
      await notify({ userIds: [request.userId], title: `Leave not approved: ${request.leaveType.name}`, body: `${describe(request)}.${data.note ? ` Note: ${data.note}` : ''}`, link: '/hrms/leave' }, tx);
    } else {
      // A manager who is also the department head (or HR) approves both steps at once.
      const final = step === 'HEAD' || canApproveAsHead(principal, request.user);
      if (final) {
        const leave = await tx.leave.create({ data: { userId: request.userId, startDate: request.startDate, endDate: request.endDate, reason: `${request.leaveType.name}: ${request.reason}`.slice(0, 300), status: 'APPROVED', sourceModule: 'hrms' } });
        const headStamp = step === 'MANAGER' ? { headById: principal.userId, headAt: now, headNote: data.note } : {};
        await moveRequest(tx, request.id, request.status, { ...stamp, ...headStamp, status: 'APPROVED', coreLeaveId: leave.id });
        await notify({ userIds: [request.userId], title: `Leave approved: ${request.leaveType.name}`, body: `${describe(request)}.`, link: '/hrms/leave' }, tx);
      } else {
        await moveRequest(tx, request.id, request.status, { ...stamp, status: 'PENDING_HEAD' });
        await notifyNextApprovers(principal.companyId, { ...request, status: 'PENDING_HEAD' }, { ...request.user }, request.leaveType.name, tx);
      }
    }
    await audit({ actorId: principal.userId, module: 'hr', action: data.decision === 'APPROVE' ? 'hr.leave.approved' : 'hr.leave.rejected', entityType: 'HrLeaveRequest', entityId: request.id, diff: { step, note: data.note } }, tx);
  });
}

/**
 * The employee cancels their own leave before it starts (or while still pending); HR cancels any.
 * Cancelling approved leave also cancels the `core_leaves` row, so PM gets the capacity back.
 */
export async function cancelLeave(principal: Principal, requestId: string, now: Date = new Date()) {
  const request = await prisma.hrLeaveRequest.findFirst({ where: { id: requestId, companyId: principal.companyId }, include: requestInclude });
  if (!request) throw new NotFoundError('Leave request not found.');
  const own = request.userId === principal.userId;
  const hr = managesTime(principal);
  if (!own && !hr) throw new NotFoundError('Leave request not found.');
  if (!HOLDING.includes(request.status)) throw new DomainError('Only pending or approved leave can be cancelled.');
  if (own && !hr && request.status === 'APPROVED' && request.startDate <= todayInIndia(now)) throw new DomainError('This leave has already started. Ask HR to change it.');

  await prisma.$transaction(async (tx) => {
    await moveRequest(tx, request.id, request.status, { status: 'CANCELLED', cancelledAt: now });
    if (request.coreLeaveId) await tx.leave.updateMany({ where: { id: request.coreLeaveId }, data: { status: 'CANCELLED' } });
    if (!own) await notify({ userIds: [request.userId], title: `Leave cancelled by HR: ${request.leaveType.name}`, body: `${describe(request)}.`, link: '/hrms/leave' }, tx);
    await audit({ actorId: principal.userId, module: 'hr', action: 'hr.leave.cancelled', entityType: 'HrLeaveRequest', entityId: request.id, diff: { was: request.status } }, tx);
  });
}

// ---------------------------------------------------------------- lists

export async function myLeave(principal: Principal, year: number) {
  const { start, end } = yearRange(year);
  const [balances, requests] = await Promise.all([
    leaveBalances(principal.companyId, principal.userId, year),
    prisma.hrLeaveRequest.findMany({ where: { userId: principal.userId, startDate: { gte: start, lte: end } }, include: requestInclude, orderBy: { startDate: 'desc' } }),
  ]);
  return { balances, requests };
}

/** Requests waiting on this principal: as reporting manager, or as department head / HR. */
export async function leaveToDecide(principal: Principal) {
  const candidates = await prisma.hrLeaveRequest.findMany({
    where: {
      companyId: principal.companyId,
      userId: { not: principal.userId },
      OR: [{ status: 'PENDING_MANAGER', user: { managerId: principal.userId } }, ...(hasPermissionAnywhere(principal, 'hr.leave.approve') ? [{ status: 'PENDING_HEAD' as const }] : [])],
    },
    include: requestInclude,
    orderBy: { startDate: 'asc' },
  });
  return candidates.filter((r) => decisionStep(principal, r) !== null);
}

/**
 * Leave across the people this principal may see (HR and Directors everyone, department heads
 * their department): who is off in a date range, plus requests still pending.
 */
export async function teamLeave(principal: Principal, from: Date, to: Date) {
  const scope = directoryScope(principal);
  if (!scope) throw new ForbiddenError('Team leave is for HR, Directors and department heads.');
  return prisma.hrLeaveRequest.findMany({
    where: { companyId: principal.companyId, status: { in: HOLDING }, startDate: { lte: to }, endDate: { gte: from }, user: scope },
    include: requestInclude,
    orderBy: [{ startDate: 'asc' }, { user: { fullName: 'asc' } }],
  });
}

// ---------------------------------------------------------------- HR settings

export async function listLeaveTypes(principal: Principal) {
  return prisma.hrLeaveType.findMany({ where: { companyId: principal.companyId }, orderBy: [{ active: 'desc' }, { code: 'asc' }] });
}

export async function saveLeaveType(principal: Principal, input: LeaveTypeInput) {
  assertCan(principal, 'hr.attendance.manage');
  const data = leaveTypeSchema.parse(input);
  const fields = { code: data.code, name: data.name, annualDays: data.annualDays, paid: data.paid, allowHalfDay: data.allowHalfDay, active: data.active };
  const clash = await prisma.hrLeaveType.findFirst({ where: { companyId: principal.companyId, code: data.code, ...(data.id ? { id: { not: data.id } } : {}) } });
  if (clash) throw new DomainError(`Another leave type already uses the code ${data.code}.`);
  if (data.id) {
    const { count } = await prisma.hrLeaveType.updateMany({ where: { id: data.id, companyId: principal.companyId }, data: fields });
    if (count === 0) throw new NotFoundError('Leave type not found.');
  } else {
    await prisma.hrLeaveType.create({ data: { ...fields, companyId: principal.companyId } });
  }
  await audit({ actorId: principal.userId, module: 'hr', action: 'hr.leave_type.saved', entityType: 'HrLeaveType', entityId: data.id ?? data.code, diff: { ...fields } });
}

/** Sets one employee's days for a leave type and year (joined mid-year, carry forward, etc.). */
export async function setAllocation(principal: Principal, input: AllocationInput) {
  assertCan(principal, 'hr.attendance.manage');
  const data = allocationSchema.parse(input);
  const [user, type] = await Promise.all([
    prisma.user.findFirst({ where: { id: data.userId, companyId: principal.companyId }, select: { id: true } }),
    prisma.hrLeaveType.findFirst({ where: { id: data.leaveTypeId, companyId: principal.companyId }, select: { id: true } }),
  ]);
  if (!user) throw new NotFoundError('Employee not found.');
  if (!type) throw new NotFoundError('Leave type not found.');
  await prisma.$transaction(async (tx) => {
    await tx.hrLeaveAllocation.upsert({
      where: { userId_leaveTypeId_year: { userId: data.userId, leaveTypeId: data.leaveTypeId, year: data.year } },
      create: { userId: data.userId, leaveTypeId: data.leaveTypeId, year: data.year, days: data.days, note: data.note },
      update: { days: data.days, note: data.note },
    });
    await audit({ actorId: principal.userId, module: 'hr', action: 'hr.leave.allocated', entityType: 'User', entityId: data.userId, diff: { leaveTypeId: data.leaveTypeId, year: data.year, days: data.days, note: data.note } }, tx);
  });
}

export async function listHolidays(principal: Principal, year: number) {
  const { start, end } = yearRange(year);
  return prisma.hrHoliday.findMany({ where: { companyId: principal.companyId, date: { gte: start, lte: end } }, orderBy: { date: 'asc' } });
}

export async function addHoliday(principal: Principal, input: HolidayInput) {
  assertCan(principal, 'hr.attendance.manage');
  const data = holidaySchema.parse(input);
  const date = dayDate(data.date);
  const exists = await prisma.hrHoliday.findUnique({ where: { companyId_date: { companyId: principal.companyId, date } } });
  if (exists) throw new DomainError(`${formatDate(date, { forceYear: true })} is already a holiday (${exists.name}).`);
  const holiday = await prisma.hrHoliday.create({ data: { companyId: principal.companyId, date, name: data.name } });
  await audit({ actorId: principal.userId, module: 'hr', action: 'hr.holiday.added', entityType: 'HrHoliday', entityId: holiday.id, diff: { date: data.date, name: data.name } });
  return holiday;
}

/** Removing a holiday does not change leave already applied for; HR can adjust those by hand. */
export async function removeHoliday(principal: Principal, holidayId: string) {
  assertCan(principal, 'hr.attendance.manage');
  const holiday = await prisma.hrHoliday.findFirst({ where: { id: holidayId, companyId: principal.companyId } });
  if (!holiday) throw new NotFoundError('Holiday not found.');
  await prisma.hrHoliday.delete({ where: { id: holiday.id } });
  await audit({ actorId: principal.userId, module: 'hr', action: 'hr.holiday.removed', entityType: 'HrHoliday', entityId: holiday.id, diff: { date: dayKey(holiday.date), name: holiday.name } });
}
