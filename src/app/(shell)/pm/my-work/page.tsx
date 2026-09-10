import Link from 'next/link';
import { requirePrincipal } from '@/core/auth/session';
import { listMyTasks } from '@/modules/project-management/services/task.service';
import { formatDate, daysUntil } from '@/core/utils/dates';
import { Card, EmptyState, PageHeader, PriorityBadge, ProgressBar, Stat, StatusBadge } from '@/components/ui';

export const dynamic = 'force-dynamic';

/** The engineer's queue: what they hold, what is late, and what is blocked and why. */
export default async function MyWorkPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; all?: string }>;
}) {
  const principal = await requirePrincipal();
  const params = await searchParams;
  const rows = await listMyTasks(principal, { status: params.status, includeCompleted: params.all === '1' });

  const today = new Date();
  const overdue = rows.filter((r) => r.task.plannedEnd && r.task.plannedEnd < today);
  const blocked = rows.filter((r) => r.task.status === 'BLOCKED');
  const inProgress = rows.filter((r) => r.task.status === 'IN_PROGRESS');
  const totalHours = rows.reduce((sum, r) => sum + r.assignment.allocatedHours * (1 - r.task.percentComplete / 100), 0);

  return (
    <>
      <PageHeader
        title="My work"
        subtitle="Everything currently assigned to you, across every project."
        actions={
          <Link href={params.all === '1' ? '/pm/my-work' : '/pm/my-work?all=1'} className="btn btn-secondary">
            {params.all === '1' ? 'Hide closed' : 'Show closed'}
          </Link>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Open tasks" value={rows.length} />
        <Stat label="In progress" value={inProgress.length} />
        <Stat label="Blocked" value={blocked.length} tone={blocked.length ? 'warning' : 'default'} />
        <Stat label="Remaining effort" value={`${Math.round(totalHours)}h`} tone={overdue.length ? 'danger' : 'default'} hint={`${overdue.length} overdue`} />
      </div>

      {rows.length === 0 ? (
        <EmptyState title="Nothing on your plate" hint="Tasks assigned or handed to you show up here immediately." />
      ) : (
        <Card bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className="table min-w-[860px]">
              <thead>
                <tr>
                  <th className="w-[34%]">Task</th>
                  <th>Project</th>
                  <th>Due</th>
                  <th>Progress</th>
                  <th>Status</th>
                  <th>Waiting on</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ task, assignment, unmetDependencies }) => {
                  const due = daysUntil(task.plannedEnd);
                  return (
                    <tr key={assignment.id}>
                      <td>
                        <Link href={`/pm/tasks/${task.id}`} className="font-medium text-slate-800 hover:text-brand-600">
                          {task.title}
                        </Link>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-[11px] text-slate-400">{task.code}</span>
                          <PriorityBadge priority={task.priority} />
                          {task.type === 'ADHOC' ? <span className="badge bg-fuchsia-100 text-fuchsia-700">ad-hoc</span> : null}
                          {assignment.role !== 'OWNER' ? (
                            <span className="badge bg-slate-100 text-slate-600">{assignment.role.toLowerCase()}</span>
                          ) : null}
                        </div>
                      </td>
                      <td className="text-xs text-slate-500">
                        <Link href={`/pm/projects/${task.project.id}`} className="hover:text-brand-600">
                          {task.project.code}
                        </Link>
                        <span className="block text-[11px] text-slate-400">{task.project.clientName}</span>
                      </td>
                      <td className="whitespace-nowrap text-xs">
                        {task.plannedEnd ? (
                          <>
                            <span className={due !== null && due < 0 ? 'font-medium text-red-600' : 'text-slate-600'}>
                              {formatDate(task.plannedEnd)}
                            </span>
                            <span className="block text-[11px] text-slate-400">
                              {due !== null ? (due < 0 ? `${-due}d late` : `in ${due}d`) : ''}
                            </span>
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="w-28">
                        <ProgressBar value={task.percentComplete} tone={task.status === 'BLOCKED' ? 'danger' : undefined} />
                        <span className="mt-1 block text-[11px] text-slate-500">{task.percentComplete}%</span>
                      </td>
                      <td>
                        <StatusBadge status={task.status} />
                      </td>
                      <td className="text-xs">
                        {unmetDependencies.length === 0 ? (
                          <span className="text-emerald-600">clear</span>
                        ) : (
                          unmetDependencies.map((dep) => (
                            <Link key={dep.id} href={`/pm/tasks/${dep.id}`} className="block font-mono text-[11px] text-red-600 hover:underline">
                              {dep.code}
                            </Link>
                          ))
                        )}
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
