'use client';

import { useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { formatDate, startOfDay } from '@/core/utils/dates';
import { cleanTaskTitle, formatName } from '@/core/utils/strings';

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

  const start = startOfDay(new Date(data.startDate ?? new Date())).getTime();
  const targetEnd = startOfDay(new Date(data.targetEndDate ?? new Date())).getTime();
  const totalDurationMs = Math.max(targetEnd - start, 86400000 * 7); // At least 7 days
  const todayMs = startOfDay(new Date()).getTime();

  // Helper to map timestamp to % along the timeline
  const getXPercent = (date: Date | string | null | undefined): number => {
    if (!date) return 0;
    const t = startOfDay(new Date(date)).getTime();
    const pct = ((t - start) / totalDurationMs) * 100;
    return Math.max(2, Math.min(98, pct));
  };

  const todayX = getXPercent(new Date());

  // Generate intermediate date ticks (approx 5 ticks)
  const ticks: Date[] = [];
  const tickCount = 5;
  for (let i = 0; i <= tickCount; i++) {
    ticks.push(new Date(start + (totalDurationMs / tickCount) * i));
  }

  return (
    <section className={clsx('card border-hairline bg-surface p-5', className)}>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-title-sm font-semibold text-ink">{data.projectName}</h3>
            <span className="code-chip text-caption">{data.projectCode}</span>
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
                  {p.name} ({p.code})
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>

      {/* Main Timeline Graphic */}
      <div className="relative mt-5 overflow-x-auto pb-6 pt-2">
        <div className="min-w-[650px] space-y-6">
          {/* Axis Header with dates */}
          <div className="relative h-6 text-caption text-muted border-b border-hairline-strong">
            <span className="absolute left-0 font-medium text-ink">
              Start: {formatDate(data.startDate)}
            </span>
            <span className="absolute right-0 font-medium text-ink">
              Target: {formatDate(data.targetEndDate)}
            </span>

            {/* Today marker label */}
            {todayMs >= start && todayMs <= targetEnd ? (
              <span
                className="absolute -top-1 -translate-x-1/2 text-caption font-semibold text-ink bg-surface-strong px-1.5 py-0.5 rounded"
                style={{ left: `${todayX}%` }}
              >
                Today
              </span>
            ) : null}
          </div>

          {/* Lanes */}
          {data.lanes.map((lane) => (
            <div key={lane.id} className="relative flex items-center gap-3">
              {/* Lane Label */}
              <div className="w-24 shrink-0 truncate text-caption font-medium text-muted">
                {lane.name}
              </div>

              {/* Lane Track */}
              <div className="relative h-10 flex-1 flex items-center">
                {/* Background track line */}
                <div className="absolute inset-x-0 h-0.5 bg-hairline-strong" />

                {/* Today vertical guideline */}
                {todayMs >= start && todayMs <= targetEnd ? (
                  <div
                    className="absolute inset-y-0 w-px border-r border-dashed border-ink/40 pointer-events-none z-10"
                    style={{ left: `${todayX}%` }}
                  />
                ) : null}

                {/* Milestone Step Markers (Completed only) */}
                {lane.steps
                  .filter((step) => step.status === 'COMPLETED')
                  .map((step) => {
                    const completionDate = step.completedAt ?? step.submittedAt ?? step.plannedEnd;
                    const xPct = getXPercent(completionDate);

                    const tooltipText = `Step ${step.stepNumber}: ${cleanTaskTitle(step.title)}\nStatus: Completed\nCompleted: ${formatDate(completionDate)}${step.completedBy ? ` by ${formatName(step.completedBy.fullName)}` : ''}`;

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
                          aria-label={`Step ${step.stepNumber}: ${step.title}`}
                          className="flex h-6 w-6 items-center justify-center rounded-pill text-caption font-semibold transition-transform group-hover:scale-110 focus:outline-none ring-2 ring-surface bg-ink text-canvas font-mono"
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
          <div className="relative h-4 border-t border-hairline pt-1 text-caption text-muted-soft">
            {ticks.map((t, idx) => {
              const x = getXPercent(t);
              return (
                <span
                  key={idx}
                  className="absolute -translate-x-1/2 text-caption"
                  style={{ left: `${x}%` }}
                >
                  {formatDate(t)}
                </span>
              );
            })}
          </div>
        </div>
      </div>

      {/* Popover / Details of Completed Active Step */}
      {activeStep && activeStep.status === 'COMPLETED' ? (
        <div className="mt-3 rounded-lg border border-hairline bg-surface-strong/40 p-3 flex flex-wrap items-center justify-between gap-3 animate-in fade-in duration-150">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-ink text-body-sm">
                Step {activeStep.stepNumber}: {cleanTaskTitle(activeStep.title)}
              </span>
              <span className="code-chip text-caption">{activeStep.code}</span>
            </div>
            <p className="text-caption text-muted">
              <span className="inline-flex items-center gap-1.5 text-ink font-medium">
                <span className="inline-block h-2 w-2 rounded-full bg-emerald-600" />
                Completed on {formatDate(activeStep.completedAt ?? activeStep.submittedAt ?? activeStep.plannedEnd)}
                {activeStep.completedBy ? ` · Approved by ${formatName(activeStep.completedBy.fullName)}` : ''}
              </span>
            </p>
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
      <footer className="mt-4 flex flex-wrap items-center justify-between border-t border-hairline pt-3 text-caption text-muted">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-pill bg-ink" /> Completed step
          </span>
        </div>
      </footer>
    </section>
  );
}
