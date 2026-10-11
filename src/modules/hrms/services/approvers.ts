import { prisma, type Tx } from '@/core/db/prisma';
import { can } from '@/core/rbac/engine';
import type { Principal } from '@/core/rbac/types';

/**
 * Who approves for an employee (plan 020, phase 2). Leave goes to the reporting manager, then
 * to the department head. A department head is anyone whose `hr.leave.approve` grant covers
 * the employee's department; a global grant (HR Manager, Director) covers everyone and stands
 * in when a department has no head.
 */

export interface Applicant {
  id: string;
  departmentId: string | null;
  managerId: string | null;
}

/** The manager step applies when the employee has an active manager other than themselves. */
export async function activeManagerId(applicant: Applicant, tx: Tx = prisma): Promise<string | null> {
  if (!applicant.managerId || applicant.managerId === applicant.id) return null;
  const manager = await tx.user.findFirst({ where: { id: applicant.managerId, status: 'ACTIVE' }, select: { id: true } });
  return manager?.id ?? null;
}

/** May this principal give the department-head approval for this employee? Never for themselves. */
export function canApproveAsHead(principal: Principal, applicant: Applicant): boolean {
  if (applicant.id === principal.userId) return false;
  return can(principal, 'hr.leave.approve', applicant.departmentId ? { departmentId: applicant.departmentId } : {});
}

/** Ids of the department and every department above it. */
async function departmentChain(departmentId: string | null, tx: Tx): Promise<string[]> {
  const chain: string[] = [];
  let id = departmentId;
  while (id && !chain.includes(id)) {
    chain.push(id);
    const dept = await tx.department.findUnique({ where: { id }, select: { parentId: true } });
    id = dept?.parentId ?? null;
  }
  return chain;
}

/**
 * People to notify for the department-head step: the heads whose scope covers the employee's
 * department, or HR and Directors (global grant) when there are none. The employee is never
 * their own approver.
 */
export async function headApproverIds(companyId: string, applicant: Applicant, tx: Tx = prisma): Promise<string[]> {
  const chain = await departmentChain(applicant.departmentId, tx);
  const holders = (scope: object) =>
    tx.user.findMany({
      where: {
        companyId,
        status: 'ACTIVE',
        id: { not: applicant.id },
        roleAssignments: { some: { ...scope, role: { permissions: { some: { permission: { key: 'hr.leave.approve' } } } } } },
      },
      select: { id: true },
    });
  const heads = chain.length ? await holders({ scopeType: 'DEPARTMENT', scopeId: { in: chain } }) : [];
  const ids = heads.length ? heads : await holders({ scopeType: 'GLOBAL' });
  return ids.map((u) => u.id);
}
