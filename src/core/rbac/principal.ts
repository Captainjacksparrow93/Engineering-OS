import { prisma } from '@/core/db/prisma';
import type { PermissionKey } from './permissions';
import type { Grant, Principal } from './types';

/**
 * Builds the full authorisation context for a user in a handful of queries.
 *
 * Two things are pre-computed here rather than at check time, because they are the
 * expensive parts and they do not change within a request:
 *   1. DEPARTMENT grants are expanded down the department tree.
 *   2. Project membership is folded in, so "is on the project" needs no extra query.
 */
export async function loadPrincipal(userId: string): Promise<Principal | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      companyId: true,
      employeeCode: true,
      fullName: true,
      email: true,
      grade: true,
      departmentId: true,
      managerId: true,
      avatarColor: true,
      status: true,
      roleAssignments: {
        where: { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
        select: {
          scopeType: true,
          scopeId: true,
          role: {
            select: {
              key: true,
              permissions: { select: { permission: { select: { key: true } } } },
            },
          },
        },
      },
      projectMembers: { select: { projectId: true } },
    },
  });

  if (!user || user.status !== 'ACTIVE') return null;

  const grants: Grant[] = [];
  const roleKeys: string[] = [];
  const departmentScopeIds = new Set<string>();
  const projectScopeIds = new Set<string>();

  for (const assignment of user.roleAssignments) {
    roleKeys.push(assignment.role.key);
    if (assignment.scopeType === 'DEPARTMENT' && assignment.scopeId) departmentScopeIds.add(assignment.scopeId);
    if (assignment.scopeType === 'PROJECT' && assignment.scopeId) projectScopeIds.add(assignment.scopeId);
    for (const rp of assignment.role.permissions) {
      grants.push({
        permission: rp.permission.key as PermissionKey,
        scopeType: assignment.scopeType,
        scopeId: assignment.scopeId,
      });
    }
  }

  const coveredDepartmentIds = await expandDepartmentSubtrees(user.companyId, [...departmentScopeIds]);
  for (const pm of user.projectMembers) projectScopeIds.add(pm.projectId);

  return {
    userId: user.id,
    companyId: user.companyId,
    employeeCode: user.employeeCode,
    fullName: user.fullName,
    email: user.email,
    grade: user.grade,
    departmentId: user.departmentId,
    managerId: user.managerId,
    avatarColor: user.avatarColor,
    grants: dedupeGrants(grants),
    coveredDepartmentIds,
    memberProjectIds: [...projectScopeIds],
    roleKeys: [...new Set(roleKeys)],
  };
}

/**
 * A grant on a department implies the same grant on everything under it. Department
 * trees are small (tens of rows), so one read of the company's departments beats a
 * recursive CTE and keeps the logic testable.
 */
export async function expandDepartmentSubtrees(companyId: string, rootIds: string[]): Promise<string[]> {
  if (rootIds.length === 0) return [];
  const departments = await prisma.department.findMany({
    where: { companyId },
    select: { id: true, parentId: true },
  });

  const childrenByParent = new Map<string, string[]>();
  for (const d of departments) {
    if (!d.parentId) continue;
    const list = childrenByParent.get(d.parentId) ?? [];
    list.push(d.id);
    childrenByParent.set(d.parentId, list);
  }

  const covered = new Set<string>();
  const queue = [...rootIds];
  while (queue.length) {
    const current = queue.shift()!;
    if (covered.has(current)) continue;
    covered.add(current);
    for (const child of childrenByParent.get(current) ?? []) queue.push(child);
  }
  return [...covered];
}

function dedupeGrants(grants: Grant[]): Grant[] {
  const seen = new Set<string>();
  const out: Grant[] = [];
  for (const g of grants) {
    const key = `${g.permission}|${g.scopeType}|${g.scopeId ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(g);
  }
  return out;
}
