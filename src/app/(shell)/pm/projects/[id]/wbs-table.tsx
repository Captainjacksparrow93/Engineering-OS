'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { ProgressBar, StatusBadge } from '@/components/ui';
import { AssigneeCell } from '@/components/assignee-cell';
import { cleanTaskTitle } from '@/core/utils/strings';

interface WbsTask {
  id: string;
  code: string;
  title: string;
  type: string;
  status: string;
  isBlocked?: boolean;
  effectiveStatus?: string;
  priority: string;
  parentId: string | null;
  estimatedHours: number;
  actualHours: number;
  percentComplete: number;
  rolledUpPercent: number;
  plannedStart: Date | string | null;
  plannedEnd: Date | string | null;
  assignments: Array<{ user: { id: string; fullName: string; avatarColor?: string | null; designation?: string | null } }>;
  schedule: { floatDays: number; isCritical: boolean } | null;
  _count: { children: number; dependencies: number; handovers: number };
}

interface Colleague {
  id: string;
  fullName: string;
  designation?: string | null;
  avatarColor?: string | null;
}

export function WbsTable({
  tasks,
  criticalTaskIds,
  projectId,
  canAssign = false,
  colleagues = [],
  currentUserId,
}: {
  tasks: WbsTask[];
  criticalTaskIds: string[];
  projectId?: string;
  canAssign?: boolean;
  colleagues?: Colleague[];
  currentUserId?: string;
}) {
  const [filterMode, setFilterMode] = useState<'all' | 'open' | 'review' | 'problems' | 'mine'>('all');
  const [collapsedUnits, setCollapsedUnits] = useState<Set<string>>(new Set());

  const critical = useMemo(() => new Set(criticalTaskIds), [criticalTaskIds]);

  const toggleUnit = (unitId: string) => {
    setCollapsedUnits((prev) => {
      const next = new Set(prev);
      if (next.has(unitId)) next.delete(unitId);
      else next.add(unitId);
      return next;
    });
  };

  // Group tasks into units (phases)
  const phases = useMemo(() => {
    return tasks.filter((t) => t.type === 'PHASE' || (!t.parentId && tasks.some((c) => c.parentId === t.id)));
  }, [tasks]);

  const leafTasks = useMemo(() => {
    return tasks.filter((t) => t.type !== 'PHASE' && !tasks.some((c) => c.parentId === t.id));
  }, [tasks]);

  const filteredLeafTasks = useMemo(() => {
    return leafTasks.filter((t) => {
      if (filterMode === 'open') return !['COMPLETED', 'CANCELLED'].includes(t.status);
      if (filterMode === 'review') return t.status === 'IN_REVIEW';
      if (filterMode === 'problems') return t.status === 'BLOCKED';
      if (filterMode === 'mine' && currentUserId) {
        return t.assignments.some((a) => a.user.id === currentUserId);
      }
      return true;
    });
  }, [leafTasks, filterMode, currentUserId]);

  const units = useMemo(() => {
    if (phases.length === 0) {
      const hasNonCriticalOpenStep = leafTasks.some(
        (t) => !critical.has(t.id) && !['COMPLETED', 'CANCELLED'].includes(t.status)
      );
      return [
        {
          id: 'default',
          title: 'Project Deliverables',
          progress: Math.round(
            leafTasks.reduce((s, t) => s + (t.status === 'COMPLETED' ? 100 : t.percentComplete), 0) /
              Math.max(leafTasks.length, 1)
          ),
          tasks: filteredLeafTasks,
          showCriticalBadge: hasNonCriticalOpenStep,
        },
      ];
    }

    return phases.map((phase) => {
      const unitTasks = filteredLeafTasks.filter((t) => t.parentId === phase.id);
      const allUnitTasks = leafTasks.filter((t) => t.parentId === phase.id);
      const unitProgress = Math.round(
        allUnitTasks.reduce((s, t) => s + (t.status === 'COMPLETED' ? 100 : t.percentComplete), 0) /
          Math.max(allUnitTasks.length, 1)
      );
      const hasNonCriticalOpenStep = allUnitTasks.some(
        (t) => !critical.has(t.id) && !['COMPLETED', 'CANCELLED'].includes(t.status)
      );

      return {
        id: phase.id,
        title: phase.title,
        progress: unitProgress,
        tasks: unitTasks,
        showCriticalBadge: hasNonCriticalOpenStep,
      };
    });
  }, [phases, leafTasks, filteredLeafTasks, critical]);

  return (
    <div>
      {/* Filter Chips Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline bg-surface px-4 py-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {[
            { key: 'all' as const, label: `All (${leafTasks.length})` },
            { key: 'open' as const, label: `Open (${leafTasks.filter((t) => !['COMPLETED', 'CANCELLED'].includes(t.status)).length})` },
            { key: 'review' as const, label: `In review (${leafTasks.filter((t) => t.status === 'IN_REVIEW').length})` },
            { key: 'problems' as const, label: `Problems (${leafTasks.filter((t) => t.status === 'BLOCKED').length})` },
            ...(currentUserId
              ? [
                  {
                    key: 'mine' as const,
                    label: `My tasks (${leafTasks.filter((t) => t.assignments.some((a) => a.user.id === currentUserId)).length})`,
                  },
                ]
              : []),
          ].map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={() => setFilterMode(chip.key)}
              className={clsx(
                'rounded-pill px-3 py-1 text-xs font-medium transition-colors',
                filterMode === chip.key
                  ? 'bg-ink text-canvas font-semibold'
                  : 'bg-surface-strong text-muted hover:text-ink'
              )}
            >
              {chip.label}
            </button>
          ))}
        </div>
      </div>

      {/* Collapsible Units */}
      <div className="divide-y divide-hairline">
        {units.map((unit) => {
          const isCollapsed = collapsedUnits.has(unit.id);

          return (
            <div key={unit.id} className="space-y-0">
              {/* Unit Header Bar */}
              <div
                onClick={() => toggleUnit(unit.id)}
                className="flex cursor-pointer items-center justify-between bg-canvas-soft px-4 py-3 hover:bg-surface-strong/40 transition-colors select-none"
              >
                <div className="flex items-center gap-3">
                  <span className="text-xs font-bold text-muted font-mono">{isCollapsed ? '+' : '−'}</span>
                  <span className="text-title-sm font-semibold text-ink">{cleanTaskTitle(unit.title)}</span>
                  <span className="badge bg-surface text-muted text-caption">{unit.tasks.length} steps</span>
                </div>
                <div className="flex items-center gap-3 w-44">
                  <ProgressBar value={unit.progress} className="flex-1" />
                  <span className="text-caption text-muted font-mono font-semibold w-10 text-right">
                    {unit.progress}%
                  </span>
                </div>
              </div>

              {/* Unit Task Table */}
              {!isCollapsed && (
                <div className="overflow-x-auto">
                  <table className="table min-w-[700px]">
                    <thead>
                      <tr className="select-none text-caption text-muted border-b border-hairline">
                        <th className="w-[45%]">Step & Title</th>
                        <th className="w-[25%]">Assignee</th>
                        <th className="w-32">Progress</th>
                        <th className="text-right w-24">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {unit.tasks.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="py-5 text-center text-body-sm text-muted">
                            No steps match the selected filter.
                          </td>
                        </tr>
                      ) : (
                        unit.tasks.map((task, idx) => (
                          <tr key={task.id} className="hover:bg-canvas-soft/40 transition-colors">
                            <td>
                              <div className="flex items-baseline gap-2">
                                <span className="font-mono text-caption text-muted font-semibold">
                                  {idx + 1}.
                                </span>
                                <Link
                                  href={`/pm/tasks/${task.id}`}
                                  className="font-medium text-ink hover:underline"
                                >
                                  {cleanTaskTitle(task.title)}
                                </Link>
                              </div>
                              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 pl-5">
                                {task.type === 'ADHOC' ? (
                                  <span className="badge bg-surface-strong text-ink">ad-hoc</span>
                                ) : null}
                                {unit.showCriticalBadge && critical.has(task.id) ? (
                                  <span className="badge bg-error/[0.06] text-error" title="Critical path item">
                                    critical
                                  </span>
                                ) : null}
                                {task._count.dependencies > 0 ? (
                                  <span className="badge bg-surface-strong text-muted" title="Depends on other tasks">
                                    {task._count.dependencies} dep
                                  </span>
                                ) : null}
                              </div>
                            </td>
                            <td>
                              <AssigneeCell
                                taskId={task.id}
                                projectId={projectId}
                                assignees={task.assignments.map((a) => a.user)}
                                canAssign={canAssign}
                                colleagues={colleagues}
                              />
                            </td>
                            <td>
                              <ProgressBar
                                value={task.percentComplete}
                                tone={
                                  task.isBlocked || task.status === 'BLOCKED'
                                    ? 'danger'
                                    : task.status === 'COMPLETED'
                                    ? 'success'
                                    : 'default'
                                }
                              />
                              <span className="mt-0.5 block text-caption text-muted font-mono">
                                {task.percentComplete}%
                              </span>
                            </td>
                            <td className="text-right">
                              <StatusBadge
                                status={task.effectiveStatus || (task.isBlocked || task.status === 'BLOCKED' ? 'BLOCKED' : task.status)}
                              />
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
