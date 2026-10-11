import type { HrEmployeeProfile, Prisma } from '@prisma/client';
import { prisma } from '@/core/db/prisma';
import { audit } from '@/core/audit/audit';
import { can, hasPermissionAnywhere } from '@/core/rbac/engine';
import { ForbiddenError, NotFoundError } from '@/core/rbac/errors';
import type { Principal } from '@/core/rbac/types';
import { addDays, todayInIndia } from '@/core/utils/dates';
import { anniversaryYears, isSameMonth, mask, missingDetails, parseDay } from '../domain/records';
import {
  directoryFilterSchema,
  jobSchema,
  personalSchema,
  statutorySchema,
  type DirectoryFilter,
  type JobInput,
  type PersonalInput,
  type StatutoryInput,
} from '../validation';

/**
 * HRMS employee records (plan 020, phase 1).
 *
 * Who sees whom:
 * - A global `hr.employee.read` (HR Manager, Director) sees the whole company.
 * - A department-scoped one (department heads) sees the departments it covers.
 * - Everyone sees themselves, with no key.
 * Bank and ID numbers are masked unless the viewer holds `hr.sensitive.read`. Salary is not
 * part of this record (phase 3, `hr.payroll.manage`).
 */

const hasGlobal = (principal: Principal, permission: 'hr.employee.read' | 'hr.employee.manage') =>
  principal.grants.some((g) => g.permission === permission && g.scopeType === 'GLOBAL');

export const seesDirectory = (principal: Principal) => hasPermissionAnywhere(principal, 'hr.employee.read');
export const managesHr = (principal: Principal) => hasPermissionAnywhere(principal, 'hr.employee.manage');
export const seesSensitive = (principal: Principal) => hasPermissionAnywhere(principal, 'hr.sensitive.read');

/** The people this principal may read, as a `User` filter; null when only themselves. */
function directoryScope(principal: Principal): Prisma.UserWhereInput | null {
  if (hasGlobal(principal, 'hr.employee.read')) return { companyId: principal.companyId };
  if (seesDirectory(principal) && principal.coveredDepartmentIds.length > 0) {
    return { companyId: principal.companyId, departmentId: { in: principal.coveredDepartmentIds } };
  }
  return null;
}

function canManageEmployee(principal: Principal, departmentId: string | null) {
  return hasGlobal(principal, 'hr.employee.manage') || (!!departmentId && can(principal, 'hr.employee.manage', { departmentId }));
}

const SENSITIVE_FIELDS = ['pan', 'aadhaar', 'uan', 'esicNumber', 'bankAccountNo'] as const;

/** The profile as the viewer may see it: ID and account numbers masked without the key. */
export function viewProfile(profile: HrEmployeeProfile | null, sensitive: boolean) {
  if (!profile || sensitive) return profile;
  const masked = { ...profile };
  for (const field of SENSITIVE_FIELDS) masked[field] = mask(profile[field]);
  masked.bankIfsc = profile.bankIfsc ? mask(profile.bankIfsc) : null;
  return masked;
}

/** Everything about a stored file except its bytes. */
export const documentListSelect = {
  id: true,
  category: true,
  title: true,
  fileName: true,
  mimeType: true,
  sizeBytes: true,
  version: true,
  supersededAt: true,
  visibleToEmployee: true,
  createdAt: true,
  uploadedBy: { select: { fullName: true } },
} satisfies Prisma.HrDocumentSelect;

const userSelect = {
  id: true,
  employeeCode: true,
  fullName: true,
  email: true,
  phone: true,
  designation: true,
  grade: true,
  status: true,
  avatarColor: true,
  departmentId: true,
  department: { select: { id: true, name: true } },
  manager: { select: { id: true, fullName: true } },
} satisfies Prisma.UserSelect;

// ---------------------------------------------------------------- directory

export async function listEmployees(principal: Principal, filter: DirectoryFilter = {}) {
  const scope = directoryScope(principal);
  if (!scope) throw new ForbiddenError('The employee directory is for HR, Directors and department heads.');
  const f = directoryFilterSchema.parse(filter);
  const people = await prisma.user.findMany({
    where: {
      AND: [
        scope,
        f.status === 'ALL' ? {} : { status: f.status },
        f.departmentId ? { departmentId: f.departmentId } : {},
        f.q
          ? {
              OR: [
                { fullName: { contains: f.q, mode: 'insensitive' } },
                { employeeCode: { contains: f.q, mode: 'insensitive' } },
                { email: { contains: f.q, mode: 'insensitive' } },
                { designation: { contains: f.q, mode: 'insensitive' } },
              ],
            }
          : {},
      ],
    },
    select: {
      ...userSelect,
      hrProfile: { select: { dateOfJoining: true, employmentType: true, dateOfBirth: true, emergencyPhone: true, pan: true, bankAccountNo: true } },
    },
    orderBy: [{ status: 'asc' }, { fullName: 'asc' }],
  });
  return people.map(({ hrProfile, ...person }) => ({
    ...person,
    dateOfJoining: hrProfile?.dateOfJoining ?? null,
    employmentType: hrProfile?.employmentType ?? null,
    missing: missingDetails(hrProfile),
  }));
}

