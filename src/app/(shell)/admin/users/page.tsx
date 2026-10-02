import { requirePrincipal } from '@/core/auth/session';
import { hasPermissionAnywhere } from '@/core/rbac/engine';
import { redirect } from 'next/navigation';
import { prisma } from '@/core/db/prisma';
import { listUsers } from '@/modules/admin/services/admin.service';
import { SYSTEM_ROLES } from '@/core/rbac/permissions';
import { PageHeader } from '@/components/ui';
import { UsersTable } from './users-table';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'People',
};

/**
 * People and their access.
 *
 * When HRMS ships it takes over the employee master; this screen keeps the access half
 * (who holds which role, at which scope) which stays a platform concern.
 */
export default async function UsersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const principal = await requirePrincipal();
  if (!hasPermissionAnywhere(principal, 'admin.user.read')) redirect('/dashboard');

  const params = await searchParams;
  let users: Awaited<ReturnType<typeof listUsers>> = [];
  let departments: Array<{ id: string; name: string }> = [];
  let projects: Array<{ id: string; code: string; name: string }> = [];
  let lastSignInMap = new Map<string, Date>();
  let workloadMap = new Map<string, { openTasks: number; loadHours: number }>();

  try {
    const [userList, deptList, projList, signIns, activeAssignments] = await Promise.all([
      listUsers(principal, params.q),
      prisma.department.findMany({
        where: { companyId: principal.companyId },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      prisma.project.findMany({
        where: { companyId: principal.companyId, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
        select: { id: true, code: true, name: true },
        orderBy: { code: 'asc' },
      }),
      prisma.auditLog.groupBy({
        by: ['entityId'],
        where: {
          module: 'core',
          action: 'auth.signed_in',
          entityType: 'User',
          actor: { companyId: principal.companyId },
        },
        _max: { createdAt: true },
      }),
      prisma.taskAssignment.findMany({
        where: {
          user: { companyId: principal.companyId },
          status: 'ACTIVE',
          task: {
            status: { in: ['TODO', 'IN_PROGRESS', 'IN_REVIEW'] },
            project: { status: { notIn: ['COMPLETED', 'CANCELLED'] } },
          },
        },
        select: {
          userId: true,
          allocatedHours: true,
          task: { select: { estimatedHours: true } },
        },
      }),
    ]);

    users = userList;
    departments = deptList;
    projects = projList;

    for (const s of signIns) {
      const createdAt = s._max?.createdAt;
      if (createdAt) lastSignInMap.set(s.entityId, createdAt);
    }

    for (const a of activeAssignments) {
      const current = workloadMap.get(a.userId) ?? { openTasks: 0, loadHours: 0 };
      current.openTasks += 1;
      current.loadHours += a.allocatedHours || a.task.estimatedHours || 0;
      workloadMap.set(a.userId, current);
    }
  } catch (error) {
    console.error('Failed to load users page data:', error);
    redirect('/dashboard');
  }

  const canManage = hasPermissionAnywhere(principal, 'admin.user.manage');
  const canAssign = hasPermissionAnywhere(principal, 'admin.role.assign');
  const canResetPassword = hasPermissionAnywhere(principal, 'admin.user.password.reset');
  const roleOptions = Object.entries(SYSTEM_ROLES).map(([key, role]) => ({ key, name: role.name }));

  const userRows = users.map((u) => ({
    ...u,
    createdAt: u.createdAt,
    lastSignInAt: lastSignInMap.get(u.id) ?? null,
    openTasksCount: workloadMap.get(u.id)?.openTasks ?? 0,
    loadHours: workloadMap.get(u.id)?.loadHours ?? 0,
  }));

  return (
    <>
      <PageHeader
        title="People & access"
      />

      <UsersTable
        users={userRows}
        departments={departments}
        projects={projects}
        canManage={canManage}
        canAssign={canAssign}
        canResetPassword={canResetPassword}
        roleOptions={roleOptions}
        searchQuery={params.q ?? ''}
      />
    </>
  );
}
