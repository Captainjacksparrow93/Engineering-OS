import { formatName } from '@/core/utils/strings';
import Link from 'next/link';
import { requirePrincipal } from '@/core/auth/session';
import { getDashboard } from '@/modules/project-management/services/dashboard.service';
import { formatDate } from '@/core/utils/dates';
import { Avatar, Card, PageHeader, Stat } from '@/components/ui';
import { LiveProjectsTable } from './live-projects-table';
import { DashboardMyWorkTable } from './dashboard-my-work-table';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const principal = await requirePrincipal();
  const data = await getDashboard(principal);

  const isDirectorOrHead =
    principal.grade === 'DIRECTOR' ||
    principal.grade === 'HEAD' ||
    principal.roleKeys.includes('DIRECTOR') ||
    principal.roleKeys.includes('DEPARTMENT_HEAD');

  const greetingName = formatName(principal.fullName).split(' ')[0] || principal.fullName;

  return (
    <>
      <PageHeader
        title={`Good day, ${greetingName}`}
        subtitle={
          data.isManagement
            ? 'Company Overview — Live project progress, active roadblocks, and team workload.'
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
            <Stat label="Active Projects" value={data.portfolio.activeProjects} hint="Projects currently in progress" />
            <Stat
              label="Overdue Projects"
              value={data.portfolio.overdueProjects}
              tone={data.portfolio.overdueProjects > 0 ? 'danger' : 'success'}
              hint="Projects behind schedule"
            />
            <Stat
              label="Active Roadblocks"
              value={data.portfolio.activeRoadblocks}
              tone={data.portfolio.activeRoadblocks > 0 ? 'warning' : 'default'}
              hint="Issues blocking tasks"
            />
            <Stat
              label="Awaiting Approval"
              value={data.portfolio.pendingReviews}
              tone={data.portfolio.pendingReviews > 0 ? 'warning' : 'default'}
              hint="Completed tasks waiting for sign-off"
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
      {((data.incomingProjectHandovers?.length ?? 0) > 0 || data.incomingHandovers.length > 0) ? (
        <div className="mb-6">
          <Card
            title={`${(data.incomingProjectHandovers?.length ?? 0) + data.incomingHandovers.length} handover request${(data.incomingProjectHandovers?.length ?? 0) + data.incomingHandovers.length > 1 ? 's' : ''} waiting on you`}
            action={
              <Link href="/pm/handovers" className="btn btn-primary btn-sm font-medium">
                Review in Handovers
              </Link>
            }
          >
            <ul className="divide-y divide-hairline">
              {data.incomingProjectHandovers?.map((handover) => (
                <li key={handover.id} className="flex flex-wrap items-center gap-3 py-2.5 first:pt-0 last:pb-0 bg-primary/[0.02] -mx-4 px-4 rounded">
                  <Avatar name={formatName(handover.fromUser.fullName)} color={handover.fromUser.avatarColor} />
                  <div className="min-w-0 flex-1">
                    <p className="text-body-sm text-ink font-semibold">
                      <span className="badge bg-primary text-white text-xs mr-2">Project Handover</span>
                      {formatName(handover.fromUser.fullName)} wants to transfer project ownership of{' '}
                      <Link href={`/pm/projects/${handover.project.id}`} className="text-primary hover:underline">
                        {handover.project.name}
                      </Link>
                    </p>
                    <p className="truncate text-caption text-muted">{handover.project.clientName}</p>
                  </div>
                  <Link href="/pm/handovers" className="btn btn-secondary btn-sm text-xs">
                    Accept / Decline
                  </Link>
                </li>
              ))}
              {data.incomingHandovers.map((handover) => (
                <li key={handover.id} className="flex flex-wrap items-center gap-3 py-2 first:pt-0 last:pb-0">
                  <Avatar name={formatName(handover.fromUser.fullName)} color={handover.fromUser.avatarColor} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body-sm text-ink">
                      <span className="font-medium">{formatName(handover.fromUser.fullName)}</span> wants to pass you task{' '}
                      <Link href={`/pm/tasks/${handover.task.id}`} className="font-medium text-ink hover:underline">
                        {handover.task.title}
                      </Link>
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
          {/* Section 1: Active Projects */}
          <Card
            title="Live projects"
            action={
              <Link href="/pm/projects" className="text-caption font-medium text-ink hover:underline">
                View all ({data.projects.length})
              </Link>
            }
            bodyClassName="p-0"
          >
            <LiveProjectsTable projects={data.projects} />
          </Card>

          {/* Section 2: Roadblock Radar */}
          <Card
            title={`Roadblocks (${data.portfolio.activeRoadblocks} active)`}
            className="border-error/20 bg-error/[0.03]"
          >
            {data.activeRoadblocks.length === 0 ? (
              <p className="text-xs text-muted">All projects are moving smoothly with no reported roadblocks.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {data.activeRoadblocks.map((log) => (
                  <div
                    key={log.id}
                    className="flex flex-col justify-between gap-2 rounded-lg border border-hairline bg-surface p-3.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Avatar name={formatName(log.user.fullName)} color={log.user.avatarColor} size={24} />
                        <div>
                          <p className="text-xs font-semibold text-ink">{formatName(log.user.fullName)}</p>
                          <p className="text-caption text-muted">{log.user.designation || log.user.grade}</p>
                        </div>
                      </div>
                      <span className="badge bg-amber-100 text-amber-800 text-xs font-semibold">ROADBLOCK</span>
                    </div>

                    <div className="bg-canvas-soft rounded border border-hairline p-2.5">
                      <p className="text-xs font-medium text-ink whitespace-pre-wrap leading-relaxed">
                        &ldquo;{log.blocker}&rdquo;
                      </p>
                    </div>

                    <div className="flex items-center justify-between text-caption text-muted pt-1">
                      <p>
                        Task:{' '}
                        <Link href={`/pm/tasks/${log.task.id}`} className="font-semibold text-ink hover:underline">
                          {log.task.title}
                        </Link>
                      </p>
                      <span className="text-muted font-medium">{log.task.project.name}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Section 3: "WHO IS DOING WHAT RIGHT NOW?" - Live Team Operations */}
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Team 1: Parth Nagar */}
            <Card title="Team 1: Parth Nagar - Technical Automation">
              {data.teamOperations.parthTeam.length === 0 ? (
                <p className="text-caption text-muted">No team members assigned.</p>
              ) : (
                <ul className="divide-y divide-hairline">
                  {data.teamOperations.parthTeam.map((w: any) => (
                    <li key={w.person.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <Avatar name={formatName(w.person.fullName)} size={24} />
                        <div className="min-w-0">
                          <p className="font-semibold text-ink truncate">{formatName(w.person.fullName)}</p>
                          <p className="text-caption text-muted truncate">
                            {w.assignments[0]
                              ? `${w.assignments[0].taskTitle} (${w.assignments[0].percentComplete}%)`
                              : 'Available / Idle'}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span
                          className={`badge text-xs font-medium ${
                            w.status === 'FREE'
                              ? 'bg-success/[0.08] text-success'
                              : w.status === 'AVAILABLE'
                              ? 'bg-surface-strong text-ink'
                              : w.status === 'BUSY'
                              ? 'bg-stage-review/[0.15] text-stage-review'
                              : 'bg-error/[0.08] text-error'
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
            <Card title="Team 2: Paras Prajapati - Technical Automation">
              {data.teamOperations.parasTeam.length === 0 ? (
                <p className="text-caption text-muted">No team members assigned.</p>
              ) : (
                <ul className="divide-y divide-hairline">
                  {data.teamOperations.parasTeam.map((w: any) => (
                    <li key={w.person.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <Avatar name={formatName(w.person.fullName)} size={24} />
                        <div className="min-w-0">
                          <p className="font-semibold text-ink truncate">{formatName(w.person.fullName)}</p>
                          <p className="text-caption text-muted truncate">
                            {w.assignments[0]
                              ? `${w.assignments[0].taskTitle} (${w.assignments[0].percentComplete}%)`
                              : 'Available / Idle'}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span
                          className={`badge text-xs font-medium ${
                            w.status === 'FREE'
                              ? 'bg-success/[0.08] text-success'
                              : w.status === 'AVAILABLE'
                              ? 'bg-surface-strong text-ink'
                              : w.status === 'BUSY'
                              ? 'bg-stage-review/[0.15] text-stage-review'
                              : 'bg-error/[0.08] text-error'
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

          {/* Section 4: Recent activity */}
          <Card
            title="Recent activity"
            action={
              <Link href="/admin/audit" className="text-caption font-medium text-ink hover:underline">
                Full audit trail
              </Link>
            }
          >
            {data.recentProgress.length === 0 ? (
              <p className="text-caption text-muted">No activity logged yet.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {data.recentProgress.slice(0, 9).map((log) => (
                  <div key={log.id} className="rounded border border-hairline p-3 bg-surface text-xs space-y-1">
                    <div className="flex items-center justify-between text-caption text-muted">
                      <span className="font-semibold text-ink">{formatName(log.user.fullName)}</span>
                      <span>{formatDate(log.createdAt)}</span>
                    </div>
                    <p className="font-medium text-ink">
                      Updated{' '}
                      <Link href={`/pm/tasks/${log.task.id}`} className="text-primary hover:underline">
                        {log.task.title}
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
              <DashboardMyWorkTable items={data.myWork.items} />
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
                      <Avatar name={formatName(log.user.fullName)} size={22} />
                      <div className="min-w-0">
                        <p className="text-ink">
                          <span className="font-medium">{formatName(log.user.fullName)}</span> moved{' '}
                          <Link href={`/pm/tasks/${log.task.id}`} className="hover:underline font-medium">
                            {log.task.title}
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
