import { redirect } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { hasPermissionAnywhere } from '@/core/rbac/engine';
import { prisma } from '@/core/db/prisma';
import { listAuditTrail } from '@/modules/admin/services/admin.service';
import { formatName } from '@/core/utils/strings';
import { Avatar, Card, EmptyState, PageHeader } from '@/components/ui';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Audit trail',
};

import Link from 'next/link';
import {
  formatAuditAction,
  formatAuditItem,
  formatAuditDetails,
} from '@/modules/admin/domain/audit-format';

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

/** Every mutation in every module lands here, written inside the same transaction. */
export default async function AuditPage({ searchParams }: { searchParams: Promise<{ module?: string }> }) {
  const principal = await requirePrincipal();
  if (!hasPermissionAnywhere(principal, 'admin.audit.read')) redirect('/dashboard');

  const params = await searchParams;
  const [entries, allUsers, allProjects, allTasks, allDepts, allRoles] = await Promise.all([
    listAuditTrail(principal, { module: params.module }),
    prisma.user.findMany({ where: { companyId: principal.companyId }, select: { id: true, fullName: true } }),
    prisma.project.findMany({ where: { companyId: principal.companyId }, select: { id: true, name: true } }),
    prisma.task.findMany({ where: { project: { companyId: principal.companyId } }, select: { id: true, title: true } }),
    prisma.department.findMany({ where: { companyId: principal.companyId }, select: { id: true, name: true } }),
    prisma.role.findMany({ select: { key: true, name: true } }),
  ]);

  const nameMap = new Map<string, string>();
  allUsers.forEach((u) => nameMap.set(u.id, formatName(u.fullName)));
  allProjects.forEach((p) => nameMap.set(p.id, p.name));
  allTasks.forEach((t) => nameMap.set(t.id, t.title));
  allDepts.forEach((d) => nameMap.set(d.id, d.name));
  allRoles.forEach((r) => nameMap.set(r.key, r.name));

  const existingProjectIds = new Set(allProjects.map((p) => p.id));
  const existingTaskIds = new Set(allTasks.map((t) => t.id));

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
                {entries.map((entry) => {
                  const detailsText = formatAuditDetails(
                    {
                      module: entry.module,
                      action: entry.action,
                      entityType: entry.entityType,
                      diff: entry.diff,
                    },
                    nameMap
                  );
                  const actorName = entry.actor ? formatName(entry.actor.fullName) : 'System';
                  const item = formatAuditItem(
                    {
                      module: entry.module,
                      action: entry.action,
                      entityType: entry.entityType,
                      entityId: entry.entityId,
                    },
                    nameMap
                  );

                  const canLinkItem =
                    item.href &&
                    ((entry.entityType === 'Project' && existingProjectIds.has(entry.entityId)) ||
                      (entry.entityType === 'Task' && existingTaskIds.has(entry.entityId)));

                  return (
                    <tr key={entry.id}>
                      <td className="whitespace-nowrap text-caption text-muted">
                        {formatTimestamp(entry.createdAt)}
                      </td>
                      <td>
                        {entry.actor ? (
                          <span className="flex items-center gap-1.5 text-caption text-ink font-medium">
                            <Avatar name={actorName} color={entry.actor.avatarColor} size={20} />
                            {actorName}
                          </span>
                        ) : (
                          <span className="text-caption text-muted-soft">System</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap">
                        <span className="badge bg-surface-strong text-body font-medium">
                          {formatAuditAction(entry.module, entry.action)}
                        </span>
                      </td>
                      <td className="text-caption text-body font-medium">
                        {canLinkItem ? (
                          <Link href={item.href!} className="text-primary hover:underline">
                            {item.label}
                          </Link>
                        ) : (
                          <span>{item.label}</span>
                        )}
                      </td>
                      <td className="text-caption text-ink">
                        <span className="max-w-xl block truncate hover:whitespace-normal" title={detailsText}>
                          {detailsText}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
