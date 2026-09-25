'use client';

import { useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import {
  formatDate,
  formatDateRange,
  startOfDay,
  workingDaysBetween,
} from '@/core/utils/dates';
import { cleanTaskTitle, formatName } from '@/core/utils/strings';
import { StatusBadge } from '@/components/ui';

export interface TimelineStep {
  taskId: string;
  stepNumber: number;
  code: string;
  title: string;
  status: string;
  plannedStart: Date | string | null;
  plannedEnd: Date | string | null;
  submittedAt: Date | string | null;
  completedAt: Date | string | null;
  completedBy?: { id: string; fullName: string } | null;
  assignee?: { id: string; fullName: string; avatarColor?: string | null } | null;
}

export interface TimelineLane {
  id: string;
  name: string;
  steps: TimelineStep[];
}

export interface ProjectTimelineData {
  projectId: string;
  projectName: string;
  projectCode: string;
  clientName?: string;
  status: string;
  manager?: { id: string; fullName: string; avatarColor?: string | null } | null;
  startDate: Date | string | null | undefined;
  targetEndDate: Date | string | null | undefined;
  forecastEndDate?: Date | string | null | undefined;
  totalSteps: number;
  completedSteps: number;
  lanes: TimelineLane[];
}

export function ProjectTimeline({
  data,
  projectsList,
  onSelectProject,
  className,
}: {
  data: ProjectTimelineData;
  projectsList?: Array<{ id: string; name: string; code: string }>;
  onSelectProject?: (id: string) => void;
  className?: string;
}) {
  const [activeStep, setActiveStep] = useState<TimelineStep | null>(null);

  const start = startOfDay(new Date(data.startDate ?? new Date()));
  const targetEnd = startOfDay(new Date(data.targetEndDate ?? new Date()));
  const forecastEnd = data.forecastEndDate ? startOfDay(new Date(data.forecastEndDate)) : null;
  const isForecastLate = forecastEnd !== null && forecastEnd.getTime() > targetEnd.getTime();
  const maxTimelineDate = isForecastLate ? forecastEnd : targetEnd;

  const startMs = start.getTime();
  const maxMs = maxTimelineDate.getTime();
  const totalDurationMs = Math.max(maxMs - startMs, 86_400_000 * 7); // At least 7 days
  const today = startOfDay(new Date());
  const todayMs = today.getTime();

  // Helper to map timestamp to % along the timeline
  const getXPercent = (date: Date | string | null | undefined): number => {
    if (!date) return 0;
    const t = startOfDay(new Date(date)).getTime();
    if (totalDurationMs <= 0) return 50;
    const pct = ((t - startMs) / totalDurationMs) * 100;
    return Math.max(2, Math.min(98, pct));
  };

  const todayX = getXPercent(today);
  const targetEndX = getXPercent(targetEnd);

  // Determine submitted/completed ticks strictly for completed deliverables
  const completedSteps = data.lanes.flatMap((lane) => lane.steps).filter((s) => s.status === 'COMPLETED');
  const rawSubmittedTicks: Array<{ date: Date; xPct: number; label: string; stepNumber: number }> = [];

  completedSteps.forEach((s) => {
    const rawDate = s.submittedAt ?? s.completedAt ?? s.plannedEnd;
    if (rawDate) {
      const d = startOfDay(new Date(rawDate));
      rawSubmittedTicks.push({
        date: d,
        xPct: getXPercent(d),
        label: formatDate(d),
        stepNumber: s.stepNumber,
      });
    }
  });

  rawSubmittedTicks.sort((a, b) => a.date.getTime() - b.date.getTime());

  // Deduplicate ticks if two steps completed on the exact same date or are visually overlapping (< 4% apart)
  const ticks: Array<{ date: Date; xPct: number; isKey: boolean; label?: string }> = [];
  for (const tick of rawSubmittedTicks) {
    const last = ticks[ticks.length - 1];
    if (last && Math.abs(last.xPct - tick.xPct) < 4) {
      continue;
    }
    ticks.push({
      date: tick.date,
      xPct: tick.xPct,
      isKey: true,
      label: tick.label,
    });
  }

  const getStepState = (step: TimelineStep) => {
    const isCompleted = step.status === 'COMPLETED';
    const plannedEndDate = step.plannedEnd ? startOfDay(new Date(step.plannedEnd)) : null;
    const isLate = !isCompleted && plannedEndDate !== null && plannedEndDate.getTime() < todayMs;
    const isWaitingApproval = step.status === 'IN_REVIEW' && !isLate;

    if (isCompleted) {
      let completionDate = step.completedAt;
      if (!completionDate) {
        console.warn(`[Timeline] Data error: completed step ${step.taskId} missing completedAt, falling back to plannedEnd`);
        completionDate = step.plannedEnd;
      }
      return {
        state: 'APPROVED' as const,
        markerDate: completionDate,
        markerClass: 'bg-success text-on-primary ring-2 ring-surface font-semibold',
        stateLabel: 'Approved',
        badgeTone: 'success',
      };
    }

    if (isLate) {
      return {
        state: 'LATE' as const,
        markerDate: step.plannedEnd,
        markerClass: 'border-2 border-error text-error bg-surface ring-2 ring-surface font-semibold',
        stateLabel: 'Late',
        badgeTone: 'error',
      };
    }

    if (isWaitingApproval) {
      return {
        state: 'IN_REVIEW' as const,
        markerDate: step.plannedEnd,
        markerClass: 'border-2 border-success text-success bg-surface ring-2 ring-surface font-semibold',
        stateLabel: 'Waiting for approval',
        badgeTone: 'success',
      };
    }

    return {
      state: 'TODO' as const,
      markerDate: step.plannedEnd,
      markerClass: 'border-2 border-hairline-strong text-muted bg-surface ring-2 ring-surface font-medium',
      stateLabel: step.status === 'IN_PROGRESS' ? 'In progress' : step.status === 'BLOCKED' ? 'Blocked' : 'To do',
      badgeTone: 'neutral',
    };
  };

  const getActiveStepDetails = (step: TimelineStep) => {
    const { state, stateLabel } = getStepState(step);
    const plannedEndMs = step.plannedEnd ? startOfDay(new Date(step.plannedEnd)).getTime() : null;

    let timingText = 'On track';
    if (state === 'APPROVED') {
      const compMs = step.completedAt ? startOfDay(new Date(step.completedAt)).getTime() : plannedEndMs;
      if (plannedEndMs && compMs && compMs > plannedEndMs) {
        const days = Math.max(1, workingDaysBetween(new Date(plannedEndMs), new Date(compMs)) - 1);
        timingText = `${days} working day(s) late`;
      } else {
        timingText = 'Completed on time';
      }
    } else if (state === 'LATE') {
      if (plannedEndMs) {
        const days = Math.max(1, workingDaysBetween(new Date(plannedEndMs), today) - 1);
        timingText = `${days} working day(s) overdue`;
      } else {
        timingText = 'Overdue';
      }
    }

    let approvalText = 'Not approved yet';
    if (state === 'APPROVED') {
      approvalText = `Approved on ${formatDate(step.completedAt ?? step.plannedEnd)}${
        step.completedBy ? ` by ${formatName(step.completedBy.fullName)}` : ''
      }`;
    } else if (state === 'IN_REVIEW') {
      approvalText = 'Waiting for approval';
    }

    return {
      stateLabel,
      timingText,
      approvalText,
    };
  };

  return (
    <section className={clsx('card border-hairline bg-surface p-5', className)}>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-title-sm font-semibold text-ink">{data.projectName}</h3>
          </div>
          <p className="mt-0.5 text-caption text-muted">
            {data.manager ? `PM: ${formatName(data.manager.fullName)} · ` : ''}
            <span className="font-medium text-ink">{data.completedSteps} of {data.totalSteps}</span> steps done
          </p>
        </div>

        {/* Project Selector (if on Dashboard) */}
        {projectsList && projectsList.length > 1 ? (
          <div className="flex items-center gap-2">
            <span className="text-caption text-muted">Project:</span>
            <select
              value={data.projectId}
              onChange={(e) => onSelectProject?.(e.target.value)}
              className="select text-xs py-1"
            >
              {projectsList.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>

      {/* Main Timeline Graphic */}
      <div className="relative mt-5 overflow-x-auto pb-6 pt-2">
        <div className="min-w-[650px] space-y-6">
          {/* Axis Header with dates - 2 rows to prevent overlapping */}
          <div className="relative h-12 text-caption text-muted border-b border-hairline-strong flex flex-col justify-between">
            {/* Row 1: Start (left) and Target/Forecast (right) */}
            <div className="relative h-6 flex justify-between items-center whitespace-nowrap">
              <span className="font-medium text-ink whitespace-nowrap">
                Start: {formatDate(data.startDate)}
              </span>

              {isForecastLate ? (
                <span className="font-medium text-error whitespace-nowrap">
                  Target {formatDate(data.targetEndDate)} · Forecast {formatDate(data.forecastEndDate)} (Late)
                </span>
              ) : (
                <span className="font-medium text-ink whitespace-nowrap">
                  Target: {formatDate(data.targetEndDate)}
                </span>
              )}
            </div>

            {/* Row 2: Today pill at todayX% and target end dashed tick */}
            <div className="relative h-6">
              {isForecastLate && (
                <div
                  className="absolute bottom-0 w-px h-3 border-r border-dashed border-ink/40 pointer-events-none"
                  style={{ left: `${targetEndX}%` }}
                  title={`Target: ${formatDate(data.targetEndDate)}`}
                />
              )}

              {/* Today marker label with edge clamping */}
              {todayMs >= startMs && todayMs <= maxMs ? (
                <span
                  className={clsx(
                    'absolute bottom-0.5 text-caption font-semibold text-ink bg-surface-strong px-1.5 py-0.5 rounded shadow-sm z-20 whitespace-nowrap',
                    todayX < 10 ? 'translate-x-0' : todayX > 90 ? '-translate-x-full' : '-translate-x-1/2'
                  )}
                  style={{ left: `${todayX}%` }}
                >
                  Today ({formatDate(today)})
                </span>
              ) : null}
            </div>
          </div>

          {/* Lanes */}
          {data.lanes.map((lane) => (
            <div key={lane.id} className="relative flex items-center gap-3">
              {/* Lane Label */}
              <div className="w-24 shrink-0 truncate text-caption font-medium text-muted" title={lane.name}>
                {lane.name}
              </div>

              {/* Lane Track */}
              <div className="relative h-10 flex-1 flex items-center">
                {/* Background track line */}
                <div className="absolute inset-x-0 h-0.5 bg-hairline-strong" />

                {/* Today vertical guideline */}
                {todayMs >= startMs && todayMs <= maxMs ? (
                  <div
                    className="absolute inset-y-0 w-px border-r border-dashed border-ink/40 pointer-events-none z-10"
                    style={{ left: `${todayX}%` }}
                  />
                ) : null}

                {/* Step Markers (ALL steps rendered) */}
                {lane.steps.map((step) => {
                  const stepState = getStepState(step);
                  const xPct = getXPercent(stepState.markerDate);

                  const tooltipText = `Step ${step.stepNumber}: ${cleanTaskTitle(step.title)}\nStatus: ${stepState.stateLabel}\nPlanned: ${formatDateRange(step.plannedStart, step.plannedEnd)}${
                    step.completedAt ? `\nCompleted: ${formatDate(step.completedAt)}` : ''
                  }`;

                  return (
                    <div
                      key={step.taskId}
                      className="absolute -translate-x-1/2 cursor-pointer z-20 group"
                      style={{ left: `${xPct}%` }}
                      onClick={() => setActiveStep(step)}
                      onMouseEnter={() => setActiveStep(step)}
                      title={tooltipText}
                    >
                      <button
                        type="button"
                        aria-label={`Step ${step.stepNumber}: ${step.title} (${stepState.stateLabel})`}
                        className={clsx(
                          'flex h-6 w-6 items-center justify-center rounded-pill text-caption transition-transform group-hover:scale-110 focus:outline-none font-mono',
                          stepState.markerClass
                        )}
                      >
                        {step.stepNumber}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Date ticks at bottom */}
          <div className="relative h-6 border-t border-hairline pt-1 text-caption text-muted">
            {ticks.map((t, idx) => (
              <div
                key={idx}
                className="absolute -translate-x-1/2 flex flex-col items-center"
                style={{ left: `${t.xPct}%` }}
              >
                <span className="block h-1.5 w-px bg-success/80 mb-0.5" />
                <span className="text-caption font-medium text-ink select-none whitespace-nowrap">
                  {t.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Popover / Details of Active Step */}
      {activeStep ? (
        <div className="mt-3 rounded-lg border border-hairline bg-surface-strong/40 p-3.5 flex flex-wrap items-center justify-between gap-3 animate-in fade-in duration-150">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-ink text-body-sm">
                Step {activeStep.stepNumber}: {cleanTaskTitle(activeStep.title)}
              </span>
              <StatusBadge status={activeStep.status} />
              {activeStep.assignee ? (
                <span className="text-caption text-muted">
                  · Assigned to <strong className="text-ink font-medium">{formatName(activeStep.assignee.fullName)}</strong>
                </span>
              ) : (
                <span className="text-caption text-muted-soft">· Unassigned</span>
              )}
            </div>

            {(() => {
              const details = getActiveStepDetails(activeStep);
              return (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-muted">
                  <span>
                    Planned: <strong className="text-ink font-medium">{formatDateRange(activeStep.plannedStart, activeStep.plannedEnd)}</strong>
                  </span>
                  {activeStep.submittedAt ? (
                    <span>
                      Submitted: <strong className="text-ink font-medium">{formatDate(activeStep.submittedAt)}</strong>
                    </span>
                  ) : null}
                  <span>
                    Status: <strong className="text-ink font-medium">{details.approvalText}</strong>
                  </span>
                  <span className={clsx(
                    'font-medium',
                    details.timingText.includes('late') || details.timingText.includes('overdue')
                      ? 'text-error font-semibold'
                      : 'text-success'
                  )}>
                    {details.timingText}
                  </span>
                </div>
              );
            })()}
          </div>

          <Link
            href={`/pm/tasks/${activeStep.taskId}`}
            className="btn btn-secondary btn-sm text-xs font-medium"
          >
            Open task →
          </Link>
        </div>
      ) : null}

      {/* Legend */}
      <footer className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-hairline pt-3 text-caption text-muted">
        <div className="flex flex-wrap items-center gap-4">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-pill bg-success" /> Approved
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-pill border-2 border-success bg-surface" /> Waiting for approval
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-pill border-2 border-error bg-surface" /> Late
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-pill border-2 border-hairline-strong bg-surface" /> To do / In progress
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 border-t border-dashed border-ink" /> Today
          </span>
        </div>
      </footer>
    </section>
  );
}

