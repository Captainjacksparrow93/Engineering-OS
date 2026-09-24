'use client';

import Link from 'next/link';
import { formatDate } from '@/core/utils/dates';
import { Avatar, ProgressBar, StatusBadge } from '@/components/ui';
import type { EngineerPortfolioData } from '@/modules/project-management/services/dashboard.service';
import { HealthBadge } from '@/app/(shell)/dashboard/director-dashboard';

export function EngineerPortfolio({ data }: { data: EngineerPortfolioData }) {
  const { engineer, capacity, headline, projects, panels, openTasks, handovers } = data;

  return (
    <div className="space-y-6">
      {/* Engineer Header */}
      <div className="card p-6 border-hairline bg-surface">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Avatar name={engineer.fullName} color={engineer.avatarColor} size={56} />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-ink">{engineer.fullName}</h1>
                <span className="text-xs font-mono text-muted bg-surface-strong px-2 py-0.5 rounded">
                  {engineer.employeeCode}
                </span>
              </div>
              <p className="text-body-sm text-muted">
                {engineer.designation || 'Engineer'}
              </p>
              {engineer.skills.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {engineer.skills.map((skill) => (
                    <span
                      key={skill}
                      className="rounded-full bg-surface-strong px-2.5 py-0.5 text-[11px] font-medium text-muted"
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5 self-stretch sm:self-auto border-t sm:border-t-0 pt-3 sm:pt-0 border-hairline">
            <StatusBadge status={capacity.status} />
            <span className="text-caption text-muted">
              {capacity.committedHours}h committed of {capacity.capacityHours}h ({capacity.utilizationPercent}% load)
            </span>
            <div className="w-36">
              <ProgressBar
                value={Math.min(100, capacity.utilizationPercent)}
                tone={
                  capacity.utilizationPercent > 100
                    ? 'danger'
                    : capacity.utilizationPercent < 60
                    ? 'success'
                    : 'default'
                }
              />
            </div>
          </div>
        </div>
      </div>

      {/* 4 Headline KPI Tiles */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="card border-hairline bg-surface p-4">
          <p className="text-caption font-semibold uppercase tracking-wider text-muted">Open steps</p>
          <p className="mt-2 text-2xl font-bold font-mono text-ink">{headline.openTasks}</p>
          <p className="mt-0.5 text-caption text-muted">Currently active</p>
        </div>

        <div className="card border-hairline bg-surface p-4">
          <p className="text-caption font-semibold uppercase tracking-wider text-muted">Overdue steps</p>
          <p className="mt-2 text-2xl font-bold font-mono text-error">{headline.overdueTasks}</p>
          <p className="mt-0.5 text-caption text-muted">Behind planned end date</p>
        </div>

        <div className="card border-hairline bg-surface p-4">
          <p className="text-caption font-semibold uppercase tracking-wider text-muted">Panels owned</p>
          <p className="mt-2 text-2xl font-bold font-mono text-ink">{headline.panelsOwned}</p>
          <p className="mt-0.5 text-caption text-muted">Across assigned packages</p>
        </div>

        <div className="card border-hairline bg-surface p-4">
          <p className="text-caption font-semibold uppercase tracking-wider text-muted">Handovers waiting</p>
          <p className="mt-2 text-2xl font-bold font-mono text-ink">{headline.handoversWaiting}</p>
          <p className="mt-0.5 text-caption text-muted">Incoming requests</p>
        </div>
      </div>

      {/* Site Attendance & Lifetime Metrics (Sheet 2) */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="card border-hairline bg-surface p-4">
          <p className="text-caption font-semibold uppercase tracking-wider text-muted">Site visits</p>
          <p className="mt-2 text-2xl font-bold font-mono text-ink">{headline.siteVisits}</p>
          <p className="mt-0.5 text-caption text-muted">Total commissioning logs</p>
        </div>

        <div className="card border-hairline bg-surface p-4">
          <p className="text-caption font-semibold uppercase tracking-wider text-muted">Days on site</p>
          <p className="mt-2 text-2xl font-bold font-mono text-ink">{headline.daysOnSite}</p>
          <p className="mt-0.5 text-caption text-muted">Distinct customer site days</p>
        </div>

        <div className="card border-hairline bg-surface p-4">
          <p className="text-caption font-semibold uppercase tracking-wider text-muted">Lifetime handovers</p>
          <p className="mt-2 text-2xl font-bold font-mono text-ink">{headline.lifetimeHandovers}</p>
          <p className="mt-0.5 text-caption text-muted">Incoming & outgoing transfers</p>
        </div>
      </div>

      {/* Panels Owned Section */}
      <div className="card border-hairline bg-surface p-5">
        <header className="flex items-center justify-between border-b border-hairline pb-3 mb-4">
          <h2 className="card-title text-ink font-semibold">Panels Owned</h2>
          <span className="text-caption text-muted">{panels.length} panels</span>
        </header>
        {panels.length === 0 ? (
          <p className="text-body-sm text-muted py-2">No panels currently owned.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {panels.map((panel) => (
              <div
                key={panel.id}
                className="p-4 rounded-lg border border-hairline bg-canvas hover:border-hairline-strong transition-colors"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div>
                    <span className="text-caption font-mono text-muted">{panel.code}</span>
                    <h3 className="font-semibold text-ink text-body-sm">{panel.title}</h3>
                    <Link
                      href={`/pm/projects/${panel.projectId}`}
                      className="text-caption text-primary hover:underline"
                    >
                      {panel.projectName}
                    </Link>
                  </div>
                  <span className="text-caption font-bold text-ink font-mono">{panel.progressPercent}%</span>
                </div>
                <div className="mt-2">
                  <ProgressBar value={panel.progressPercent} tone={panel.progressPercent === 100 ? 'success' : 'default'} />
                </div>
                <p className="mt-2 text-caption text-muted">
                  {panel.completedTasks} of {panel.totalTasks} steps completed
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Projects Section */}
      <div className="card border-hairline bg-surface p-5">
        <header className="flex items-center justify-between border-b border-hairline pb-3 mb-4">
          <h2 className="card-title text-ink font-semibold">Projects Assigned</h2>
          <span className="text-caption text-muted">{projects.length} projects</span>
        </header>
        {projects.length === 0 ? (
          <p className="text-body-sm text-muted py-2">No active projects assigned.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-body-sm">
              <thead className="border-b border-hairline text-caption font-semibold text-muted">
                <tr>
                  <th className="pb-2">Project</th>
                  <th className="pb-2">Client</th>
                  <th className="pb-2">Health</th>
                  <th className="pb-2">Progress</th>
                  <th className="pb-2">Target Date</th>
                  <th className="pb-2">Project Manager</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {projects.map((p) => (
                  <tr key={p.id} className="hover:bg-surface-strong/30">
                    <td className="py-3 pr-4">
                      <Link href={`/pm/projects/${p.id}`} className="font-semibold text-ink hover:underline">
                        {p.name}
                      </Link>
                      <p className="text-caption text-muted font-mono">{p.code}</p>
                    </td>
                    <td className="py-3 pr-4 text-muted">{p.clientName}</td>
                    <td className="py-3 pr-4">
                      <HealthBadge health={p.health} />
                    </td>
                    <td className="py-3 pr-4 w-32">
                      <div className="flex items-center justify-between text-caption font-mono mb-1">
                        <span>{p.progressPercent}%</span>
                      </div>
                      <ProgressBar value={p.progressPercent} />
                    </td>
                    <td className="py-3 pr-4 text-caption text-muted whitespace-nowrap">
                      {formatDate(p.targetEndDate)}
                    </td>
                    <td className="py-3 text-muted">{p.manager.fullName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Open Steps / Work Queue */}
      <div className="card border-hairline bg-surface p-5">
        <header className="flex items-center justify-between border-b border-hairline pb-3 mb-4">
          <h2 className="card-title text-ink font-semibold">Open Steps & Work Queue</h2>
          <span className="text-caption text-muted">{openTasks.length} steps</span>
        </header>
        {openTasks.length === 0 ? (
          <p className="text-body-sm text-muted py-2">No open steps assigned.</p>
        ) : (
          <div className="divide-y divide-hairline">
            {openTasks.map((task) => (
              <div key={task.id} className="py-3 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-caption text-muted">{task.code}</span>
                    <Link href={`/pm/tasks/${task.id}`} className="font-medium text-ink hover:underline truncate">
                      {task.title}
                    </Link>
                    {task.isOverdue && (
                      <span className="badge bg-error/[0.08] text-error text-[10px] font-bold">
                        Late
                      </span>
                    )}
                  </div>
                  <p className="text-caption text-muted">
                    {task.projectName} · {task.estimatedHours}h estimated · Due {formatDate(task.plannedEnd)}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <StatusBadge status={task.status} />
                  <Link href={`/pm/tasks/${task.id}`} className="btn btn-secondary btn-sm text-xs">
                    View →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Handovers Waiting */}
      {(handovers.incoming.length > 0 || handovers.outgoing.length > 0) && (
        <div className="card border-hairline bg-surface p-5">
          <header className="border-b border-hairline pb-3 mb-4">
            <h2 className="card-title text-ink font-semibold">Handovers</h2>
          </header>
          <div className="space-y-4">
            {handovers.incoming.length > 0 && (
              <div>
                <h3 className="text-caption font-semibold uppercase text-muted mb-2">Incoming to decide</h3>
                <div className="divide-y divide-hairline">
                  {handovers.incoming.map((h) => (
                    <div key={h.id} className="py-2.5 flex items-center justify-between gap-4">
                      <div>
                        <p className="text-body-sm font-medium text-ink">{h.taskTitle}</p>
                        <p className="text-caption text-muted">
                          {h.projectName} · Offered by {h.fromUserName}
                        </p>
                      </div>
                      <Link href="/pm/handovers" className="btn btn-secondary btn-sm text-xs">
                        Review →
                      </Link>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {handovers.outgoing.length > 0 && (
              <div className="border-t border-hairline pt-3">
                <h3 className="text-caption font-semibold uppercase text-muted mb-2">Outgoing pending</h3>
                <div className="divide-y divide-hairline">
                  {handovers.outgoing.map((h) => (
                    <div key={h.id} className="py-2.5 flex items-center justify-between gap-4">
                      <div>
                        <p className="text-body-sm font-medium text-ink">{h.taskTitle}</p>
                        <p className="text-caption text-muted">
                          {h.projectName} · Offered to {h.toUserName}
                        </p>
                      </div>
                      <span className="badge bg-surface-strong text-muted text-xs">Pending</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
