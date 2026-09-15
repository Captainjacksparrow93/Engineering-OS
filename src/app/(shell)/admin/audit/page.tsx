import { redirect } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { hasPermissionAnywhere } from '@/core/rbac/engine';
import { listAuditTrail } from '@/modules/admin/services/admin.service';
import { Avatar, Card, EmptyState, PageHeader } from '@/components/ui';

export const dynamic = 'force-dynamic';

// Human-friendly mapping for actions
function formatAction(module: string, action: string): string {
  const fullKey = `${module}.${action}`;
  const map: Record<string, string> = {
    'core.auth.signed_in': 'Signed in',
    'core.auth.signed_out': 'Signed out',
    'core.auth.failed_login': 'Sign in failed',
    'admin.user.created': 'Added employee',
    'admin.user.status_changed': 'Changed status',
    'admin.user.updated': 'Updated employee',
    'admin.user.password_reset': 'Reset password',
    'admin.role.assigned': 'Granted role',
    'admin.role.revoked': 'Removed role',
    'pm.project.created': 'Created project',
    'pm.project.updated': 'Updated project',
    'pm.task.created': 'Created task',
    'pm.task.updated': 'Updated task',
    'pm.task.status_changed': 'Changed task status',
    'pm.wbs.created': 'Created WBS',
    'pm.milestone.created': 'Created milestone',
    'pm.document.uploaded': 'Uploaded document',
  };

  if (map[fullKey]) return map[fullKey];

  // Fallback: clean the action string
  const clean = action.replace(/_/g, ' ').replace(/\./g, ' ');
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

// Human-friendly mapping for item types
function formatItemType(entityType: string): string {
  const map: Record<string, string> = {
    User: 'Employee account',
    RoleAssignment: 'Access role',
    Project: 'Project',
    Task: 'Task',
    WbsNode: 'WBS item',
    Milestone: 'Milestone',
    Document: 'Document',
    Department: 'Department',
    Company: 'Company',
  };

  return map[entityType] ?? entityType.replace(/([A-Z])/g, ' $1').trim();
}

// Clean timestamp: '12/9/2026, 1:14 PM' (no seconds, uppercase AM/PM)
function formatTimestamp(date: Date): string {
  const formatted = date.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hour12: true,
  });
  return formatted.replace(/\b(am|pm)\b/i, (m) => m.toUpperCase());
}

// Clean formatting for changes
function formatDiff(diff: unknown): string {
  if (!diff || (typeof diff === 'object' && Object.keys(diff as object).length === 0)) {
    return '-';
  }
  if (typeof diff === 'object' && diff !== null) {
    const entries = Object.entries(diff as Record<string, unknown>);
    return entries
      .map(([k, v]) => {
        const keyName = k.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').toLowerCase();
        let valStr = '';
        if (typeof v === 'string') {
          valStr = v.replace(/_/g, ' ').toLowerCase();
        } else if (typeof v === 'object' && v !== null) {
          valStr = JSON.stringify(v);
        } else {
          valStr = String(v);
        }
        return `${keyName}: ${valStr}`;
      })
      .join(', ');
  }
  return String(diff);
}

/** Every mutation in every module lands here, written inside the same transaction. */
export default async function AuditPage({ searchParams }: { searchParams: Promise<{ module?: string }> }) {
  const principal = await requirePrincipal();
  if (!hasPermissionAnywhere(principal, 'admin.audit.read')) redirect('/dashboard');

  const params = await searchParams;
  const entries = await listAuditTrail(principal, { module: params.module });

  return (
    <>
      <PageHeader title="Audit trail" />

      <form className="mb-4 flex items-end gap-2" action="/admin/audit">
        <div>
          <label className="label" htmlFor="module">Category</label>
          <select id="module" name="module" defaultValue={params.module ?? ''} className="select w-48">
            <option value="">All</option>
            <option value="pm">Project management</option>
            <option value="admin">Administration</option>
            <option value="core">Platform</option>
          </select>
        </div>
        <button type="submit" className="btn btn-secondary mb-0.5">Filter</button>
      </form>

      {entries.length === 0 ? (
        <EmptyState title="Nothing recorded yet" />
      ) : (
        <Card bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className="table min-w-[820px]">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Who</th>
                  <th>Action</th>
                  <th>Item</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td className="whitespace-nowrap text-caption text-muted">
                      {formatTimestamp(entry.createdAt)}
                    </td>
                    <td>
                      {entry.actor ? (
                        <span className="flex items-center gap-1.5 text-caption text-ink font-medium">
                          <Avatar name={entry.actor.fullName} color={entry.actor.avatarColor} size={20} />
                          {entry.actor.fullName}
                        </span>
                      ) : (
                        <span className="text-caption text-muted-soft">System</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap">
                      <span className="badge bg-surface-strong text-body font-medium">
                        {formatAction(entry.module, entry.action)}
                      </span>
                    </td>
                    <td className="text-caption text-body font-medium">
                      {formatItemType(entry.entityType)}
                    </td>
                    <td className="text-caption text-muted">
                      <span className="max-w-md block truncate" title={formatDiff(entry.diff)}>
                        {formatDiff(entry.diff)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
