import { prisma } from '@/core/db/prisma';
import { assertCan } from '@/core/rbac/guard';
import { DomainError } from '@/core/rbac/errors';
import type { Principal } from '@/core/rbac/types';
import { audit } from '@/core/audit/audit';
import { hashPassword, passwordIssues } from '@/core/auth/password';
import type { ScopeType } from '@prisma/client';

/**
 * Administration: people, role grants and the audit trail.
 *
 * Kept in its own module because HRMS will eventually take over the "people" half of
 * it, while the "who may do what" half stays here as a platform concern.
 */

export async function listUsers(principal: Principal, search?: string) {
  assertCan(principal, 'admin.user.read');
  return prisma.user.findMany({
    where: {
      companyId: principal.companyId,
      ...(search
        ? {
            OR: [
              { fullName: { contains: search, mode: 'insensitive' as const } },
              { email: { contains: search, mode: 'insensitive' as const } },
              { employeeCode: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    },
    include: {
      department: { select: { id: true, name: true } },
      manager: { select: { id: true, fullName: true } },
      roleAssignments: { include: { role: { select: { key: true, name: true } } } },
      _count: { select: { taskAssignments: true } },
    },
    orderBy: [{ status: 'asc' }, { fullName: 'asc' }],
  });
}

export async function createUser(
  principal: Principal,
  input: {
    fullName: string;
    email: string;
    employeeCode: string;
    password: string;
    designation?: string;
    grade: string;
    departmentId?: string;
    managerId?: string;
    dailyCapacityHours?: number;
    skills?: string[];
    roleKey: string;
  },
) {
  assertCan(principal, 'admin.user.manage');

  const issues = passwordIssues(input.password);
  if (issues.length) throw new DomainError(issues.join(' '));

  const clash = await prisma.user.findFirst({
    where: { OR: [{ email: input.email.toLowerCase() }, { employeeCode: input.employeeCode }] },
    select: { id: true },
  });
  if (clash) throw new DomainError('An account with that email or employee code already exists.');

  const role = await prisma.role.findUnique({ where: { key: input.roleKey }, select: { id: true } });
  if (!role) throw new DomainError('Unknown role.');

  const passwordHash = await hashPassword(input.password);

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        companyId: principal.companyId,
        email: input.email.toLowerCase(),
        employeeCode: input.employeeCode,
        passwordHash,
        fullName: input.fullName,
        designation: input.designation,
        grade: input.grade as never,
        departmentId: input.departmentId || null,
        managerId: input.managerId || null,
        dailyCapacityHours: input.dailyCapacityHours ?? 8,
        skills: input.skills ?? [],
        avatarColor: pickColour(input.fullName),
      },
    });

    // A new joiner gets their base role at the scope that matches their placement:
    // department-scoped if they belong to one, global otherwise.
    await tx.roleAssignment.create({
      data: {
        userId: user.id,
        roleId: role.id,
        scopeType: (input.departmentId ? 'DEPARTMENT' : 'GLOBAL') as ScopeType,
        scopeId: input.departmentId || null,
        grantedBy: principal.userId,
      },
    });

    await audit(
      {
        actorId: principal.userId,
        module: 'admin',
        action: 'user.created',
        entityType: 'User',
        entityId: user.id,
        diff: { email: user.email, employeeCode: user.employeeCode, roleKey: input.roleKey },
      },
      tx,
    );

    return user;
  });
}

export async function setUserStatus(principal: Principal, userId: string, status: 'ACTIVE' | 'SUSPENDED' | 'EXITED') {
  assertCan(principal, 'admin.user.manage');
  if (userId === principal.userId) throw new DomainError('You cannot change your own account status.');

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.update({ where: { id: userId }, data: { status } });
    if (status !== 'ACTIVE') {
      // Revoking sessions is the point of keeping them in the database.
      await tx.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    await audit(
      {
        actorId: principal.userId,
        module: 'admin',
        action: 'user.status_changed',
        entityType: 'User',
        entityId: userId,
        diff: { status },
      },
      tx,
    );
    return user;
  });
}

