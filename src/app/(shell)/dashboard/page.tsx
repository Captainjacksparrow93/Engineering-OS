import Link from 'next/link';
import { requirePrincipal } from '@/core/auth/session';
import { getDashboard } from '@/modules/project-management/services/dashboard.service';
import { formatDate, daysUntil } from '@/core/utils/dates';
import { Avatar, Card, EmptyState, PageHeader, PriorityBadge, ProgressBar, Stat, StatusBadge } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const principal = await requirePrincipal();
  const data = await getDashboard(principal);

  const isDirectorOrHead =
    principal.grade === 'DIRECTOR' ||
    principal.grade === 'HEAD' ||
    principal.roleKeys.includes('DIRECTOR') ||
    principal.roleKeys.includes('DEPARTMENT_HEAD');

  return (
    <>
      <PageHeader
        title={`Good day, ${principal.fullName.split(' ')[0]}`}
        subtitle={
          data.isManagement
            ? 'Executive Operations Dashboard — Live portfolio health, roadblock radar, and engineering capacity.'
            : 'Your personal work queue and anything waiting on your action.'
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {isDirectorOrHead ? (
              <>
                <Link href="/pm/projects/new" className="btn btn-primary text-xs font-semibold">
                  + New Automation Project
                </Link>
                <Link href="/pm/templates" className="btn btn-secondary text-xs font-medium">
                  Checklist Templates
                </Link>
              </>
            ) : null}
            <Link href="/pm/my-work" className="btn btn-secondary text-xs">
              My work
            </Link>
          </div>
        }
      />

      {/* Top Executive Metric KPIs */}
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {data.isManagement ? (
          <>
            <Stat label="Active Projects" value={data.portfolio.activeProjects} hint="Ongoing automation orders" />
            <Stat
              label="Projects At Risk"
              value={data.portfolio.atRisk}
              tone={data.portfolio.atRisk > 0 ? 'danger' : 'success'}
              hint="Blocked or overdue milestones"
            />
            <Stat
              label="Active Roadblocks"
              value={data.portfolio.activeRoadblocks}
              tone={data.portfolio.activeRoadblocks > 0 ? 'warning' : 'default'}
              hint="Flagged client/vendor delays"
            />
            <Stat
              label="Pending PM Reviews"
              value={data.portfolio.pendingReviews}
              tone={data.portfolio.pendingReviews > 0 ? 'warning' : 'default'}
              hint="Completed steps awaiting sign-off"
            />
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

      {/* Handovers Waiting on User */}
      {data.incomingHandovers.length > 0 ? (
        <div className="mb-6">
          <Card
            title={`${data.incomingHandovers.length} handover${data.incomingHandovers.length > 1 ? 's' : ''} waiting on you`}
            action={
              <Link href="/pm/handovers" className="btn btn-secondary btn-sm">
                Review
              </Link>
            }
          >
            <ul className="divide-y divide-hairline">
              {data.incomingHandovers.map((handover) => (
                <li key={handover.id} className="flex flex-wrap items-center gap-3 py-2 first:pt-0 last:pb-0">
                  <Avatar name={handover.fromUser.fullName} color={handover.fromUser.avatarColor} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body-sm text-ink">
                      <span className="font-medium">{handover.fromUser.fullName}</span> wants to pass you{' '}
                      <Link href={`/pm/tasks/${handover.task.id}`} className="text-ink hover:underline">
                        {handover.task.code}
                      </Link>{' '}
                      - {handover.task.title}
                    </p>
                    <p className="truncate text-caption text-muted">{handover.reason}</p>
                  </div>
                  <span className="badge bg-surface-strong text-ink">{handover.remainingPercent}% left</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      ) : null}

      {/* Management View: What is going on & Roadblocks */}
      {data.isManagement ? (
        <div className="space-y-6">
          {/* Section 1: "WHAT IS GOING ON?" - Active Projects */}
          <Card
            title="What Is Going On? — Live Automation Projects"
            action={
              <Link href="/pm/projects" className="text-caption font-medium text-ink hover:underline">
                View all ({data.projects.length})
              </Link>
            }
            bodyClassName="p-0"
          >
            {data.projects.length === 0 ? (
              <div className="p-4">
                <EmptyState title="No active projects" hint="Create an automation project to start tracking." />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="table w-full text-xs">
                  <thead>
                    <tr className="bg-surface-subtle text-muted text-left uppercase tracking-wider">
                      <th>Project & Client</th>
                      <th>Project Manager</th>
                      <th>Current Step / Phase</th>
                      <th>Target Delivery</th>
                      <th className="w-36">Overall Progress</th>
                      <th className="text-right">Health Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-hairline">
                    {data.projects.map((project) => {
                      const due = daysUntil(project.targetEndDate);
                      return (
                        <tr key={project.id} className="hover:bg-surface-subtle/50">
                          <td>
                            <Link href={`/pm/projects/${project.id}`} className="font-semibold text-ink text-sm hover:underline">
                              {project.name}
                            </Link>
                            <div className="mt-0.5 flex items-center gap-2">
                              <span className="code text-caption text-muted-soft">{project.code}</span>
                              <span className="text-caption text-muted font-medium">• {project.clientName}</span>
                              <PriorityBadge priority={project.priority} />
                            </div>
                          </td>
                          <td>
                            <span className="flex items-center gap-2 font-medium text-ink text-xs">
                              <Avatar name={project.manager.fullName} color={project.manager.avatarColor} size={22} />
                              {project.manager.fullName}
                            </span>
                          </td>
                          <td>
                            <p className="font-medium text-ink text-xs truncate max-w-xs">{project.currentStep}</p>
                            <span className="text-caption text-muted">
                              {project.completedTaskCount} of {project.taskCount} tasks completed
                            </span>
                          </td>
                          <td className="whitespace-nowrap">
                            {project.targetEndDate ? (
                              <div>
                                <span className="font-medium text-ink text-xs">{formatDate(project.targetEndDate)}</span>
                                {due !== null ? (
                                  <span
                                    className={`block text-caption font-semibold ${
                                      due < 0 ? 'text-error' : due <= 7 ? 'text-amber-600' : 'text-muted-soft'
                                    }`}
                                  >
                                    {due < 0 ? `${-due}d late` : due === 0 ? 'Due today' : `in ${due} days`}
                                  </span>
                                ) : null}
                              </div>
                            ) : (
                              '-'
                            )}
                          </td>
                          <td>
                            <ProgressBar value={project.progressPercent} />
                            <div className="mt-1 flex items-center justify-between text-caption text-muted">
                              <span>{project.progressPercent}%</span>
                              {project.blockedCount > 0 && (
                                <span className="text-error font-medium">{project.blockedCount} blocked</span>
                              )}
                            </div>
                          </td>
                          <td className="text-right">
                            <span
                              className={`badge text-xs ${
                                project.health === 'BLOCKED'
                                  ? 'bg-red-100 text-red-800'
                                  : project.health === 'AT_RISK'
                                  ? 'bg-amber-100 text-amber-800'
                                  : 'bg-emerald-100 text-emerald-800'
                              }`}
                            >
                              {project.health === 'BLOCKED'
                                ? '● BLOCKED'
                                : project.health === 'AT_RISK'
                                ? '▲ AT RISK'
                                : '✓ HEALTHY'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Section 2: "WHAT BLOCKERS EXIST TODAY?" - Roadblock Radar */}
          <Card
            title="What Blockers Exist Today? — Roadblock Radar"
            bodyClassName="p-4"
          >
            {data.activeRoadblocks.length === 0 ? (
              <p className="text-sm text-emerald-700 font-medium py-2">
                ✓ No active roadblocks reported. All technical milestones are moving smoothly!
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {data.activeRoadblocks.map((log) => (
                  <div
                    key={log.id}
                    className="rounded-lg border border-red-200 bg-red-50/50 p-3.5 space-y-2 relative shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Avatar name={log.user.fullName} color={log.user.avatarColor} size={24} />
                        <div>
                          <p className="text-xs font-semibold text-ink">{log.user.fullName}</p>
                          <p className="text-caption text-muted">{log.user.designation || log.user.grade}</p>
                        </div>
                      </div>
                      <span className="badge bg-red-100 text-red-800 text-xs font-bold uppercase">Roadblock</span>
                    </div>

                    <div className="bg-white/80 rounded border border-red-100 p-2.5">
                      <p className="text-xs font-medium text-red-950 whitespace-pre-wrap leading-relaxed">
                        &ldquo;{log.blocker}&rdquo;
                      </p>
                    </div>

                    <div className="flex items-center justify-between text-caption text-muted pt-1">
                      <p>
                        Task:{' '}
                        <Link href={`/pm/tasks/${log.task.id}`} className="font-semibold text-ink hover:underline">
                          {log.task.code} ({log.task.title.slice(0, 30)}...)
                        </Link>
                      </p>
                      <span className="code font-mono text-muted">{log.task.project.code}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Section 3: "WHO IS DOING WHAT RIGHT NOW?" - Live Team Operations */}
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Team 1: Parth Nagar */}
            <Card title="Who Is Doing What? — Team 1: Parth Nagar (Technical Automation)">
              {data.teamOperations.parthTeam.length === 0 ? (
                <p className="text-caption text-muted">No team members assigned.</p>
              ) : (
                <ul className="divide-y divide-hairline">
                  {data.teamOperations.parthTeam.map((w: any) => (
                    <li key={w.person.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <Avatar name={w.person.fullName} size={24} />
                        <div className="min-w-0">
                          <p className="font-semibold text-ink truncate">{w.person.fullName}</p>
                          <p className="text-caption text-muted truncate">
                            {w.assignments[0]
                              ? `${w.assignments[0].taskCode} - ${w.assignments[0].taskTitle.slice(0, 24)}... (${w.assignments[0].percentComplete}%)`
                              : 'Available / Idle'}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span
                          className={`badge text-xs font-medium ${
                            w.status === 'FREE'
                              ? 'bg-emerald-100 text-emerald-800'
                              : w.status === 'AVAILABLE'
                              ? 'bg-blue-100 text-blue-800'
                              : w.status === 'BUSY'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-red-100 text-red-800'
                          }`}
                        >
                          {w.status}
                        </span>
                        <span className="text-caption text-muted font-mono">{w.utilizationPercent}%</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            {/* Team 2: Paras Prajapati */}
            <Card title="Who Is Doing What? — Team 2: Paras Prajapati (Technical Automation)">
              {data.teamOperations.parasTeam.length === 0 ? (
                <p className="text-caption text-muted">No team members assigned.</p>
              ) : (
                <ul className="divide-y divide-hairline">
                  {data.teamOperations.parasTeam.map((w: any) => (
                    <li key={w.person.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <Avatar name={w.person.fullName} size={24} />
                        <div className="min-w-0">
                          <p className="font-semibold text-ink truncate">{w.person.fullName}</p>
                          <p className="text-caption text-muted truncate">
                            {w.assignments[0]
                              ? `${w.assignments[0].taskCode} - ${w.assignments[0].taskTitle.slice(0, 24)}... (${w.assignments[0].percentComplete}%)`
                              : 'Available / Idle'}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span
                          className={`badge text-xs font-medium ${
                            w.status === 'FREE'
                              ? 'bg-emerald-100 text-emerald-800'
                              : w.status === 'AVAILABLE'
                              ? 'bg-blue-100 text-blue-800'
                              : w.status === 'BUSY'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-red-100 text-red-800'
                          }`}
                        >
                          {w.status}
                        </span>
                        <span className="text-caption text-muted font-mono">{w.utilizationPercent}%</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          {/* Section 4: "EVERY ACTIVITY TRACKED" - Real-time Audit & Activity Feed */}
          <Card title="Every Activity Tracked — Real-Time Activity Feed">
            {data.recentProgress.length === 0 ? (
              <p className="text-caption text-muted">No activity logged yet.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {data.recentProgress.map((log) => (
                  <div key={log.id} className="rounded border border-hairline p-3 bg-surface text-xs space-y-1">
                    <div className="flex items-center justify-between text-caption text-muted">
                      <span className="font-semibold text-ink">{log.user.fullName.split(' ')[0]}</span>
                      <span>{formatDate(log.createdAt)}</span>
                    </div>
                    <p className="font-medium text-ink">
                      Updated{' '}
                      <Link href={`/pm/tasks/${log.task.id}`} className="code text-primary hover:underline">
                        {log.task.code}
                      </Link>{' '}
                      to {log.percentComplete}%
                    </p>
                    <p className="text-caption text-muted truncate">{log.note}</p>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      ) : (
        /* Non-management Engineer View: My Work Queue */
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-4">
            <Card
              title="My Work"
              action={
                <Link href="/pm/my-work" className="text-caption font-medium text-ink hover:underline">
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
                            <Link href={`/pm/tasks/${task.id}`} className="font-medium text-ink hover:text-ink">
                              {task.title}
                            </Link>
                            <div className="mt-0.5 flex items-center gap-2">
                              <span className="code text-caption text-muted-soft">{task.code}</span>
                              <PriorityBadge priority={task.priority} />
                            </div>
                          </td>
                          <td className="text-caption text-muted">{task.project.code}</td>
                          <td className="whitespace-nowrap text-caption">
                            {task.plannedEnd ? (
                              <span className={due !== null && due < 0 ? 'font-medium text-error' : 'text-body'}>
                                {formatDate(task.plannedEnd)}
                                {due !== null ? (
                                  <span className="block text-caption text-muted-soft">
                                    {due < 0 ? `${-due}d late` : `in ${due}d`}
                                  </span>
                                ) : null}
                              </span>
                            ) : (
                              '-'
                            )}
                          </td>
                          <td className="w-28">
                            <ProgressBar value={task.percentComplete} />
                            <span className="mt-1 block text-caption text-muted">{task.percentComplete}%</span>
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
          </div>

          <div className="space-y-4">
            <Card title="Latest Updates">
              {data.recentProgress.length === 0 ? (
                <p className="text-caption text-muted">No recent progress.</p>
              ) : (
                <ul className="space-y-3">
                  {data.recentProgress.slice(0, 6).map((log) => (
                    <li key={log.id} className="flex gap-2 text-xs">
                      <Avatar name={log.user.fullName} size={22} />
                      <div className="min-w-0">
                        <p className="text-ink">
                          <span className="font-medium">{log.user.fullName.split(' ')[0]}</span> moved{' '}
                          <Link href={`/pm/tasks/${log.task.id}`} className="code hover:underline">
                            {log.task.code}
                          </Link>{' '}
                          to {log.percentComplete}%
                        </p>
                        <p className="truncate text-caption text-muted">{log.note}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
