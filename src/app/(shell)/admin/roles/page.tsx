import { redirect } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { hasPermissionAnywhere } from '@/core/rbac/engine';
import { listRoles } from '@/modules/admin/services/admin.service';
import { PERMISSIONS, type PermissionKey } from '@/core/rbac/permissions';
import { Card, PageHeader } from '@/components/ui';
import { RolePermissionEditor } from './role-editor';

export const dynamic = 'force-dynamic';

/**
 * Roles are bundles of permissions; the scope is chosen when the role is granted.
 * Editing a role changes what everyone holding it can do, everywhere it is granted -
 * which is exactly why the audit trail records every change here.
 */
export default async function RolesPage() {
  const principal = await requirePrincipal();
  if (!hasPermissionAnywhere(principal, 'admin.role.read')) redirect('/dashboard');

  const roles = await listRoles(principal);
  const canManage = hasPermissionAnywhere(principal, 'admin.role.manage');

  const grouped = Object.entries(PERMISSIONS).reduce<Record<string, Array<{ key: PermissionKey; description: string }>>>(
    (acc, [key, description]) => {
      const module = key.split('.')[0]!;
      acc[module] = [...(acc[module] ?? []), { key: key as PermissionKey, description }];
      return acc;
    },
    {},
  );

  return (
    <>
      <PageHeader
        title="Roles & permissions"
        subtitle="Application code checks permissions, never job titles. A role granted on one project gives nothing on another."
      />

      <div className="space-y-4">
        {roles.map((role) => (
          <Card
            key={role.id}
            title={`${role.name} (${role.key})`}
            action={<span className="text-xs text-slate-500">{role._count.assignments} grant(s) live</span>}
          >
            <p className="mb-3 text-sm text-slate-600">{role.description}</p>

            {canManage && role.key !== 'SUPER_ADMIN' ? (
              <RolePermissionEditor
                roleKey={role.key}
                grouped={grouped}
                selected={role.permissions.map((p) => p.permission.key)}
              />
            ) : (
              <div className="flex flex-wrap gap-1">
                {role.permissions.map((p) => (
                  <span key={p.permission.id} className="badge bg-slate-100 font-mono text-slate-600" title={p.permission.description ?? ''}>
                    {p.permission.key}
                  </span>
                ))}
              </div>
            )}
          </Card>
        ))}
      </div>
    </>
  );
}
