import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ZodError } from 'zod';
import { prisma } from '@/core/db/prisma';
import { loadPrincipal } from '@/core/rbac/principal';
import { isReadOnly } from '@/core/rbac/engine';
import { DomainError, ForbiddenError, NotFoundError } from '@/core/rbac/errors';
import type { Principal } from '@/core/rbac/types';
import { getEmployee, getOverview, listDirectoryDepartments, listEmployees, updateJob, updatePersonal, updateStatutory } from './services/employee.service';
import { getDocumentFile, listPolicies, removeDocument, uploadDocument } from './services/document.service';

const run = `${Date.now()}`.slice(-6);
const PDF = (text: string) => ({ name: `${text}.pdf`, type: 'application/pdf', bytes: new TextEncoder().encode(`%PDF-1.4 ${text}`) });

describe('Plan 020 phase 1: HRMS core', () => {
  let companyId: string;
  let deptX: { id: string; code: string };
  let deptY: { id: string; code: string };
  let hr: Principal;
  let director: Principal;
  let head: Principal;
  let empX: Principal;
  let empY: Principal;
  const userIds: string[] = [];

  async function makeUser(tag: string, departmentId: string, roles: Array<{ key: string; scopeType: 'GLOBAL' | 'DEPARTMENT'; scopeId?: string }> = []) {
    const roleRows = await Promise.all(roles.map((r) => prisma.role.findUniqueOrThrow({ where: { key: r.key } })));
    const user = await prisma.user.create({
      data: {
        companyId,
        departmentId,
        employeeCode: `T020-${tag}-${run}`,
        email: `t020-${tag}-${run}@example.test`,
        passwordHash: 'not-a-real-hash',
        fullName: `HR Test ${tag} ${run}`,
        roleAssignments: { create: roles.map((r, i) => ({ roleId: roleRows[i]!.id, scopeType: r.scopeType, scopeId: r.scopeId ?? null })) },
      },
    });
    userIds.push(user.id);
    return (await loadPrincipal(user.id))!;
  }

  beforeAll(async () => {
    const acs = await prisma.company.findFirstOrThrow({ where: { code: 'ACS' } });
    companyId = acs.id;
    deptX = await prisma.department.findFirstOrThrow({ where: { companyId, code: 'PUR' } });
    deptY = await prisma.department.findFirstOrThrow({ where: { companyId, code: 'STORES' } });
    hr = await makeUser('HR', deptX.id, [{ key: 'HR_MANAGER', scopeType: 'GLOBAL' }]);
    director = await makeUser('DIR', deptX.id, [{ key: 'DIRECTOR', scopeType: 'GLOBAL' }]);
    head = await makeUser('HEAD', deptX.id, [{ key: 'DEPARTMENT_HEAD', scopeType: 'DEPARTMENT', scopeId: deptX.id }]);
    empX = await makeUser('EX', deptX.id, [{ key: 'JUNIOR_ENGINEER', scopeType: 'GLOBAL' }]);
    empY = await makeUser('EY', deptY.id);
  });

  afterAll(async () => {
    await prisma.hrDocument.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { uploadedById: { in: userIds } }] } });
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  // ---------------------------------------------------------------- roles

  it('gives HR Manager every hr key and People access, Directors hr keys, heads read only', () => {
    expect(hr.grants.map((g) => g.permission).sort()).toEqual(['admin.user.manage', 'admin.user.read', 'hr.employee.manage', 'hr.employee.read', 'hr.sensitive.read']);
    expect(director.grants.map((g) => g.permission)).toEqual(expect.arrayContaining(['hr.employee.read', 'hr.employee.manage', 'hr.sensitive.read']));
    expect(head.grants.filter((g) => g.permission.startsWith('hr.'))).toEqual([{ permission: 'hr.employee.read', scopeType: 'DEPARTMENT', scopeId: deptX.id }]);
    // hr.* keys do not make anyone a writer in Project Management.
    expect(isReadOnly(head)).toBe(true);
    expect(isReadOnly(hr)).toBe(false); // admin.user.manage is a write key
  });

  // ---------------------------------------------------------------- directory

  it('shows HR everyone, a department head only their department, and employees nothing', async () => {
    const all = (await listEmployees(hr, { q: run })).map((p) => p.id);
    expect(all).toEqual(expect.arrayContaining([empX.userId, empY.userId, head.userId]));
    const team = (await listEmployees(head, { q: run })).map((p) => p.id);
    expect(team).toContain(empX.userId);
    expect(team).not.toContain(empY.userId);
    expect((await listDirectoryDepartments(head)).map((d) => d.id)).toEqual([deptX.id]);
    await expect(listEmployees(empX)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await listDirectoryDepartments(empX)).toEqual([]);
  });

  // ---------------------------------------------------------------- records

  it('lets HR fill in job and statutory details, audited without ID numbers', async () => {
    await updateJob(hr, empX.userId, { dateOfJoining: '2021-10-05', employmentType: 'PROBATION', probationEndDate: '2026-10-20', workLocation: 'Vadodara', noticePeriodDays: '30' });
    await updateStatutory(hr, empX.userId, { pan: 'abcde1234f', aadhaar: '1234 5678 9012', bankName: 'HDFC Bank', bankAccountNo: '50100123456789', bankIfsc: 'hdfc0001234' });
    const record = await getEmployee(hr, empX.userId);
    expect(record.profile).toMatchObject({ employmentType: 'PROBATION', workLocation: 'Vadodara', noticePeriodDays: 30, pan: 'ABCDE1234F', aadhaar: '123456789012', bankIfsc: 'HDFC0001234' });
    expect(record.canEditStatutory).toBe(true);

    const log = await prisma.auditLog.findFirstOrThrow({ where: { actorId: hr.userId, action: 'hr.profile.statutory_updated', entityId: empX.userId } });
    expect(JSON.stringify(log.diff)).not.toContain('ABCDE1234F');
    expect(log.diff).toMatchObject({ fields: expect.arrayContaining(['pan', 'aadhaar', 'bankAccountNo']) });
  });

  it('shows a department head their team member with ID numbers masked and no documents', async () => {
    const record = await getEmployee(head, empX.userId);
    expect(record.profile?.pan).toBe('••••••234F');
    expect(record.profile?.bankAccountNo).toBe('••••••••6789');
    expect(record.canManage).toBe(false);
    expect(record.canSeeDocuments).toBe(false);
    expect(record.documents).toEqual([]);
    await expect(getEmployee(head, empY.userId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('shows employees only themselves, unmasked', async () => {
    const mine = await getEmployee(empX, empX.userId);
    expect(mine.isSelf).toBe(true);
    expect(mine.profile?.pan).toBe('ABCDE1234F');
    expect(mine.canEditPersonal).toBe(true);
    expect(mine.canManage).toBe(false);
    await expect(getEmployee(empX, empY.userId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('lets an employee edit personal details but not job or statutory ones', async () => {
    await updatePersonal(empX, empX.userId, { dateOfBirth: '1995-10-02', bloodGroup: 'B+', personalEmail: 'Me@Example.TEST', emergencyName: 'Asha', emergencyRelation: 'Mother', emergencyPhone: '98250 12345' });
    const mine = await getEmployee(empX, empX.userId);
    expect(mine.profile).toMatchObject({ bloodGroup: 'B+', personalEmail: 'me@example.test', emergencyPhone: '9825012345' });
    expect(mine.profile?.dateOfBirth?.toISOString().slice(0, 10)).toBe('1995-10-02');

    await expect(updateJob(empX, empX.userId, { workLocation: 'Home' })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(updateStatutory(empX, empX.userId, { pan: 'ZZZZZ9999Z' })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(updatePersonal(empX, empY.userId, { bloodGroup: 'O+' })).rejects.toBeInstanceOf(NotFoundError);
    await expect(updatePersonal(head, empX.userId, { bloodGroup: 'O+' })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(updateJob(head, empX.userId, { workLocation: 'Home' })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('rejects invalid details', async () => {
    await expect(updatePersonal(empX, empX.userId, { personalEmail: 'nope' })).rejects.toBeInstanceOf(ZodError);
    await expect(updateStatutory(hr, empX.userId, { pan: 'ABC' })).rejects.toBeInstanceOf(ZodError);
    await expect(updateJob(hr, empX.userId, { noticePeriodDays: '-3' })).rejects.toBeInstanceOf(ZodError);
  });

  it('audits personal changes with before and after, and skips no-op saves', async () => {
    const before = await prisma.auditLog.count({ where: { entityId: empX.userId, action: 'hr.profile.personal_updated' } });
    await updatePersonal(empX, empX.userId, { dateOfBirth: '1995-10-02', bloodGroup: 'B+', personalEmail: 'me@example.test', emergencyName: 'Asha', emergencyRelation: 'Mother', emergencyPhone: '9825012345' });
    expect(await prisma.auditLog.count({ where: { entityId: empX.userId, action: 'hr.profile.personal_updated' } })).toBe(before);
    await updatePersonal(hr, empX.userId, { dateOfBirth: '1995-10-02', bloodGroup: 'A+', personalEmail: 'me@example.test', emergencyName: 'Asha', emergencyRelation: 'Mother', emergencyPhone: '9825012345' });
    const log = await prisma.auditLog.findFirstOrThrow({ where: { entityId: empX.userId, action: 'hr.profile.personal_updated', actorId: hr.userId } });
    expect(log.diff).toEqual({ bloodGroup: { from: 'B+', to: 'A+' } });
  });

  // ---------------------------------------------------------------- documents

  it('versions employee documents and controls who can open them', async () => {
    const v1 = await uploadDocument(hr, { userId: empX.userId, category: 'OFFER_LETTER', title: 'Offer letter', visibleToEmployee: true }, PDF('v1'));
    const v2 = await uploadDocument(hr, { userId: empX.userId, category: 'OFFER_LETTER', title: 'offer LETTER', visibleToEmployee: true }, PDF('v2'));
    expect(v2.version).toBe(2);
    expect((await prisma.hrDocument.findUniqueOrThrow({ where: { id: v1.id } })).supersededAt).not.toBeNull();
    expect(await prisma.notification.count({ where: { userId: empX.userId, title: { startsWith: 'New document' } } })).toBe(2);

    const file = await getDocumentFile(empX, v2.id);
    expect(file.mimeType).toBe('application/pdf');
    expect(new TextDecoder().decode(file.content)).toContain('v2');
    await expect(getDocumentFile(empY, v2.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getDocumentFile(head, v2.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await getDocumentFile(director, v1.id)).fileName).toBe('v1.pdf');

    const hrOnly = await uploadDocument(hr, { userId: empX.userId, category: 'LETTER', title: 'Warning note', visibleToEmployee: false }, PDF('note'));
    await expect(getDocumentFile(empX, hrOnly.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await getEmployee(empX, empX.userId)).documents.map((d) => d.id)).toEqual([v2.id, v1.id]);
    expect((await getEmployee(hr, empX.userId)).documents.map((d) => d.id)).toContain(hrOnly.id);

    // Removing the current version brings the previous one back.
    await removeDocument(hr, v2.id);
    expect((await prisma.hrDocument.findUniqueOrThrow({ where: { id: v1.id } })).supersededAt).toBeNull();
  });

  it('refuses uploads from non-HR and files that are not PDF, JPG or PNG', async () => {
    await expect(uploadDocument(empX, { userId: empX.userId, category: 'OTHER', title: 'Mine' }, PDF('x'))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(uploadDocument(head, { userId: empX.userId, category: 'OTHER', title: 'Mine' }, PDF('x'))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(uploadDocument(hr, { userId: empX.userId, category: 'OTHER', title: 'Page' }, { name: 'a.pdf', type: 'application/pdf', bytes: new TextEncoder().encode('<html>') })).rejects.toBeInstanceOf(DomainError);
    await expect(uploadDocument(hr, { userId: empX.userId, category: 'OTHER', title: 'Big' }, { name: 'a.pdf', type: 'application/pdf', bytes: new Uint8Array(3 * 1024 * 1024 + 1).fill(0x25) })).rejects.toBeInstanceOf(DomainError);
    await expect(uploadDocument(hr, { userId: empX.userId, category: 'OTHER', title: 'Empty' }, null)).rejects.toBeInstanceOf(DomainError);
    await expect(uploadDocument(hr, { userId: empX.userId, category: 'OTHER', title: 'x' }, PDF('x'))).rejects.toBeInstanceOf(ZodError);
    await expect(removeDocument(empX, (await prisma.hrDocument.findFirstOrThrow({ where: { userId: empX.userId } })).id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('lets HR publish company policies that everyone can read', async () => {
    await expect(uploadDocument(empX, { category: 'POLICY', title: `Leave policy ${run}` }, PDF('p'))).rejects.toBeInstanceOf(ForbiddenError);
    const policy = await uploadDocument(hr, { category: 'POLICY', title: `Leave policy ${run}` }, PDF('policy'));
    expect((await listPolicies(empY)).map((p) => p.id)).toContain(policy.id);
    expect((await getDocumentFile(empY, policy.id)).fileName).toBe('policy.pdf');
    await removeDocument(hr, policy.id);
  });

  // ---------------------------------------------------------------- overview

  it('builds the HR overview in scope', async () => {
    const now = new Date('2026-10-11T06:00:00Z');
    const overview = await getOverview(hr, now);
    expect(overview.headcount).toBeGreaterThanOrEqual(5);
    expect(overview.probationEnding.map((p) => p.id)).toContain(empX.userId);
    expect(overview.birthdays.map((p) => p.id)).toContain(empX.userId);
    expect(overview.anniversaries.find((p) => p.id === empX.userId)?.years).toBe(5);
    expect(overview.incomplete.map((p) => p.id)).toContain(empY.userId);
    expect(overview.incomplete.map((p) => p.id)).not.toContain(empX.userId);

    const headView = await getOverview(head, now);
    expect(headView.incomplete.map((p) => p.id)).not.toContain(empY.userId);
    await expect(getOverview(empX, now)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
