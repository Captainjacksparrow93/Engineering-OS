import type { HrSettings, Prisma } from '@prisma/client';
import { prisma, type Tx } from '@/core/db/prisma';
import { audit } from '@/core/audit/audit';
import { notify } from '@/core/notifications/notify';
import { DomainError, ForbiddenError, NotFoundError } from '@/core/rbac/errors';
import { assertCan } from '@/core/rbac/guard';
import type { Principal } from '@/core/rbac/types';
import { addDays, formatDate, todayInIndia } from '@/core/utils/dates';
import { dayDate, dayKey, dayStatus, eachDay, istInstant, istMinutes, parseAttendanceCsv, presentValue, type DayResult } from '../domain/time';
import { decisionSchema, regularisationSchema, shiftSchema, type DecisionInput, type RegularisationInput, type ShiftInput } from '../validation';
import { activeManagerId, canApproveAsHead, headApproverIds } from './approvers';
import { directoryScope } from './employee.service';
import { managesTime } from './leave.service';

/**
 * Attendance (plan 020, phase 2). HR imports the biometric machine's CSV export; each employee
 * gets one row per day (first in, last out). Day status (present, half day, late, absent,
 * leave, holiday) is worked out when shown, from the punches, approved leave, holidays and the
 * company shift, so changing the shift or a holiday re-reads every month correctly.
 */

const MAX_CSV_BYTES = 2 * 1024 * 1024;
const REGULARISE_DAYS = 31;

export async function getSettings(companyId: string, tx: Tx = prisma): Promise<HrSettings> {
  return tx.hrSettings.upsert({ where: { companyId }, create: { companyId }, update: {} });
}

export async function saveShift(principal: Principal, input: ShiftInput) {
  assertCan(principal, 'hr.attendance.manage');
  const data = shiftSchema.parse(input);
  const [h, m] = data.shiftStart.split(':').map(Number) as [number, number];
  const fields = { shiftStartMinutes: h * 60 + m, graceMinutes: data.graceMinutes, fullDayMinutes: Math.round(data.fullDayHours * 60), halfDayMinutes: Math.round(data.halfDayHours * 60) };
  await prisma.hrSettings.upsert({ where: { companyId: principal.companyId }, create: { companyId: principal.companyId, ...fields }, update: fields });
  await audit({ actorId: principal.userId, module: 'hr', action: 'hr.shift.saved', entityType: 'HrSettings', entityId: principal.companyId, diff: fields });
}

// ---------------------------------------------------------------- import

/**
 * Imports a biometric export. Employees are matched on their biometric number (HR fills it on
 * the employee record) or, failing that, their employee code. Importing the same file twice
 * changes nothing; a day an approved correction already fixed is left alone.
 */
