import { requirePrincipal } from '@/core/auth/session';
import { hasPermissionAnywhere } from '@/core/rbac/engine';
import { redirect } from 'next/navigation';
import { prisma } from '@/core/db/prisma';
import { listUsers } from '@/modules/admin/services/admin.service';
import { SYSTEM_ROLES } from '@/core/rbac/permissions';
import { Avatar, Card, PageHeader, StatusBadge } from '@/components/ui';
import { UserAdminPanel } from './user-admin-panel';

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

  const scopeName = (scopeType: string, scopeId: string | null) => {
    if (scopeType === 'GLOBAL') return 'company-wide';
    if (scopeType === 'DEPARTMENT') return departments.find((d) => d.id === scopeId)?.name ?? 'a department';
    return projects.find((p) => p.id === scopeId)?.code ?? 'a project';
  };

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

      <Card bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className="table min-w-[900px]">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Department</th>
                <th>Reports to</th>
                <th>Capacity</th>
                <th>Roles & scope</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>
                    <span className="flex items-center gap-2">
                      <Avatar name={user.fullName} color={user.avatarColor} size={28} />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-slate-800">{user.fullName}</span>
                        <span className="block truncate text-[11px] text-slate-400">
                          {user.employeeCode} · {user.email}
                        </span>
                      </span>
                    </span>
                  </td>
                  <td className="text-xs text-slate-600">
                    {user.department?.name ?? '—'}
                    <span className="block text-[11px] text-slate-400">{user.designation}</span>
                  </td>
                  <td className="text-xs text-slate-600">{user.manager?.fullName ?? '—'}</td>
                  <td className="text-xs text-slate-600">{user.dailyCapacityHours}h/day</td>
                  <td>
                    {user.roleAssignments.length === 0 ? (
                      <span className="text-xs text-red-500">no access</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {user.roleAssignments.map((assignment) => (
                          <span key={assignment.id} className="badge bg-slate-100 text-slate-600" title={assignment.role.name}>
                            {assignment.role.key.replaceAll('_', ' ').toLowerCase()}
                            <span className="text-slate-400"> @ {scopeName(assignment.scopeType, assignment.scopeId)}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td>
                    <StatusBadge status={user.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
