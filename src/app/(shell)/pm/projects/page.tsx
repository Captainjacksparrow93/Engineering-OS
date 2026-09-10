import Link from 'next/link';
import { requirePrincipal } from '@/core/auth/session';
import { hasPermissionAnywhere } from '@/core/rbac/engine';
import { listProjects } from '@/modules/project-management/services/project.service';
import { formatDate, daysUntil } from '@/core/utils/dates';
import { Avatar, EmptyState, PageHeader, PriorityBadge, ProgressBar, StatusBadge } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; mine?: string }>;
}) {
  const principal = await requirePrincipal();
  const params = await searchParams;
  const projects = await listProjects(principal, {
    status: params.status,
    search: params.q,
    mine: params.mine === '1',
  });

  const canCreate = hasPermissionAnywhere(principal, 'pm.project.create');

  return (
    <>
      <PageHeader
        title="Projects"
        subtitle={`${projects.length} project${projects.length === 1 ? '' : 's'} you can see`}
        actions={
          canCreate ? (
            <Link href="/pm/projects/new" className="btn btn-primary">
              Define new project
            </Link>
          ) : null
        }
      />

      <form className="mb-4 flex flex-wrap items-end gap-2" action="/pm/projects">
        <div>
          <label className="label" htmlFor="q">
            Search
          </label>
          <input id="q" name="q" defaultValue={params.q ?? ''} className="input w-56" placeholder="Name, code or client" />
        </div>
        <div>
          <label className="label" htmlFor="status">
            Status
          </label>
          <select id="status" name="status" defaultValue={params.status ?? ''} className="select w-44">
            <option value="">All</option>
            {['DRAFT', 'PLANNING', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED'].map((status) => (
              <option key={status} value={status}>
                {status.replaceAll('_', ' ').toLowerCase()}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm text-slate-600">
          <input type="checkbox" name="mine" value="1" defaultChecked={params.mine === '1'} />
          Only mine
        </label>
        <button type="submit" className="btn btn-secondary mb-0.5">
          Apply
        </button>
      </form>

      {projects.length === 0 ? (
        <EmptyState
          title="No projects match"
          hint="Projects appear here when you manage them, are a member, or hold a task on them."
          action={canCreate ? <Link href="/pm/projects/new" className="btn btn-primary">Define new project</Link> : undefined}
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => {
            const due = daysUntil(project.targetEndDate);
            const late = due !== null && due < 0 && project.status !== 'COMPLETED';
            return (
              <Link key={project.id} href={`/pm/projects/${project.id}`} className="card p-4 transition hover:shadow-md">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">{project.name}</p>
                    <p className="font-mono text-[11px] text-slate-400">{project.code}</p>
                  </div>
                  <StatusBadge status={project.status} />
                </div>

                <p className="mb-3 truncate text-xs text-slate-500">{project.clientName}</p>

                <ProgressBar
                  value={project.stats.progressPercent}
                  tone={project.stats.blockedCount > 0 ? 'danger' : undefined}
                />
                <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-500">
                  <span>
                    {project.stats.completedCount}/{project.stats.taskCount} tasks
                  </span>
                  <span>{project.stats.progressPercent}%</span>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <PriorityBadge priority={project.priority} />
                  {project.stats.blockedCount > 0 ? (
                    <span className="badge bg-red-100 text-red-700">{project.stats.blockedCount} blocked</span>
                  ) : null}
                  {project.panelCount > 0 ? (
                    <span className="badge bg-slate-100 text-slate-600">{project.panelCount} panels</span>
                  ) : null}
                </div>

                <div className="mt-3 flex items-center justify-between border-t border-surface-border pt-2.5 text-xs">
                  <span className="flex items-center gap-1.5 text-slate-600">
                    <Avatar name={project.manager.fullName} color={project.manager.avatarColor} size={20} />
                    {project.manager.fullName}
                  </span>
                  <span className={late ? 'font-medium text-red-600' : 'text-slate-500'}>
                    {formatDate(project.targetEndDate)}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