export async function importAttendance(principal: Principal, fileName: string, text: string) {
  assertCan(principal, 'hr.attendance.manage');
  if (!text.trim()) throw new DomainError('The file is empty.');
  if (text.length > MAX_CSV_BYTES) throw new DomainError('The file is larger than 2 MB. Export one month at a time.');
  const parsed = parseAttendanceCsv(text);
  if (parsed.days.length === 0) throw new DomainError(parsed.problems[0] ?? 'No attendance rows were found in the file.');

  const people = await prisma.user.findMany({
    where: { companyId: principal.companyId },
    select: { id: true, employeeCode: true, hrProfile: { select: { biometricId: true } } },
  });
  const byCode = new Map<string, string>();
  for (const p of people) byCode.set(p.employeeCode.toLowerCase(), p.id);
  for (const p of people) if (p.hrProfile?.biometricId) byCode.set(p.hrProfile.biometricId.toLowerCase(), p.id);

  const problems = [...parsed.problems];
  const unknown = new Set<string>();
  let unknownDays = 0;
  const rows = parsed.days.flatMap((d) => {
    const userId = byCode.get(d.code.toLowerCase());
    if (!userId) {
      unknown.add(d.code);
      unknownDays += 1;
      return [];
    }
    return [{ userId, date: dayDate(d.date), firstIn: d.inMinutes == null ? null : istInstant(d.date, d.inMinutes), lastOut: d.outMinutes == null ? null : istInstant(d.date, d.outMinutes) }];
  });
  if (unknown.size) problems.unshift(`No employee has the code or biometric number ${[...unknown].slice(0, 20).join(', ')}${unknown.size > 20 ? ` and ${unknown.size - 20} more` : ''}. Add the biometric number on their HR record and import again.`);
  if (rows.length === 0) throw new DomainError(problems[0]!);

  const dates = rows.map((r) => r.date.getTime());
  const fromDate = new Date(Math.min(...dates));
  const toDate = new Date(Math.max(...dates));
  return prisma.$transaction(
    async (tx) => {
      const existing = await tx.hrAttendance.findMany({ where: { userId: { in: [...new Set(rows.map((r) => r.userId))] }, date: { gte: fromDate, lte: toDate } }, select: { userId: true, date: true, source: true } });
      const corrected = new Set(existing.filter((e) => e.source === 'REGULARISED').map((e) => `${e.userId}|${dayKey(e.date)}`));
      const run = await tx.hrAttendanceImport.create({
        data: { companyId: principal.companyId, fileName: fileName.slice(0, 120), rows: parsed.rows, days: 0, skipped: 0, problems: [], fromDate, toDate, importedById: principal.userId },
      });
      let days = 0;
      for (const r of rows) {
        if (corrected.has(`${r.userId}|${dayKey(r.date)}`)) continue;
        await tx.hrAttendance.upsert({
          where: { userId_date: { userId: r.userId, date: r.date } },
          create: { ...r, source: 'IMPORT', importId: run.id },
          update: { firstIn: r.firstIn, lastOut: r.lastOut, importId: run.id },
        });
        days += 1;
      }
      // Rows the file could not use: unreadable rows plus employee-days nobody matched.
      const skipped = parsed.problems.length + unknownDays;
      const result = await tx.hrAttendanceImport.update({ where: { id: run.id }, data: { days, skipped, problems: problems.slice(0, 50) } });
      await audit({ actorId: principal.userId, module: 'hr', action: 'hr.attendance.imported', entityType: 'HrAttendanceImport', entityId: run.id, diff: { fileName, rows: parsed.rows, days, from: dayKey(fromDate), to: dayKey(toDate) } }, tx);
      return { ...result, keptCorrections: rows.length - days };
    },
    { timeout: 60_000 },
  );
}

export async function listImports(principal: Principal) {
  assertCan(principal, 'hr.attendance.manage');
  return prisma.hrAttendanceImport.findMany({ where: { companyId: principal.companyId }, include: { importedBy: { select: { fullName: true } } }, orderBy: { createdAt: 'desc' }, take: 10 });
}

// ---------------------------------------------------------------- month views

export interface DayRow extends DayResult {
  date: Date;
  inMinutes: number | null;
  outMinutes: number | null;
  corrected: boolean;
  holidayName: string | null;
  leaveType: string | null;
}

export interface MonthSummary {
  present: number;
  absent: number;
  late: number;
  leave: number;
  missedPunch: number;
  workedMinutes: number;
  overtimeMinutes: number;
}

/** `2026-10` → first and last day of that month. */
export function monthRange(month: string) {
  const start = dayDate(`${month}-01`);
  const end = addDays(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1)), -1);
  return { start, end };
}