export async function assignRole(
  principal: Principal,
  input: { userId: string; roleKey: string; scopeType: ScopeType; scopeId?: string | null },
) {
  assertCan(principal, 'admin.role.assign');
  const role = await prisma.role.findUnique({ where: { key: input.roleKey }, select: { id: true, key: true } });
  if (!role) throw new DomainError('Unknown role.');
  if (input.scopeType !== 'GLOBAL' && !input.scopeId) {
    throw new DomainError('A department or project must be chosen for this scope.');
  }

  return prisma.$transaction(async (tx) => {
    // Not an upsert: Postgres unique constraints treat NULL as distinct, so a GLOBAL
    // grant (scopeId IS NULL) would never match an existing row and would duplicate.
    const existing = await tx.roleAssignment.findFirst({
      where: {
        userId: input.userId,
        roleId: role.id,
        scopeType: input.scopeType,
        scopeId: input.scopeId ?? null,
      },
    });

    const assignment =
      existing ??
      (await tx.roleAssignment.create({
        data: {
          userId: input.userId,
          roleId: role.id,
          scopeType: input.scopeType,
          scopeId: input.scopeId ?? null,
          grantedBy: principal.userId,
        },
      }));
    await audit(
      {
        actorId: principal.userId,
        module: 'admin',
        action: 'role.assigned',
        entityType: 'User',
        entityId: input.userId,
        diff: { roleKey: role.key, scopeType: input.scopeType, scopeId: input.scopeId ?? null },
      },
      tx,
    );
    return assignment;
  });
}

export async function revokeRole(principal: Principal, assignmentId: string) {
  assertCan(principal, 'admin.role.assign');
  const assignment = await prisma.roleAssignment.findUnique({ where: { id: assignmentId } });
  if (!assignment) throw new DomainError('That grant no longer exists.');

  await prisma.$transaction(async (tx) => {
    await tx.roleAssignment.delete({ where: { id: assignmentId } });
    await audit(
      {
        actorId: principal.userId,
        module: 'admin',
        action: 'role.revoked',
        entityType: 'User',
        entityId: assignment.userId,
        diff: { assignmentId },
      },
      tx,
    );
  });
}

export async function listRoles(principal: Principal) {
  assertCan(principal, 'admin.role.read');
  return prisma.role.findMany({
    include: {
      permissions: { include: { permission: true } },
      _count: { select: { assignments: true } },
    },
    orderBy: { name: 'asc' },
  });
}

export async function setRolePermissions(principal: Principal, roleKey: string, permissionKeys: string[]) {
  assertCan(principal, 'admin.role.manage');
  const role = await prisma.role.findUnique({ where: { key: roleKey }, select: { id: true, isSystem: true, key: true } });
  if (!role) throw new DomainError('Unknown role.');
  if (role.key === 'SUPER_ADMIN') throw new DomainError('The platform administrator role cannot be narrowed.');

  const permissions = await prisma.permission.findMany({
    where: { key: { in: permissionKeys } },
    select: { id: true },
  });

  await prisma.$transaction(async (tx) => {
    await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
    await tx.rolePermission.createMany({
      data: permissions.map((p) => ({ roleId: role.id, permissionId: p.id })),
    });
    await audit(
      {
        actorId: principal.userId,
        module: 'admin',
        action: 'role.permissions_set',
        entityType: 'Role',
        entityId: role.id,
        diff: { permissionKeys },
      },
      tx,
    );
  });
}

export async function listAuditTrail(principal: Principal, filters: { module?: string; entityId?: string } = {}) {
  assertCan(principal, 'admin.audit.read');
  return prisma.auditLog.findMany({
    where: {
      ...(filters.module ? { module: filters.module } : {}),
      ...(filters.entityId ? { entityId: filters.entityId } : {}),
    },
    include: { actor: { select: { id: true, fullName: true, avatarColor: true } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
}

const COLOURS = ['#2f5fd8', '#0f9d58', '#d93025', '#f4b400', '#7b1fa2', '#00838f', '#ef6c00', '#5d4037'];
function pickColour(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) % 997;
  return COLOURS[hash % COLOURS.length]!;
}
