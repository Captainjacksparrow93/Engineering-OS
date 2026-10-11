import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ZodError } from 'zod';
import { prisma } from '@/core/db/prisma';
import { loadPrincipal } from '@/core/rbac/principal';
import { DomainError, ForbiddenError, NotFoundError } from '@/core/rbac/errors';
import type { Principal } from '@/core/rbac/types';
import { addDays, todayInIndia } from '@/core/utils/dates';
import { dayKey } from './domain/time';
import { updateJob } from './services/employee.service';
import { addHoliday, applyLeave, cancelLeave, decideLeave, leaveBalances, leaveToDecide, removeHoliday, setAllocation, teamLeave } from './services/leave.service';
import { decideRegularisation, importAttendance, monthAttendance, regularisationsToDecide, requestRegularisation, saveShift, teamAttendance } from './services/attendance.service';

const run = `${Date.now()}`.slice(-6);
const today = todayInIndia();
/** The Monday of the 3rd full week of next year: always in the future and the same year. */
const nextYear = today.getUTCFullYear() + 1;
const jan = new Date(Date.UTC(nextYear, 0, 15));
const mon = addDays(jan, (8 - jan.getUTCDay()) % 7);
const d = (offset: number, base = mon) => dayKey(addDays(base, offset));
/** A Monday 2–3 weeks ago, for attendance that has already happened. */
const back = addDays(today, -14);
const monBack = addDays(back, -((back.getUTCDay() + 6) % 7));
// Keep the whole week inside one month so each month view sees all of it.
const pastMon = addDays(monBack, 6).getUTCMonth() === monBack.getUTCMonth() ? monBack : addDays(monBack, -7);
const p = (offset: number) => d(offset, pastMon);

