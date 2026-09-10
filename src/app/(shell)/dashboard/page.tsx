import Link from 'next/link';
import { requirePrincipal } from '@/core/auth/session';
import { getDashboard } from '@/modules/project-management/services/dashboard.service';
import { formatDate, daysUntil } from '@/core/utils/dates';
import { Avatar, Card, EmptyState, PageHeader, PriorityBadge, ProgressBar, Stat, StatusBadge } from '@/components/ui';

export const dynamic = 'force-dynamic';

/**
 * One dashboard, two audiences. Management sees portfolio health and the live blocker
 * list; everyone sees their own queue and anything waiting on their decision.
 */
export default async function DashboardPage() {
  const principal = await requirePrincipal();
  const data = await getDashboard(principal);

  return (
    <>
      <PageHeader
        title={`Good day, ${principal.fullName.split(' ')[0]}`}
        subtitle={
          data.isManagement
            ? 'Portfolio health across everything you are responsible for.'
            : 'Your work queue and anything waiting on you.'
        }
        actions={
          <>
            <Link href="/pm/my-work" className="btn btn-secondary">
              My work
            </Link>
            <Link href="/pm/adhoc" className="btn btn-primary">
              Assign ad-hoc task
            </Link>
          </>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {data.isManagement ? (
          <>
            <Stat label="Active projects" value={data.portfolio.activeProjects} />
            <Stat label="Projects at risk" value={data.portfolio.atRisk} tone={data.portfolio.atRisk ? 'danger' : 'success'} hint="Blocked or overdue work" />
            <Stat label="Blocked tasks" value={data.portfolio.blockedTasks} tone={data.portfolio.blockedTasks ? 'warning' : 'default'} />
            <Stat label="Overdue tasks" value={data.portfolio.overdueTasks} tone={data.portfolio.overdueTasks ? 'danger' : 'success'} />
          </>
        ) : (
          <>
            <Stat label="Open tasks" value={data.myWork.total} />
            <Stat label="Due this week" value={data.myWork.dueThisWeek} tone="warning" />
            <Stat label="Overdue" value={data.myWork.overdue} tone={data.myWork.overdue ? 'danger' : 'success'} />
            <Stat label="Blocked" value={data.myWork.blocked} tone={data.myWork.blocked ? 'warning' : 'default'} />
          </>
        )}
      </div>

      {data.incomingHandovers.length > 0 ? (
        <div className="mb-6">
          <Card
            title={`${data.incomingHandovers.length} handover${data.incomingHandovers.length > 1 ? 's' : ''} waiting on you`}
            action={
              <Link href="/pm/handovers" className="btn btn-primary btn-sm">
                Review
              </Link>
            }
          >
            <ul className="divide-y divide-surface-border">
              {data.incomingHandovers.map((handover) => (
                <li key={handover.id} className="flex flex-wrap items-center gap-3 py-2 first:pt-0 last:pb-0">
                  <Avatar name={handover.fromUser.fullName} color={handover.fromUser.avatarColor} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-slate-800">
                      <span className="font-medium">{handover.fromUser.fullName}</span> wants to pass you{' '}
                      <Link href={`/pm/tasks/${handover.task.id}`} className="text-brand-600 hover:underline">
                        {handover.task.code}
                      </Link>{' '}
                      — {handover.task.title}
                    </p>
                    <p className="truncate text-xs text-slate-500">{handover.reason}</p>
                  </div>
                  <span className="badge bg-violet-100 text-violet-700">{handover.remainingPercent}% left</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <Card
            title="My work"
            action={
              <Link href="/pm/my-work" className="text-xs font-medium text-brand-600 hover:underline">
                View all
              </Link>
            }
            bodyClassName="p-0"
          >
            {data.myWork.items.length === 0 ? (
              <div className="p-4">
                <EmptyState title="Nothing assigned to you right now" hint="New work will appear here the moment it is assigned." />
              </div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Task</th>
                    <th>Project</th>
                    <th>Due</th>
                    <th>Progress</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.myWork.items.slice(0, 8).map(({ task }) => {
                    const due = daysUntil(task.plannedEnd);
                    return (
                      <tr key={task.id}>
                        <td>
                          <Link href={`/pm/tasks/${task.id}`} className="font-medium text-slate-800 hover:text-brand-600">
                            {task.title}
                          </Link>
                          <div className="mt-0.5 flex items-center gap-2">
                            <span className="font-mono text-[11px] text-slate-400">{task.code}</span>
                            {task.type === 'ADHOC' ? <span className="badge bg-fuchsia-100 text-fuchsia-700">ad-hoc</span> : null}
                            <PriorityBadge priority={task.priority} />
                          </div>
                        </td>
                        <td className="text-xs text-slate-500">{task.project.code}</td>
                        <td className="whitespace-nowrap text-xs">
                          {task.plannedEnd ? (
                            <span className={due !== null && due < 0 ? 'font-medium text-red-600' : 'text-slate-600'}>
                              {formatDate(task.plannedEnd)}
                              {due !== null ? <span className="block text-[11px] text-slate-400">{due < 0 ? `${-due}d late` : `in ${due}d`}</span> : null}
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="w-28">
                          <ProgressBar value={task.percentComplete} />
                          <span className="mt-1 block text-[11px] text-slate-500">{task.percentComplete}%</span>
                        </td>
                        <td>
                          <StatusBadge status={task.status} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Card>

          {data.isManagement ? (
            <Card title="Projects" action={<Link href="/pm/projects" className="text-xs font-medium text-brand-600 hover:underline">View all</Link>} bodyClassName="p-0">
              {data.projects.length === 0 ? (
                <div className="p-4">
                  <EmptyState title="No active projects" />
                </div>
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Project</th>
                      <th>Manager</th>
                      <th>Target</th>
                      <th>Progress</th>
                      <th>Risk</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.projects.slice(0, 8).map((project) => (
                      <tr key={project.id}>
                        <td>
                          <Link href={`/pm/projects/${project.id}`} className="font-medium text-slate-800 hover:text-brand-600">
                            {project.name}
                          </Link>
                          <div className="mt-0.5 flex items-center gap-2">
                            <span className="font-mono text-[11px] text-slate-400">{project.code}</span>
                            <PriorityBadge priority={project.priority} />
                          </div>
                        </td>
                        <td>
                          <span className="flex items-center gap-1.5 text-xs text-slate-600">
                            <Avatar name={project.manager.fullName} color={project.manager.avatarColor} size={20} />
                            {project.manager.fullName.split(' ')[0]}
                          </span>
                        </td>
                        <td className="whitespace-nowrap text-xs text-slate-600">{formatDate(project.targetEndDate)}</td>
                        <td className="w-28">
                          <ProgressBar value={project.progressPercent} />
                          <span className="mt-1 block text-[11px] text-slate-500">{project.progressPercent}%</span>
                        </td>
                        <td className="whitespace-nowrap text-xs">
                          {project.blockedCount > 0 ? <span className="badge bg-red-100 text-red-700">{project.blockedCount} blocked</span> : null}
                          {project.overdueCount > 0 ? <span className="badge ml-1 bg-amber-100 text-amber-700">{project.overdueCount} late</span> : null}
                          {project.blockedCount === 0 && project.overdueCount === 0 ? <span className="text-emerald-600">on track</span> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          ) : null}
        </div>

        <div className="space-y-4">
          {data.isManagement ? (
            <Card title="Blockers raised recently">
              {data.blockers.length === 0 ? (
                <p className="muted">No blockers reported in the last two weeks.</p>
              ) : (
                <ul className="space-y-3">
                  {data.blockers.map((log) => (
                    <li key={log.id} className="rounded-md border border-red-100 bg-red-50/60 p-2.5">
                      <p className="text-sm text-red-800">{log.blocker}</p>
                      <p className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-500">
                        <Avatar name={log.user.fullName} color={log.user.avatarColor} size={16} />
                        {log.user.fullName} ·{' '}
                        <Link href={`/pm/tasks/${log.task.id}`} className="font-mono hover:text-brand-600">
                          {log.task.code}
                        </Link>
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ) : null}

          <Card title="Latest progress">
            {data.recentProgress.length === 0 ? (
              <p className="muted">No progress logged yet.</p>
            ) : (
              <ul className="space-y-3">
                {data.recentProgress.map((log) => (
                  <li key={log.id} className="flex gap-2">
                    <Avatar name={log.user.fullName} color={log.user.avatarColor} size={22} />
                    <div className="min-w-0">
                      <p className="text-sm text-slate-700">
                        <span className="font-medium">{log.user.fullName.split(' ')[0]}</span> moved{' '}
                        <Link href={`/pm/tasks/${log.task.id}`} className="font-mono text-xs text-brand-600 hover:underline">
                          {log.task.code}
                        </Link>{' '}
                        to {log.percentComplete}%
                      </p>
                      <p className="truncate text-xs text-slate-500">{log.note}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
