'use client';

import { useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { formatName } from '@/core/utils/strings';
import { formatDate } from '@/core/utils/dates';
import { Avatar, ProgressBar } from '@/components/ui';
import { ProjectTimeline } from '@/components/project-timeline';
import { TypeCards } from './type-cards';
import { getProjectTimelineAction } from '@/app/actions/pm';
import type { DirectorDashboardData } from '@/modules/project-management/services/dashboard.service';
import type { ProjectTimelineData } from '@/components/project-timeline';

const ATTENTION_PREVIEW = 6;

export function HealthBadge({ health }: { health: string }) {
  if (health === 'LATE') return <span className="badge badge-error">Late</span>;
  if (health === 'AT_RISK') return <span className="badge border border-hairline-strong bg-surface text-ink">At risk</span>;
  if (health === 'ON_HOLD') return <span className="badge bg-surface-strong text-muted">On hold</span>;
  if (health === 'COMPLETED') return <span className="badge bg-surface-strong text-ink">Completed</span>;
  return <span className="badge badge-success">On track</span>;
}

export function DirectorDashboard({
  data,
  initialTimeline,
}: {
  data: DirectorDashboardData;
  initialTimeline: ProjectTimelineData;
}) {
  const [filterHealth, setFilterHealth] = useState<'ALL' | 'LATE' | 'AT_RISK' | 'ON_TRACK'>('ALL');
  const [selectedProjectId, setSelectedProjectId] = useState<string>(initialTimeline.projectId);
  const [timelineData, setTimelineData] = useState<ProjectTimelineData>(initialTimeline);
  const [showAllAttention, setShowAllAttention] = useState(false);
  const period = data.period;
  const attentionRows = showAllAttention ? data.needsAttention : data.needsAttention.slice(0, ATTENTION_PREVIEW);

  const filteredProjects = data.projects.filter((p) => {
    if (filterHealth === 'ALL') return true;
    return p.health === filterHealth;
  });

  const handleSelectProject = async (projId: string) => {
    setSelectedProjectId(projId);
    try {
      const liveTimeline = await getProjectTimelineAction(projId);
      if (liveTimeline) {
        setTimelineData(liveTimeline);
        return;
      }
    } catch (err) {
      console.error('Failed to load project timeline:', err);
    }

    // Fallback if fetch fails
    const p = data.projects.find((proj) => proj.id === projId);
    if (p) {
      setTimelineData({
        projectId: p.id,
        projectName: p.name,
        projectCode: p.code,
        clientName: p.clientName,
        status: p.status,
        manager: p.manager,
        startDate: p.startDate,
        targetEndDate: p.targetEndDate,
        forecastEndDate: p.forecastEndDate,
        totalSteps: 0,
        completedSteps: 0,
        lanes: [],
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="page-title text-ink">Engineering Executive Dashboard</h1>
          <p className="mt-1 text-body-sm text-muted">
            Technical department operations, delivery tracking and capacity oversight.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex rounded-lg border border-hairline bg-surface p-1">
            {(['week', 'month'] as const).map((value) => (
              <Link
                key={value}
                href={`/dashboard?period=${value}`}
                scroll={false}
                aria-current={period === value ? 'true' : undefined}
                className={clsx(
                  'rounded-md px-3 py-1 text-xs font-medium transition-colors',
                  period === value ? 'bg-surface-strong text-ink' : 'text-muted hover:text-ink'
                )}
              >
                {value === 'week' ? 'Last 7 days' : 'Last 30 days'}
              </Link>
            ))}
          </div>

          <Link href="/pm/projects/new" className="btn btn-primary text-body-sm px-4 py-2 font-medium">
            New project
          </Link>
        </div>
      </div>

      {/* 3 Headline KPI Tiles */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {/* 1. On-time Projects */}
        <Link
          href="/pm/projects"
          className="card border-hairline bg-surface p-5 hover:border-hairline-strong transition-colors block"
        >
          <p className="text-caption font-semibold uppercase tracking-wider text-muted">On-time projects</p>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-ink">
              {data.headline.onTime.current}
            </span>
            <span className="text-sm text-muted font-mono">of {data.headline.onTime.total}</span>
          </div>
          <p className={clsx('mt-1 text-caption font-medium', data.headline.onTime.lateCount > 0 ? 'text-error' : 'text-muted')}>
            {data.headline.onTime.lateCount > 0 ? `${data.headline.onTime.lateCount} late` : 'All projects on schedule'}
          </p>
        </Link>

        {/* 2. Deliveries Next 30 Days */}
        <Link
          href="/pm/projects"
          className="card border-hairline bg-surface p-5 hover:border-hairline-strong transition-colors block"
        >
          <p className="text-caption font-semibold uppercase tracking-wider text-muted">Deliveries next 30 days</p>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-ink">
              {data.headline.deliveriesNext30Days.count}
            </span>
            <span className="text-sm text-muted">projects</span>
          </div>
          <p className="mt-1 text-caption text-muted">
            {data.headline.deliveriesNext30Days.nextDate
              ? `Next: ${formatDate(data.headline.deliveriesNext30Days.nextDate)}`
              : 'No upcoming deadlines'}
          </p>
        </Link>

        {/* 3. Waiting on Decisions */}
        <Link
          href="/pm/approvals"
          className="card border-hairline bg-surface p-5 hover:border-hairline-strong transition-colors block"
        >
          <p className="text-caption font-semibold uppercase tracking-wider text-muted">Waiting on decisions</p>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-ink">
              {data.headline.waitingDecisions.count}
            </span>
            <span className="text-sm text-muted">items</span>
          </div>
          <p className="mt-1 text-caption text-muted">
            {data.headline.waitingDecisions.count > 0
              ? `Oldest waiting ${data.headline.waitingDecisions.oldestDays} days`
              : 'Inbox is clear'}
          </p>
        </Link>
      </div>

      <TypeCards counts={data.typeCounts} />

      {/* Middle Row: Needs Attention & Team Capacity */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Needs Attention (2 cols) */}
        <div className="card border-hairline bg-surface p-5 lg:col-span-2">
          <header className="flex items-center justify-between border-b border-hairline pb-3">
            <h2 className="card-title text-ink font-semibold">Needs attention</h2>
            <span className="text-caption text-muted">{data.needsAttention.length} items flagged</span>
          </header>

          {data.needsAttention.length === 0 ? (
            <div className="py-8 text-center text-body-sm text-muted">
              No critical issues requiring attention right now.
            </div>
          ) : (
            <div className="divide-y divide-hairline">
              {attentionRows.map((item) => (
                <div key={item.id} className="flex items-center justify-between py-3 gap-4">
                  <div className="space-y-0.5 min-w-0">
                    <p className={clsx('text-body-sm font-semibold truncate', item.severity === 'error' ? 'text-error' : 'text-ink')}>
                      {item.title}
                    </p>
                    <p className="text-caption text-muted truncate">{item.subtitle}</p>
                  </div>
                  <Link href={item.link} className="btn btn-secondary btn-sm shrink-0 text-xs font-medium">
                    {item.actionLabel} →
                  </Link>
                </div>
              ))}
              {data.needsAttention.length > ATTENTION_PREVIEW ? (
                <button
                  type="button"
                  onClick={() => setShowAllAttention((v) => !v)}
                  className="w-full pt-3 text-caption font-medium text-ink hover:underline"
                >
                  {showAllAttention ? 'Show fewer' : `See all ${data.needsAttention.length}`}
                </button>
              ) : null}
            </div>
          )}
        </div>

        {/* Team Capacity · TECH (1 col) */}
        <div className="card border-hairline bg-surface p-5">
          <header className="border-b border-hairline pb-3">
            <h2 className="card-title text-ink font-semibold">Team capacity · {data.teamCapacity.departmentName}</h2>
          </header>
          <div className="mt-4 space-y-4">
            <div>
              <div className="flex items-center justify-between text-caption font-semibold">
                <span className="text-muted">Capacity committed</span>
                <span className="text-ink font-mono">{data.teamCapacity.committedPercent}%</span>
              </div>
              <div className="mt-2">
                <ProgressBar
                  value={data.teamCapacity.committedPercent}
                  tone={data.teamCapacity.committedPercent > 100 ? 'danger' : 'default'}
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 border-t border-hairline pt-3 text-center">
              <div className="rounded-lg bg-surface-strong/40 p-2">
                <p className="text-title-sm font-bold font-mono text-error">{data.teamCapacity.overloadedCount}</p>
                <p className="text-[10px] uppercase font-semibold text-muted">Overloaded</p>
              </div>
              <div className="rounded-lg bg-surface-strong/40 p-2">
                <p className="text-title-sm font-bold font-mono text-success">{data.teamCapacity.freeNextWeekCount}</p>
                <p className="text-[10px] uppercase font-semibold text-muted">Free Next Wk</p>
              </div>
              <div className="rounded-lg bg-surface-strong/40 p-2">
                <p className="text-title-sm font-bold font-mono text-ink">{data.teamCapacity.onLeaveCount}</p>
                <p className="text-[10px] uppercase font-semibold text-muted">On Leave</p>
              </div>
            </div>

            <div className="pt-2">
              <Link href="/pm/resources" className="btn btn-secondary btn-sm w-full text-center text-xs font-medium">
                See team load →
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Projects Table with Filter Chips */}
      <div className="card border-hairline bg-surface p-5 space-y-4">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline pb-3">
          <h2 className="card-title text-ink font-semibold">Live projects</h2>
          <div className="flex items-center gap-1.5">
            {(['ALL', 'LATE', 'AT_RISK', 'ON_TRACK'] as const).map((chip) => (
              <button
                key={chip}
                type="button"
                onClick={() => setFilterHealth(chip)}
                className={clsx(
                  'rounded-pill px-3 py-1 text-xs font-medium transition-colors',
                  filterHealth === chip
                    ? 'bg-ink text-canvas'
                    : 'bg-surface-strong text-muted hover:text-ink'
                )}
              >
                {chip === 'ALL' ? 'All' : chip === 'LATE' ? 'Late' : chip === 'AT_RISK' ? 'At risk' : 'On track'}
              </button>
            ))}
          </div>
        </header>

        <div className="overflow-x-auto">
          <table className="table min-w-[850px]">
            <thead>
              <tr className="select-none text-caption text-muted">
                <th>Project & Client</th>
                <th>PM</th>
                <th>Value</th>
                <th className="w-48">Done vs Time Used</th>
                <th>Finish</th>
                <th className="text-right">Health</th>
              </tr>
            </thead>
            <tbody>
              {filteredProjects.map((p) => {
                const isLate = p.health === 'LATE';
                return (
                  <tr
                    key={p.id}
                    onClick={() => handleSelectProject(p.id)}
                    className={clsx(
                      'cursor-pointer transition-colors hover:bg-canvas-soft',
                      selectedProjectId === p.id && 'bg-canvas-soft font-medium'
                    )}
                  >
                    <td>
                      <div className="space-y-0.5">
                        <Link href={`/pm/projects/${p.id}`} className="font-semibold text-ink hover:underline">
                          {p.name}
                        </Link>
                        <div className="text-caption text-muted">
                          <span>{p.clientName}</span>
                        </div>
                      </div>
                    </td>
                    <td>
                      {p.manager ? (
                        <div className="flex items-center gap-2">
                          <Avatar name={p.manager.fullName} color={p.manager.avatarColor} size={22} />
                          <span className="text-body-sm text-ink">{formatName(p.manager.fullName)}</span>
                        </div>
                      ) : (
                        <span className="text-caption text-muted-soft">Unassigned</span>
                      )}
                    </td>
                    <td>
                      <span className="font-mono text-body-sm text-ink font-medium">
                        {p.orderValueLakh ? `₹${p.orderValueLakh}L` : '—'}
                      </span>
                    </td>
                    <td>
                      <div className="space-y-1">
                        <div className="relative">
                          <ProgressBar value={p.progressPercent} />
                          {/* Time elapsed tick indicator */}
                          <div
                            className="absolute -top-1 bottom-0 w-0.5 bg-ink"
                            style={{ left: `${p.timeElapsedPercent}%` }}
                            title={`Time elapsed: ${p.timeElapsedPercent}%`}
                          />
                        </div>
                        <div className="flex items-center justify-between text-[11px] text-muted font-mono">
                          <span>{p.progressPercent}% done</span>
                          <span>{p.timeElapsedPercent}% time</span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="space-y-0.5 text-caption">
                        <p className={clsx(isLate ? 'font-semibold text-error' : 'text-ink')}>
                          {formatDate(p.targetEndDate)}
                        </p>
                        {isLate ? (
                          <p className="text-[11px] font-semibold text-error">
                            +{p.daysLate} {p.daysLate === 1 ? 'day' : 'days'} late · forecast {formatDate(p.forecastEndDate)}
                          </p>
                        ) : p.status === 'ON_HOLD' ? (
                          <p className="text-[11px] text-muted-soft">On hold</p>
                        ) : (
                          <p className="text-[11px] text-muted-soft">On schedule</p>
                        )}
                      </div>
                    </td>
                    <td className="text-right">
                      <HealthBadge health={p.health} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Selected Project Timeline */}
      <ProjectTimeline
        data={timelineData}
        projectsList={data.projects.map((p) => ({ id: p.id, name: p.name, code: p.code }))}
        onSelectProject={handleSelectProject}
      />

      {/* Bottom Summary: PM Overview & This-Week Stats */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Project Managers */}
        <div className="card border-hairline bg-surface p-5 space-y-3">
          <header className="border-b border-hairline pb-3">
            <h2 className="card-title text-ink font-semibold">Project managers</h2>
          </header>
          <div className="divide-y divide-hairline">
            {data.projectManagers.filter((pm) => pm.manager).map((pm) => (
              <div key={pm.manager.id} className="flex items-center justify-between py-2.5">
                <div className="flex items-center gap-2.5">
                  <Avatar name={pm.manager.fullName} color={pm.manager.avatarColor} size={26} />
                  <div>
                    <p className="text-body-sm font-medium text-ink">{formatName(pm.manager.fullName)}</p>
                    <p className="text-caption text-muted">{pm.liveProjectsCount} active projects</p>
                  </div>
                </div>
                <div className="text-right text-caption">
                  <p className="font-semibold font-mono text-ink">{pm.onTimePercent}% on time</p>
                  <p className="text-muted">{pm.pendingApprovalsCount} awaiting sign-off</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Period Stats */}
        <div className="card border-hairline bg-surface p-5 space-y-3">
          <header className="border-b border-hairline pb-3">
            <h2 className="card-title text-ink font-semibold">
              {period === 'week' ? 'Last 7 days' : 'Last 30 days'} in numbers
            </h2>
          </header>
          <div className="grid grid-cols-2 gap-4 pt-2 sm:grid-cols-3">
            <div className="rounded-lg bg-surface-strong/40 p-4 space-y-1">
              <p className="text-caption text-muted">Steps approved</p>
              <p className="text-2xl font-bold font-mono text-success">{data.periodStats.tasksApproved}</p>
            </div>
            <div className="rounded-lg bg-surface-strong/40 p-4 space-y-1">
              <p className="text-caption text-muted">Sent back for rework</p>
              <p className="text-2xl font-bold font-mono text-ink">{data.periodStats.tasksSentBack}</p>
            </div>
            <div className="rounded-lg bg-surface-strong/40 p-4 space-y-1">
              <p className="text-caption text-muted">Avg. approval time</p>
              <p className="text-2xl font-bold font-mono text-ink">
                {data.periodStats.avgApprovalTimeHours > 0 ? `${data.periodStats.avgApprovalTimeHours}h` : '—'}
              </p>
            </div>
            <div className="rounded-lg bg-surface-strong/40 p-4 space-y-1">
              <p className="text-caption text-muted">Problems reported</p>
              <p className="text-2xl font-bold font-mono text-ink">{data.periodStats.problemsReported}</p>
            </div>
            <div className="rounded-lg bg-surface-strong/40 p-4 space-y-1">
              <p className="text-caption text-muted">Problems solved</p>
              <p className="text-2xl font-bold font-mono text-ink">{data.periodStats.problemsSolved}</p>
            </div>
            <div className="rounded-lg bg-surface-strong/40 p-4 space-y-1">
              <p className="text-caption text-muted">Open problems (now)</p>
              <p className="text-2xl font-bold font-mono text-error">{data.periodStats.openProblems}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
