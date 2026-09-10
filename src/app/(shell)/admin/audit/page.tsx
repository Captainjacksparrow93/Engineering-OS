import { redirect } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { hasPermissionAnywhere } from '@/core/rbac/engine';
import { listAuditTrail } from '@/modules/admin/services/admin.service';
import { Avatar, Card, EmptyState, PageHeader } from '@/components/ui';

export const dynamic = 'force-dynamic';

/** Every mutation in every module lands here, written inside the same transaction. */
export default async function AuditPage({ searchParams }: { searchParams: Promise<{ module?: string }> }) {
  const principal = await requirePrincipal();
  if (!hasPermissionAnywhere(principal, 'admin.audit.read')) redirect('/dashboard');

  const params = await searchParams;
  const entries = await listAuditTrail(principal, { module: params.module });

  return (
    <>
      <PageHeader title="Audit trail" subtitle="The last 100 changes, newest first." />

      <form className="mb-4 flex items-end gap-2" action="/admin/audit">
        <div>
          <label className="label" htmlFor="module">Module</label>
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
                  <th>Entity</th>
                  <th>Change</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td className="whitespace-nowrap text-caption text-muted">
                      {entry.createdAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
                    </td>
                    <td>
                      {entry.actor ? (
                        <span className="flex items-center gap-1.5 text-caption text-ink">
                          <Avatar name={entry.actor.fullName} color={entry.actor.avatarColor} size={20} />
                          {entry.actor.fullName}
                        </span>
                      ) : (
                        <span className="text-caption text-muted-soft">system</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap">
                      <span className="code-chip">
                        {entry.module}.{entry.action}
                      </span>
                    </td>
                    <td className="text-caption text-body">
                      {entry.entityType}
                      <span className="code block text-caption text-muted-soft">{entry.entityId.slice(0, 10)}…</span>
                    </td>
                    <td>
                      <pre className="max-w-md overflow-x-auto whitespace-pre-wrap break-words text-caption text-muted">
                        {entry.diff ? JSON.stringify(entry.diff) : '—'}
                      </pre>
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
