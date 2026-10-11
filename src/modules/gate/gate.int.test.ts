import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ZodError } from 'zod';
import { prisma } from '@/core/db/prisma';
import { loadPrincipal } from '@/core/rbac/principal';
import { homePath, isReadOnly } from '@/core/rbac/engine';
import { DomainError, ForbiddenError, NotFoundError } from '@/core/rbac/errors';
import type { Principal } from '@/core/rbac/types';
import { istDateString } from './domain/time';
import {
  cancelVisit,
  checkIn,
  checkOut,
  getDesk,
  listHosts,
  listMyVisits,
  listRegister,
  listWaitingForMe,
  logWalkIn,
  replyToVisitor,
  scheduleVisit,
} from './services/visit.service';

const run = `${Date.now()}`.slice(-6);
const DAY = 24 * 60 * 60 * 1000;
const today = istDateString(new Date());
const tomorrow = istDateString(new Date(Date.now() + DAY));
const yesterday = istDateString(new Date(Date.now() - DAY));
const visitor = (name: string) => ({ visitorName: `${name} ${run}`, visitorPhone: '98250 12345', visitorCompany: `Firm ${run}`, purpose: 'Panel inspection' });

describe('Plan 019: Gate & Visitors', () => {
  let desk: Principal;
  let director: Principal;
  let hostA: Principal;
  let hostB: Principal;
  let companyId: string;
  const userIds: string[] = [];

  async function makeUser(tag: string, roleKey?: string) {
    const role = roleKey ? await prisma.role.findUniqueOrThrow({ where: { key: roleKey } }) : null;
    const user = await prisma.user.create({
      data: {
        companyId,
        employeeCode: `T019-${tag}-${run}`,
        email: `t019-${tag}-${run}@example.test`,
        passwordHash: 'not-a-real-hash',
        fullName: `Gate Test ${tag}`,
        ...(role ? { roleAssignments: { create: { roleId: role.id, scopeType: 'GLOBAL' } } } : {}),
      },
    });
    userIds.push(user.id);
    return (await loadPrincipal(user.id))!;
  }

  beforeAll(async () => {
    const acs = await prisma.company.findFirstOrThrow({ where: { code: 'ACS' } });
    companyId = acs.id;
    const directorUser = await prisma.user.findFirstOrThrow({ where: { companyId, status: 'ACTIVE', roleAssignments: { some: { role: { key: 'DIRECTOR' } }, none: { role: { key: 'SUPER_ADMIN' } } } } });
    director = (await loadPrincipal(directorUser.id))!;
    desk = await makeUser('DESK', 'RECEPTIONIST');
    hostA = await makeUser('A');
    hostB = await makeUser('B', 'JUNIOR_ENGINEER');
  });

  afterAll(async () => {
    await prisma.gateVisit.deleteMany({ where: { OR: [{ hostId: { in: userIds } }, { createdById: { in: userIds } }] } });
    await prisma.notification.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { title: { contains: run } }, { body: { contains: run } }] } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  // ---------------------------------------------------------------- roles

  it('gives the Receptionist the desk and Directors the register only', () => {
    expect(desk.grants.map((g) => g.permission).sort()).toEqual(['gate.desk', 'gate.register.read']);
    const directorKeys = director.grants.map((g) => g.permission);
    expect(directorKeys).toContain('gate.register.read');
    expect(directorKeys).not.toContain('gate.desk');
    expect(homePath(desk)).toBe('/gate');
    expect(isReadOnly(desk)).toBe(true);
  });

  // ---------------------------------------------------------------- scheduling

  it('lets any employee schedule a visit to themselves', async () => {
    const visit = await scheduleVisit(hostA, { ...visitor('Self'), date: tomorrow, time: '11:00' });
    expect(visit).toMatchObject({ hostId: hostA.userId, source: 'HOST', status: 'EXPECTED', createdById: hostA.userId });
    expect(visit.expectedAt.toISOString()).toBe(new Date(`${tomorrow}T11:00:00+05:30`).toISOString());
    const mine = await listMyVisits(hostA);
    expect(mine.upcoming.map((v) => v.id)).toContain(visit.id);
    // It lands on the front desk's list without any approval.
    const deskView = await getDesk(desk);
    expect(deskView.upcoming.map((v) => v.id)).toContain(visit.id);
  });

  it('stops an employee scheduling a visit to someone else', async () => {
    await expect(scheduleVisit(hostA, { ...visitor('Other'), date: tomorrow, time: '11:00', hostId: hostB.userId })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('lets the desk schedule for anyone and tells the host', async () => {
    const visit = await scheduleVisit(desk, { ...visitor('DeskSched'), date: today, time: '23:59', hostId: hostB.userId });
    expect(visit).toMatchObject({ hostId: hostB.userId, source: 'DESK' });
    const note = await prisma.notification.findFirst({ where: { userId: hostB.userId, title: { contains: `DeskSched ${run}` } } });
    expect(note?.link).toBe('/gate/my-visitors');
    expect((await getDesk(desk)).expected.map((v) => v.id)).toContain(visit.id);
  });

  it('rejects bad visitor details, past dates and unknown hosts', async () => {
    await expect(scheduleVisit(hostA, { ...visitor('Bad'), visitorPhone: 'call me', date: tomorrow, time: '11:00' })).rejects.toBeInstanceOf(ZodError);
    await expect(scheduleVisit(hostA, { ...visitor('Bad'), visitorName: '', date: tomorrow, time: '11:00' })).rejects.toBeInstanceOf(ZodError);
    await expect(scheduleVisit(hostA, { ...visitor('Bad'), date: tomorrow, time: '25:00' })).rejects.toBeInstanceOf(ZodError);
    await expect(scheduleVisit(hostA, { ...visitor('Past'), date: yesterday, time: '11:00' })).rejects.toBeInstanceOf(DomainError);
    await expect(logWalkIn(desk, { ...visitor('Nobody'), hostId: 'no-such-user' })).rejects.toBeInstanceOf(NotFoundError);
    await expect(logWalkIn(desk, { ...visitor('NoHost'), hostId: '' })).rejects.toBeInstanceOf(ZodError);
  });

  // ---------------------------------------------------------------- arrival, reply, exit

  it('checks a scheduled visitor in, alerts the host, takes the reply and checks out', async () => {
    const visit = await scheduleVisit(hostA, { ...visitor('Arrives'), date: today, time: '23:58' });
    await expect(checkIn(hostA, visit.id)).rejects.toBeInstanceOf(ForbiddenError);
    await checkIn(desk, visit.id);
    await expect(checkIn(desk, visit.id)).rejects.toBeInstanceOf(DomainError);

    const alert = await prisma.notification.findFirst({ where: { userId: hostA.userId, title: `Arrives ${run} (Firm ${run}) is at reception` } });
    expect(alert).not.toBeNull();
    expect((await listWaitingForMe(hostA)).map((v) => v.id)).toContain(visit.id);
    expect((await getDesk(desk)).inside.map((v) => v.id)).toContain(visit.id);

    await expect(replyToVisitor(hostB, visit.id, { reply: 'COMING' })).rejects.toBeInstanceOf(NotFoundError);
    await expect(replyToVisitor(hostA, visit.id, { reply: 'MAYBE' })).rejects.toBeInstanceOf(ZodError);
    await replyToVisitor(hostA, visit.id, { reply: 'WAIT', note: 'Five minutes' });
    expect((await listWaitingForMe(hostA)).map((v) => v.id)).not.toContain(visit.id);
    const seen = (await getDesk(desk)).inside.find((v) => v.id === visit.id);
    expect(seen).toMatchObject({ hostReply: 'WAIT', hostReplyNote: 'Five minutes' });
    const deskNote = await prisma.notification.findFirst({ where: { userId: desk.userId, body: { contains: `Arrives ${run}` } } });
    expect(deskNote?.title).toBe('Gate Test A: Ask them to wait');

    await expect(checkOut(hostA, visit.id)).rejects.toBeInstanceOf(ForbiddenError);
    await checkOut(desk, visit.id);
    await expect(replyToVisitor(hostA, visit.id, { reply: 'COMING' })).rejects.toBeInstanceOf(DomainError);
    const after = await getDesk(desk);
    expect(after.left.map((v) => v.id)).toContain(visit.id);
    expect(after.inside.map((v) => v.id)).not.toContain(visit.id);
    expect((await listMyVisits(hostA)).recent.map((v) => v.id)).toContain(visit.id);
  });

  it('logs a walk-in as already inside and alerts the host', async () => {
    await expect(logWalkIn(hostA, { ...visitor('Sneaky'), hostId: hostA.userId })).rejects.toBeInstanceOf(ForbiddenError);
    const visit = await logWalkIn(desk, { ...visitor('Walkin'), hostId: hostB.userId });
    expect(visit).toMatchObject({ source: 'WALK_IN', status: 'CHECKED_IN', hostId: hostB.userId });
    expect(visit.checkedInAt).not.toBeNull();
    expect((await listWaitingForMe(hostB)).map((v) => v.id)).toContain(visit.id);
    expect(await prisma.notification.count({ where: { userId: hostB.userId, title: { contains: `Walkin ${run}` } } })).toBe(1);
    await replyToVisitor(hostB, visit.id, { reply: 'UNAVAILABLE' });
    await checkOut(desk, visit.id);
  });

  it('lets the host or the desk cancel an expected visit, nobody else', async () => {
    const own = await scheduleVisit(hostA, { ...visitor('CancelOwn'), date: tomorrow, time: '10:00' });
    await expect(cancelVisit(hostB, own.id)).rejects.toBeInstanceOf(NotFoundError);
    await cancelVisit(hostA, own.id);
    await expect(cancelVisit(hostA, own.id)).rejects.toBeInstanceOf(DomainError);

    const byDesk = await scheduleVisit(hostA, { ...visitor('CancelDesk'), date: tomorrow, time: '12:00' });
    await cancelVisit(desk, byDesk.id);
    expect(await prisma.notification.count({ where: { userId: hostA.userId, title: { contains: `CancelDesk ${run}` } } })).toBe(1);
    const mine = await listMyVisits(hostA);
    expect(mine.upcoming.map((v) => v.id)).not.toContain(byDesk.id);
  });

  // ---------------------------------------------------------------- visibility

  it('shows the full register to the desk and Directors only', async () => {
    const filter = { from: today, to: tomorrow, q: run };
    const forDesk = await listRegister(desk, filter);
    const forDirector = await listRegister(director, filter);
    expect(forDesk.length).toBeGreaterThanOrEqual(5);
    expect(forDirector.map((v) => v.id).sort()).toEqual(forDesk.map((v) => v.id).sort());
    expect(forDesk.every((v) => v.visitorName.includes(run) || v.visitorCompany?.includes(run))).toBe(true);
    await expect(listRegister(hostA, filter)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listRegister(desk, { from: tomorrow, to: today })).rejects.toBeInstanceOf(DomainError);
    await expect(listRegister(desk, { from: 'soon', to: today })).rejects.toBeInstanceOf(ZodError);
  });

  it('keeps the desk screen and host picker to the front desk, and each employee to their own visitors', async () => {
    await expect(getDesk(director)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getDesk(hostA)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listHosts(hostA)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await listHosts(desk)).map((u) => u.id)).toEqual(expect.arrayContaining([hostA.userId, hostB.userId]));
    const a = await listMyVisits(hostA);
    const b = await listMyVisits(hostB);
    expect([...a.upcoming, ...a.recent, ...a.atReception].every((v) => v.hostId === hostA.userId)).toBe(true);
    expect([...b.upcoming, ...b.recent, ...b.atReception].every((v) => v.hostId === hostB.userId)).toBe(true);
  });

  it('writes the audit trail', async () => {
    const actions = await prisma.auditLog.findMany({ where: { module: 'gate', actorId: { in: userIds } }, select: { action: true } });
    expect(new Set(actions.map((a) => a.action))).toEqual(
      new Set(['gate.visit.scheduled', 'gate.visit.checked_in', 'gate.visit.replied', 'gate.visit.checked_out', 'gate.visit.walk_in', 'gate.visit.cancelled']),
    );
  });
});