describe('Plan 020 phase 2: leave and attendance', () => {
  let companyId: string;
  let deptX: string;
  let deptY: string;
  let hr: Principal;
  let head: Principal;
  let headY: Principal;
  let mgr: Principal;
  let emp: Principal;
  let empNoMgr: Principal;
  let empOfHead: Principal;
  let cl: { id: string };
  let lwp: { id: string };
  const userIds: string[] = [];
  const holidayIds: string[] = [];

  async function makeUser(tag: string, departmentId: string, opts: { managerId?: string; roles?: Array<{ key: string; scopeType: 'GLOBAL' | 'DEPARTMENT'; scopeId?: string }> } = {}) {
    const roles = opts.roles ?? [];
    const roleRows = await Promise.all(roles.map((r) => prisma.role.findUniqueOrThrow({ where: { key: r.key } })));
    const user = await prisma.user.create({
      data: {
        companyId,
        departmentId,
        managerId: opts.managerId ?? null,
        employeeCode: `T020T-${tag}-${run}`,
        email: `t020t-${tag}-${run}@example.test`,
        passwordHash: 'not-a-real-hash',
        fullName: `Time Test ${tag} ${run}`,
        roleAssignments: { create: roles.map((r, i) => ({ roleId: roleRows[i]!.id, scopeType: r.scopeType, scopeId: r.scopeId ?? null })) },
      },
    });
    userIds.push(user.id);
    return (await loadPrincipal(user.id))!;
  }

  beforeAll(async () => {
    companyId = (await prisma.company.findFirstOrThrow({ where: { code: 'ACS' } })).id;
    deptX = (await prisma.department.findFirstOrThrow({ where: { companyId, code: 'PUR' } })).id;
    deptY = (await prisma.department.findFirstOrThrow({ where: { companyId, code: 'STORES' } })).id;
    cl = await prisma.hrLeaveType.findFirstOrThrow({ where: { companyId, code: 'CL' } });
    lwp = await prisma.hrLeaveType.findFirstOrThrow({ where: { companyId, code: 'LWP' } });
    hr = await makeUser('HR', deptY, { roles: [{ key: 'HR_MANAGER', scopeType: 'GLOBAL' }] });
    head = await makeUser('HEAD', deptX, { roles: [{ key: 'DEPARTMENT_HEAD', scopeType: 'DEPARTMENT', scopeId: deptX }] });
    headY = await makeUser('HEADY', deptY, { roles: [{ key: 'DEPARTMENT_HEAD', scopeType: 'DEPARTMENT', scopeId: deptY }] });
    mgr = await makeUser('MGR', deptX);
    emp = await makeUser('EMP', deptX, { managerId: mgr.userId });
    empNoMgr = await makeUser('NOMGR', deptX);
    empOfHead = await makeUser('OFHEAD', deptX, { managerId: head.userId });
  });

  afterAll(async () => {
    const leaves = await prisma.hrLeaveRequest.findMany({ where: { userId: { in: userIds } }, select: { coreLeaveId: true } });
    await prisma.leave.deleteMany({ where: { id: { in: leaves.flatMap((l) => (l.coreLeaveId ? [l.coreLeaveId] : [])) } } });
    await prisma.hrLeaveRequest.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.hrRegularisation.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.hrAttendance.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.hrAttendanceImport.deleteMany({ where: { importedById: { in: userIds } } });
    await prisma.hrHoliday.deleteMany({ where: { id: { in: holidayIds } } });
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  const clLeft = async (who: Principal, year = nextYear) => (await leaveBalances(companyId, who.userId, year)).find((b) => b.type.code === 'CL')!.left;
  const leave = (who: Principal, start: string, end: string, extra: Partial<Parameters<typeof applyLeave>[1]> = {}) =>
    applyLeave(who, { leaveTypeId: cl.id, startDate: start, endDate: end, reason: 'Family function', ...extra });

  it('grants the head step to department heads and HR, and attendance admin to HR only', () => {
    expect(hr.grants.map((g) => g.permission)).toEqual(expect.arrayContaining(['hr.leave.approve', 'hr.attendance.manage']));
    expect(head.grants.filter((g) => g.permission === 'hr.leave.approve')).toEqual([{ permission: 'hr.leave.approve', scopeType: 'DEPARTMENT', scopeId: deptX }]);
    expect(head.grants.map((g) => g.permission)).not.toContain('hr.attendance.manage');
  });

  // ---------------------------------------------------------------- leave

  it('runs leave through the manager, then the department head, and tells PM', async () => {
    const before = await clLeft(emp);
    const req = await leave(emp, d(0), d(1));
    expect(req).toMatchObject({ status: 'PENDING_MANAGER' });
    expect(Number(req.days)).toBe(2);
    expect(await clLeft(emp)).toBe(before! - 2);
    expect(await prisma.notification.count({ where: { userId: mgr.userId, title: { startsWith: 'Leave to approve' } } })).toBe(1);

    await expect(decideLeave(head, req.id, { decision: 'APPROVE' })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(decideLeave(emp, req.id, { decision: 'APPROVE' })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await leaveToDecide(mgr)).map((r) => r.id)).toEqual([req.id]);

    await decideLeave(mgr, req.id, { decision: 'APPROVE', note: 'Fine by me' });
    expect(await prisma.hrLeaveRequest.findUniqueOrThrow({ where: { id: req.id } })).toMatchObject({ status: 'PENDING_HEAD', managerById: mgr.userId });
    expect(await prisma.notification.count({ where: { userId: head.userId, title: { startsWith: 'Leave to approve' } } })).toBe(1);
    await expect(decideLeave(mgr, req.id, { decision: 'APPROVE' })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(decideLeave(headY, req.id, { decision: 'APPROVE' })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await leaveToDecide(head)).map((r) => r.id)).toContain(req.id);

    await decideLeave(head, req.id, { decision: 'APPROVE' });
    const done = await prisma.hrLeaveRequest.findUniqueOrThrow({ where: { id: req.id } });
    expect(done).toMatchObject({ status: 'APPROVED', headById: head.userId });
    expect(await prisma.leave.findUniqueOrThrow({ where: { id: done.coreLeaveId! } })).toMatchObject({ userId: emp.userId, status: 'APPROVED', sourceModule: 'hrms' });
    expect(await prisma.notification.count({ where: { userId: emp.userId, title: { startsWith: 'Leave approved' } } })).toBe(1);
    await expect(decideLeave(head, req.id, { decision: 'APPROVE' })).rejects.toBeInstanceOf(ForbiddenError);

    // Cancelling before it starts gives PM the capacity back.
    await cancelLeave(emp, req.id);
    expect(await prisma.leave.findUniqueOrThrow({ where: { id: done.coreLeaveId! } })).toMatchObject({ status: 'CANCELLED' });
    expect(await clLeft(emp)).toBe(before);
  });

  it('skips the manager step when there is none, and lets a head reject', async () => {
    const req = await leave(empNoMgr, d(7), d(7));
    expect(req.status).toBe('PENDING_HEAD');
    await decideLeave(head, req.id, { decision: 'REJECT', note: 'Stock count that week' });
    expect(await prisma.hrLeaveRequest.findUniqueOrThrow({ where: { id: req.id } })).toMatchObject({ status: 'REJECTED', headNote: 'Stock count that week' });
    expect(await prisma.notification.count({ where: { userId: empNoMgr.userId, title: { startsWith: 'Leave not approved' } } })).toBe(1);
  });

  it('approves in one step when the manager is also the head, and never lets a head approve themselves', async () => {
    const req = await leave(empOfHead, d(14), d(14));
    await decideLeave(head, req.id, { decision: 'APPROVE' });
    expect((await prisma.hrLeaveRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe('APPROVED');

    const own = await leave(head, d(21), d(21));
    expect(own.status).toBe('PENDING_HEAD');
    await expect(decideLeave(head, own.id, { decision: 'APPROVE' })).rejects.toBeInstanceOf(ForbiddenError);
    await decideLeave(hr, own.id, { decision: 'APPROVE' });
    expect((await prisma.hrLeaveRequest.findUniqueOrThrow({ where: { id: own.id } })).status).toBe('APPROVED');
  });

  it('checks dates, overlaps, half days, holidays and balances', async () => {
    const holiday = await addHoliday(hr, { date: d(29), name: `Test holiday ${run}` }); // a Tuesday
    holidayIds.push(holiday.id);
    await expect(addHoliday(hr, { date: d(29), name: 'Again' })).rejects.toBeInstanceOf(DomainError);
    await expect(addHoliday(emp, { date: d(30), name: 'Mine' })).rejects.toBeInstanceOf(ForbiddenError);

    const around = await leave(emp, d(28), d(30)); // Mon–Wed with the Tuesday off
    expect(Number(around.days)).toBe(2);
    await expect(leave(emp, d(30), d(31))).rejects.toThrow(/already have leave/);
    const half = await leave(emp, d(35), d(35), { halfDay: true });
    expect(Number(half.days)).toBe(0.5);
    await expect(leave(emp, d(36), d(37), { halfDay: true })).rejects.toBeInstanceOf(DomainError);
    await expect(leave(emp, d(41), d(41))).rejects.toThrow(/Sundays or holidays/);
    await expect(leave(emp, d(43), d(42))).rejects.toBeInstanceOf(DomainError);
    await expect(leave(emp, d(42), d(70))).rejects.toThrow(/left in/);
    await expect(leave(emp, d(49), d(49), { reason: 'x' })).rejects.toBeInstanceOf(ZodError);
    // No limit on leave without pay.
    expect((await applyLeave(emp, { leaveTypeId: lwp.id, startDate: d(42), endDate: d(70), reason: 'Long trip' })).status).toBe('PENDING_MANAGER');
    await expect(leave(emp, `${nextYear}-12-31`, `${nextYear + 1}-01-02`)).rejects.toThrow(/31 December/);
    await removeHoliday(hr, holiday.id);
  });

  it('lets HR set one employee’s days for a year', async () => {
    await expect(setAllocation(emp, { userId: emp.userId, leaveTypeId: cl.id, year: nextYear, days: 30 })).rejects.toBeInstanceOf(ForbiddenError);
    await setAllocation(hr, { userId: empNoMgr.userId, leaveTypeId: cl.id, year: nextYear, days: 2.5, note: 'Joined in October' });
    const balance = (await leaveBalances(companyId, empNoMgr.userId, nextYear)).find((b) => b.type.code === 'CL')!;
    expect(balance).toMatchObject({ entitled: 2.5, allocated: true, left: 2.5 });
    await expect(setAllocation(hr, { userId: empNoMgr.userId, leaveTypeId: cl.id, year: nextYear, days: 1.3 })).rejects.toBeInstanceOf(ZodError);
  });

  it('shows team leave in scope only', async () => {
    const from = mon;
    const to = addDays(mon, 90);
    const forHead = (await teamLeave(head, from, to)).map((r) => r.userId);
    expect(forHead).toContain(emp.userId);
    expect(forHead).not.toContain(hr.userId);
    await expect(teamLeave(emp, from, to)).rejects.toBeInstanceOf(ForbiddenError);
  });

  // ---------------------------------------------------------------- attendance

  it('imports the biometric CSV by employee code or biometric number', async () => {
    await updateJob(hr, empNoMgr.userId, { biometricId: `B${run}` });
    const csv = [
      'Emp Code,Name,Date,In Time,Out Time',
      `${emp.employeeCode},Emp,${p(0).split('-').reverse().join('-')},09:31,18:40`,
      `${emp.employeeCode},Emp,${p(1).split('-').reverse().join('-')},09:58,18:30`,
      `${emp.employeeCode},Emp,${p(2).split('-').reverse().join('-')},09:30,`,
      `B${run},NoMgr,${p(0).split('-').reverse().join('-')},10:00,14:30`,
      `999${run},Ghost,${p(0).split('-').reverse().join('-')},09:00,18:00`,
    ].join('\n');
    await expect(importAttendance(emp, 'march.csv', csv)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(importAttendance(hr, 'empty.csv', '  ')).rejects.toBeInstanceOf(DomainError);
    const result = await importAttendance(hr, 'march.csv', csv);
    expect(result).toMatchObject({ rows: 5, days: 4, skipped: 1 });
    expect(result.problems[0]).toContain(`999${run}`);

    const month = p(0).slice(0, 7);
    const view = await monthAttendance(emp, emp.userId, month);
    const byDay = new Map(view.rows.map((r) => [dayKey(r.date), r]));
    expect(byDay.get(p(0))).toMatchObject({ status: 'PRESENT', late: false, inMinutes: 571, outMinutes: 1120 });
    expect(byDay.get(p(1))).toMatchObject({ status: 'PRESENT', late: true, lateMinutes: 13 });
    expect(byDay.get(p(2))).toMatchObject({ status: 'MISSED_PUNCH' });
    expect(byDay.get(p(6))?.status).toBe('WEEKLY_OFF');

    // Importing the same file again changes nothing.
    await importAttendance(hr, 'march.csv', csv);
    expect(await prisma.hrAttendance.count({ where: { userId: { in: userIds } } })).toBe(4);

    const other = (await monthAttendance(hr, empNoMgr.userId, month)).rows.find((r) => dayKey(r.date) === p(0));
    expect(other).toMatchObject({ status: 'HALF_DAY' });
    await expect(monthAttendance(empNoMgr, emp.userId, month)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('corrects a missed punch through the manager, and a later import keeps the correction', async () => {
    await expect(requestRegularisation(emp, { date: dayKey(addDays(today, 2)), inTime: '09:30', outTime: '18:30', reason: 'Forgot' })).rejects.toBeInstanceOf(DomainError);
    await expect(requestRegularisation(emp, { date: p(2), inTime: '18:30', outTime: '09:30', reason: 'Forgot' })).rejects.toBeInstanceOf(DomainError);
    await expect(requestRegularisation(emp, { date: p(2), inTime: '9:30', outTime: '18:30', reason: 'Forgot' })).rejects.toBeInstanceOf(ZodError);
    const reg = await requestRegularisation(emp, { date: p(2), inTime: '09:30', outTime: '18:35', reason: 'Forgot to punch out' });
    await expect(requestRegularisation(emp, { date: p(2), inTime: '09:30', outTime: '18:35', reason: 'Again' })).rejects.toBeInstanceOf(DomainError);
    expect((await regularisationsToDecide(mgr)).map((r) => r.id)).toEqual([reg.id]);
    await expect(decideRegularisation(empNoMgr, reg.id, { decision: 'APPROVE' })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(decideRegularisation(emp, reg.id, { decision: 'APPROVE' })).rejects.toBeInstanceOf(ForbiddenError);

    await decideRegularisation(mgr, reg.id, { decision: 'APPROVE' });
    const month = p(0).slice(0, 7);
    const fixed = (await monthAttendance(emp, emp.userId, month)).rows.find((r) => dayKey(r.date) === p(2))!;
    expect(fixed).toMatchObject({ status: 'PRESENT', corrected: true, outMinutes: 1115 });

    const csv = `Emp Code,Date,In Time,Out Time\n${emp.employeeCode},${p(2)},09:30,\n`;
    const again = await importAttendance(hr, 'again.csv', csv);
    expect(again).toMatchObject({ days: 0, keptCorrections: 1 });
  });

  it('shows approved leave on the attendance month', async () => {
    const req = await applyLeave(emp, { leaveTypeId: cl.id, startDate: p(3), endDate: p(3), reason: 'Unwell' });
    await decideLeave(mgr, req.id, { decision: 'APPROVE' });
    await decideLeave(head, req.id, { decision: 'APPROVE' });
    const view = await monthAttendance(emp, emp.userId, p(3).slice(0, 7));
    expect(view.rows.find((r) => dayKey(r.date) === p(3))).toMatchObject({ status: 'LEAVE', leaveType: 'Casual leave' });
  });

  it('summarises team attendance in scope and lets HR set the shift', async () => {
    const month = p(0).slice(0, 7);
    const team = await teamAttendance(head, month);
    expect(team.map((t) => t.id)).toContain(emp.userId);
    expect(team.map((t) => t.id)).not.toContain(hr.userId);
    expect(team.find((t) => t.id === emp.userId)!.summary).toMatchObject({ late: 1 });
    await expect(teamAttendance(emp, month)).rejects.toBeInstanceOf(ForbiddenError);

    await expect(saveShift(emp, { shiftStart: '09:00', graceMinutes: 10, fullDayHours: 8, halfDayHours: 4 })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(saveShift(hr, { shiftStart: '09:00', graceMinutes: 10, fullDayHours: 4, halfDayHours: 4 })).rejects.toBeInstanceOf(ZodError);
    const settings = await prisma.hrSettings.findUnique({ where: { companyId } });
    await saveShift(hr, { shiftStart: '09:00', graceMinutes: 10, fullDayHours: 8.5, halfDayHours: 4 });
    expect(await prisma.hrSettings.findUniqueOrThrow({ where: { companyId } })).toMatchObject({ shiftStartMinutes: 540, graceMinutes: 10, fullDayMinutes: 510, halfDayMinutes: 240 });
    // Put the company shift back as it was.
    await prisma.hrSettings.update({ where: { companyId }, data: { shiftStartMinutes: settings?.shiftStartMinutes ?? 570, graceMinutes: settings?.graceMinutes ?? 15, fullDayMinutes: settings?.fullDayMinutes ?? 480, halfDayMinutes: settings?.halfDayMinutes ?? 240 } });
  });
});
