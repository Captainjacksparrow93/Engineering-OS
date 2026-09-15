import { requirePrincipal } from '@/core/auth/session';
import { hasPermissionAnywhere } from '@/core/rbac/engine';
import { redirect } from 'next/navigation';
import { prisma } from '@/core/db/prisma';
import { listUsers } from '@/modules/admin/services/admin.service';
import { SYSTEM_ROLES } from '@/core/rbac/permissions';
import { PageHeader } from '@/components/ui';
import { UsersTable } from './users-table';

export const dynamic = 'force-dynamic';

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

  try {
    [users, departments, projects] = await Promise.all([
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
    ]);
  } catch (error) {
    console.error('Failed to load users page data:', error);
    redirect('/dashboard');
  }

  const canManage = hasPermissionAnywhere(principal, 'admin.user.manage');
  const canAssign = hasPermissionAnywhere(principal, 'admin.role.assign');
  const roleOptions = Object.entries(SYSTEM_ROLES).map(([key, role]) => ({ key, name: role.name }));

  return (
    <>
      <PageHeader
        title="People & access"
      />

      <UsersTable
        users={users}
        departments={departments}
        projects={projects}
        canManage={canManage}
        canAssign={canAssign}
        roleOptions={roleOptions}
        searchQuery={params.q ?? ''}
      />
    </>
  );
}
