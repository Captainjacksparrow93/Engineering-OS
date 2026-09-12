import { requirePrincipal } from '@/core/auth/session';
import { hasPermissionAnywhere } from '@/core/rbac/engine';
import { redirect } from 'next/navigation';
import { prisma } from '@/core/db/prisma';
import { listUsers } from '@/modules/admin/services/admin.service';
import { SYSTEM_ROLES } from '@/core/rbac/permissions';
import { PageHeader } from '@/components/ui';
import { UserAdminPanel } from './user-admin-panel';
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
  const [users, departments, projects] = await Promise.all([
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

  const canManage = hasPermissionAnywhere(principal, 'admin.user.manage');
  const canAssign = hasPermissionAnywhere(principal, 'admin.role.assign');
  const roleOptions = Object.entries(SYSTEM_ROLES).map(([key, role]) => ({ key, name: role.name }));

  return (
    <>
      <PageHeader
        title="People & access"
        subtitle={`${users.length} account${users.length === 1 ? '' : 's'}. Roles are always granted at a scope — company, department or a single project.`}
      />

      <form className="mb-4 flex items-end gap-2" action="/admin/users">
        <div>
          <label className="label" htmlFor="q">Search</label>
          <input id="q" name="q" defaultValue={params.q ?? ''} className="input w-64" placeholder="Name, email or employee code" />
        </div>
        <button type="submit" className="btn btn-secondary mb-0.5">Search</button>
      </form>

      {canManage || canAssign ? (
        <div className="mb-4">
          <UserAdminPanel
            canCreate={canManage}
            canAssign={canAssign}
            roles={roleOptions}
            departments={departments}
            projects={projects}
            users={users.map((u) => ({ id: u.id, fullName: u.fullName, employeeCode: u.employeeCode }))}
          />
        </div>
      ) : null}

      <UsersTable
        users={users}
        departments={departments}
        projects={projects}
      />
    </>
  );
}