/** Departments the principal can filter the directory by. */
export async function listDirectoryDepartments(principal: Principal) {
  const scope = directoryScope(principal);
  if (!scope) return [];
  return prisma.department.findMany({
    where: { companyId: principal.companyId, ...(hasGlobal(principal, 'hr.employee.read') ? {} : { id: { in: principal.coveredDepartmentIds } }) },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
}

// ---------------------------------------------------------------- one record

/** The employee record the principal may see, or "not found" (never reveals who exists). */
export async function getEmployee(principal: Principal, userId: string) {
  const isSelf = userId === principal.userId;
  const scope = directoryScope(principal);
  if (!isSelf && !scope) throw new NotFoundError('Employee not found.');
  const user = await prisma.user.findFirst({
    where: { id: userId, companyId: principal.companyId, ...(isSelf || !scope ? {} : scope) },
    select: { ...userSelect, hrProfile: true },
  });
  if (!user) throw new NotFoundError('Employee not found.');

  const manage = canManageEmployee(principal, user.departmentId);
  const sensitive = seesSensitive(principal) || isSelf;
  // Department heads see the record but not the employee's files.
  const canSeeDocuments = manage || isSelf;
  const documents = canSeeDocuments
    ? await prisma.hrDocument.findMany({
        where: { companyId: principal.companyId, userId: user.id, ...(manage ? {} : { visibleToEmployee: true }) },
        select: documentListSelect,
        orderBy: [{ category: 'asc' }, { title: 'asc' }, { version: 'desc' }],
      })
    : [];

  const { hrProfile, ...person } = user;
  return {
    person,
    profile: viewProfile(hrProfile, sensitive),
    documents,
    isSelf,
    canManage: manage,
    canEditPersonal: isSelf || manage,
    canEditStatutory: manage && seesSensitive(principal),
    canSeeDocuments,
    sensitiveVisible: sensitive,
  };
}

async function loadForEdit(principal: Principal, userId: string, need: 'personal' | 'manage') {
  const user = await prisma.user.findFirst({
    where: { id: userId, companyId: principal.companyId },
    select: { id: true, departmentId: true, hrProfile: true },
  });
  const isSelf = userId === principal.userId;
  if (!user) throw new NotFoundError('Employee not found.');
  const manage = canManageEmployee(principal, user.departmentId);
  if (need === 'personal' ? !(isSelf || manage) : !manage) {
    if (!isSelf && !directoryScope(principal)) throw new NotFoundError('Employee not found.');
    throw new ForbiddenError(need === 'personal' ? 'You can only change your own details.' : 'Only HR can change this part of the record.');
  }
  return user;
}

/** Fields whose value actually changes, for the update and the audit row. */
function changed<T extends Record<string, unknown>>(before: Partial<HrEmployeeProfile> | null, next: T) {
  const out: Partial<T> = {};
  for (const [key, value] of Object.entries(next) as Array<[keyof T, T[keyof T]]>) {
    const prev = before?.[key as keyof HrEmployeeProfile] ?? null;
    const a = prev instanceof Date ? prev.toISOString() : prev;
    const b = value instanceof Date ? value.toISOString() : (value ?? null);
    if (a !== b) out[key] = value;
  }
  return out;
}

async function saveProfile(principal: Principal, userId: string, before: HrEmployeeProfile | null, data: Prisma.HrEmployeeProfileUncheckedUpdateInput, action: string, auditValues: boolean) {
  const fields = Object.keys(data);
  if (fields.length === 0) return;
  await prisma.$transaction(async (tx) => {
    await tx.hrEmployeeProfile.upsert({
      where: { userId },
      create: { ...(data as Prisma.HrEmployeeProfileUncheckedCreateInput), userId },
      update: data,
    });
    await audit(
      {
        actorId: principal.userId,
        module: 'hr',
        action,
        entityType: 'HrEmployeeProfile',
        entityId: userId,
        // ID and bank numbers never go into the audit trail: only which fields moved.
        diff: auditValues
          ? Object.fromEntries(fields.map((f) => [f, { from: before?.[f as keyof HrEmployeeProfile] ?? null, to: data[f as keyof typeof data] ?? null }]))
          : { fields },
      },
      tx,
    );
  });
}

/** Personal and emergency details: the employee themselves, or HR. */
export async function updatePersonal(principal: Principal, userId: string, input: PersonalInput) {
  const user = await loadForEdit(principal, userId, 'personal');
  const data = personalSchema.parse(input);
  const next = changed(user.hrProfile, { ...data, dateOfBirth: parseDay(data.dateOfBirth) });
  await saveProfile(principal, user.id, user.hrProfile, next, 'hr.profile.personal_updated', true);
}

/** Joining date, employment type, probation and location: HR only. */
export async function updateJob(principal: Principal, userId: string, input: JobInput) {
  const user = await loadForEdit(principal, userId, 'manage');
  const data = jobSchema.parse(input);
  const next = changed(user.hrProfile, {
    ...data,
    dateOfJoining: parseDay(data.dateOfJoining),
    probationEndDate: parseDay(data.probationEndDate),
    confirmationDate: parseDay(data.confirmationDate),
  });
  await saveProfile(principal, user.id, user.hrProfile, next, 'hr.profile.job_updated', true);
}

/** PAN, Aadhaar, UAN, ESIC and bank: HR who may see them unmasked. */
export async function updateStatutory(principal: Principal, userId: string, input: StatutoryInput) {
  const user = await loadForEdit(principal, userId, 'manage');
  if (!seesSensitive(principal)) throw new ForbiddenError('Only HR with access to ID and bank numbers can change them.');
  const data = statutorySchema.parse(input);
  await saveProfile(principal, user.id, user.hrProfile, changed(user.hrProfile, data), 'hr.profile.statutory_updated', false);
}

// ---------------------------------------------------------------- overview

/**
 * The HR overview for anyone with a directory: headcount by department, joiners this month,
 * probations ending in the next 30 days, birthdays and work anniversaries this month, and
 * records missing key details.
 */
export async function getOverview(principal: Principal, now: Date = new Date()) {
  const scope = directoryScope(principal);
  if (!scope) throw new ForbiddenError('The HR overview is for HR, Directors and department heads.');
  const today = todayInIndia(now);
  const in30 = addDays(today, 30);
  const people = await prisma.user.findMany({
    where: { AND: [scope, { status: 'ACTIVE' }] },
    select: {
      id: true,
      fullName: true,
      employeeCode: true,
      designation: true,
      department: { select: { name: true } },
      hrProfile: { select: { dateOfJoining: true, dateOfBirth: true, employmentType: true, probationEndDate: true, confirmationDate: true, emergencyPhone: true, pan: true, bankAccountNo: true } },
    },
    orderBy: { fullName: 'asc' },
  });

  const byDepartment = new Map<string, number>();
  for (const p of people) byDepartment.set(p.department?.name ?? 'No department', (byDepartment.get(p.department?.name ?? 'No department') ?? 0) + 1);

  const dayOfMonth = (d: Date) => d.getUTCDate();
  const joiners = people.filter((p) => {
    const doj = p.hrProfile?.dateOfJoining;
    return !!doj && doj.getUTCFullYear() === today.getUTCFullYear() && doj.getUTCMonth() === today.getUTCMonth();
  });
  const probationEnding = people
    .filter((p) => {
      const end = p.hrProfile?.probationEndDate;
      return !!end && !p.hrProfile?.confirmationDate && end <= in30;
    })
    .sort((a, b) => a.hrProfile!.probationEndDate!.getTime() - b.hrProfile!.probationEndDate!.getTime());
  const birthdays = people
    .filter((p) => isSameMonth(p.hrProfile?.dateOfBirth, today))
    .sort((a, b) => dayOfMonth(a.hrProfile!.dateOfBirth!) - dayOfMonth(b.hrProfile!.dateOfBirth!));
  const anniversaries = people
    .filter((p) => {
      const doj = p.hrProfile?.dateOfJoining;
      return !!doj && isSameMonth(doj, today) && anniversaryYears(doj, today) >= 1;
    })
    .map((p) => ({ ...p, years: anniversaryYears(p.hrProfile!.dateOfJoining!, today) }))
    .sort((a, b) => dayOfMonth(a.hrProfile!.dateOfJoining!) - dayOfMonth(b.hrProfile!.dateOfJoining!));
  const incomplete = people.map((p) => ({ ...p, missing: missingDetails(p.hrProfile) })).filter((p) => p.missing.length > 0);

  return {
    headcount: people.length,
    byDepartment: [...byDepartment.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    joiners,
    probationEnding,
    birthdays,
    anniversaries,
    incomplete,
    today,
  };
}