/** Builds day rows for many employees at once from a handful of queries. */
async function buildMonth(companyId: string, userIds: string[], month: string, now: Date) {
  const { start, end } = monthRange(month);
  const today = todayInIndia(now);
  const [settings, holidays, punches, leaves, halfDays, recordedDays] = await Promise.all([
    getSettings(companyId),
    prisma.hrHoliday.findMany({ where: { companyId, date: { gte: start, lte: end } } }),
    prisma.hrAttendance.findMany({ where: { userId: { in: userIds }, date: { gte: start, lte: end } } }),
    // Every approved leave PM knows about (HR leave writes these too).
    prisma.leave.findMany({ where: { userId: { in: userIds }, status: 'APPROVED', startDate: { lte: end }, endDate: { gte: start } } }),
    prisma.hrLeaveRequest.findMany({ where: { userId: { in: userIds }, status: 'APPROVED', startDate: { lte: end }, endDate: { gte: start } }, select: { userId: true, startDate: true, endDate: true, halfDay: true, leaveType: { select: { name: true } } } }),
    // Days the machine data covers: before the first import nobody is "absent".
    prisma.hrAttendance.findMany({ where: { user: { companyId }, date: { gte: start, lte: end } }, distinct: ['date'], select: { date: true } }),
  ]);
  const recorded = new Set(recordedDays.map((r) => dayKey(r.date)));
  const holidayName = new Map(holidays.map((h) => [dayKey(h.date), h.name]));
  const punch = new Map(punches.map((p) => [`${p.userId}|${dayKey(p.date)}`, p]));
  const days = eachDay(start, end);

  const result = new Map<string, { rows: DayRow[]; summary: MonthSummary }>();
  for (const userId of userIds) {
    const rows = days.map((date): DayRow => {
      const key = dayKey(date);
      const p = punch.get(`${userId}|${key}`);
      const hr = halfDays.find((l) => l.userId === userId && l.startDate <= date && l.endDate >= date);
      const core = leaves.some((l) => l.userId === userId && l.startDate <= date && l.endDate >= date);
      const leave = hr?.halfDay ? 'HALF' : hr || core ? 'FULL' : null;
      const inMinutes = p?.firstIn ? istMinutes(p.firstIn) : null;
      const outMinutes = p?.lastOut ? istMinutes(p.lastOut) : null;
      const status = dayStatus({ date, today, holiday: holidayName.has(key), leave, recorded: recorded.has(key), inMinutes, outMinutes }, settings);
      return { ...status, date, inMinutes, outMinutes, corrected: p?.source === 'REGULARISED', holidayName: holidayName.get(key) ?? null, leaveType: hr?.leaveType.name ?? (core ? 'Leave' : null) };
    });
    const summary: MonthSummary = {
      present: rows.reduce((t, r) => t + presentValue(r.status), 0),
      absent: rows.filter((r) => r.status === 'ABSENT').length + rows.filter((r) => r.status === 'HALF_DAY').length * 0.5,
      late: rows.filter((r) => r.late).length,
      leave: rows.filter((r) => r.status === 'LEAVE').length + rows.filter((r) => r.status === 'HALF_LEAVE').length * 0.5,
      missedPunch: rows.filter((r) => r.status === 'MISSED_PUNCH').length,
      workedMinutes: rows.reduce((t, r) => t + r.workedMinutes, 0),
      overtimeMinutes: rows.reduce((t, r) => t + r.overtimeMinutes, 0),
    };
    result.set(userId, { rows, summary });
  }
  return { result, settings };
}

/** One employee's month: themselves, or anyone in the principal's directory scope. */
export async function monthAttendance(principal: Principal, userId: string, month: string, now: Date = new Date()) {
  const isSelf = userId === principal.userId;
  const scope = directoryScope(principal);
  const person = await prisma.user.findFirst({
    where: { id: userId, companyId: principal.companyId, ...(isSelf || !scope ? {} : scope) },
    select: { id: true, fullName: true, employeeCode: true, departmentId: true, managerId: true },
  });
  if (!person || (!isSelf && !scope)) throw new NotFoundError('Employee not found.');
  const { result, settings } = await buildMonth(principal.companyId, [person.id], month, now);
  const { start, end } = monthRange(month);
  const regularisations = await prisma.hrRegularisation.findMany({ where: { userId: person.id, date: { gte: start, lte: end } }, orderBy: { createdAt: 'desc' } });
  return { person, settings, ...result.get(person.id)!, regularisations, isSelf };
}

/** Month summary per employee across the principal's directory scope. */
export async function teamAttendance(principal: Principal, month: string, departmentId: string | null = null, now: Date = new Date()) {
  const scope = directoryScope(principal);
  if (!scope) throw new ForbiddenError('Team attendance is for HR, Directors and department heads.');
  const people = await prisma.user.findMany({
    where: { AND: [scope, { status: 'ACTIVE' }, departmentId ? { departmentId } : {}] },
    select: { id: true, fullName: true, employeeCode: true, department: { select: { name: true } } },
    orderBy: { fullName: 'asc' },
  });
  const { result } = await buildMonth(principal.companyId, people.map((p) => p.id), month, now);
  return people.map((p) => ({ ...p, summary: result.get(p.id)!.summary }));
}

// ---------------------------------------------------------------- corrections

/** An employee asks to fix a past day's punches. The manager, department head or HR decides. */
export async function requestRegularisation(principal: Principal, input: RegularisationInput, now: Date = new Date()) {
  const data = regularisationSchema.parse(input);
  const date = dayDate(data.date);
  const today = todayInIndia(now);
  if (date > today) throw new DomainError('You can only correct a day that has started.');
  if (date < addDays(today, -REGULARISE_DAYS)) throw new DomainError(`Corrections are for the last ${REGULARISE_DAYS} days. Ask HR for older ones.`);
  if (data.outTime <= data.inTime) throw new DomainError('The out time must be after the in time.');
  const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

  return prisma.$transaction(async (tx) => {
    const pending = await tx.hrRegularisation.findFirst({ where: { userId: principal.userId, date, status: 'PENDING' } });
    if (pending) throw new DomainError('You already asked to correct this day. Wait for the answer.');
    const reg = await tx.hrRegularisation.create({
      data: { userId: principal.userId, date, firstIn: istInstant(data.date, toMinutes(data.inTime)), lastOut: istInstant(data.date, toMinutes(data.outTime)), reason: data.reason },
    });
    const me = await tx.user.findUniqueOrThrow({ where: { id: principal.userId }, select: { id: true, fullName: true, departmentId: true, managerId: true } });
    const managerId = await activeManagerId(me, tx);
    const userIds = managerId ? [managerId] : await headApproverIds(principal.companyId, me, tx);
    await notify({ userIds, title: `Attendance correction: ${me.fullName}`, body: `${formatDate(date, { forceYear: true })}: ${data.inTime} to ${data.outTime}. ${data.reason}`, link: '/hrms/approvals' }, tx);
    await audit({ actorId: principal.userId, module: 'hr', action: 'hr.attendance.correction_requested', entityType: 'HrRegularisation', entityId: reg.id, diff: { date: data.date, in: data.inTime, out: data.outTime } }, tx);
    return reg;
  });
}

const regInclude = { user: { select: { id: true, fullName: true, employeeCode: true, departmentId: true, managerId: true } } } satisfies Prisma.HrRegularisationInclude;

function canDecideRegularisation(principal: Principal, user: { id: string; departmentId: string | null; managerId: string | null }) {
  if (user.id === principal.userId) return false;
  return user.managerId === principal.userId || canApproveAsHead(principal, user) || managesTime(principal);
}

export async function regularisationsToDecide(principal: Principal) {
  const pending = await prisma.hrRegularisation.findMany({ where: { status: 'PENDING', user: { companyId: principal.companyId } }, include: regInclude, orderBy: { date: 'asc' } });
  return pending.filter((r) => canDecideRegularisation(principal, r.user));
}

export async function decideRegularisation(principal: Principal, id: string, input: DecisionInput, now: Date = new Date()) {
  const data = decisionSchema.parse(input);
  const reg = await prisma.hrRegularisation.findFirst({ where: { id, user: { companyId: principal.companyId } }, include: regInclude });
  if (!reg) throw new NotFoundError('Correction not found.');
  if (!canDecideRegularisation(principal, reg.user)) throw new ForbiddenError('Only the manager, the department head or HR can decide this.');
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.hrRegularisation.updateMany({ where: { id: reg.id, status: 'PENDING' }, data: { status: data.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', decidedById: principal.userId, decidedAt: now, note: data.note } });
    if (count === 0) throw new DomainError('Someone has already decided this correction.');
    if (data.decision === 'APPROVE') {
      await tx.hrAttendance.upsert({
        where: { userId_date: { userId: reg.userId, date: reg.date } },
        create: { userId: reg.userId, date: reg.date, firstIn: reg.firstIn, lastOut: reg.lastOut, source: 'REGULARISED' },
        update: { firstIn: reg.firstIn, lastOut: reg.lastOut, source: 'REGULARISED' },
      });
    }
    await notify({ userIds: [reg.userId], title: `Attendance correction ${data.decision === 'APPROVE' ? 'approved' : 'not approved'}`, body: `${formatDate(reg.date, { forceYear: true })}.${data.note ? ` Note: ${data.note}` : ''}`, link: '/hrms/attendance' }, tx);
    await audit({ actorId: principal.userId, module: 'hr', action: data.decision === 'APPROVE' ? 'hr.attendance.correction_approved' : 'hr.attendance.correction_rejected', entityType: 'HrRegularisation', entityId: reg.id, diff: { note: data.note } }, tx);
  });
}
