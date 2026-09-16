'use client';

import { useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { daysUntil } from '@/core/utils/dates';
import { ProgressBar, StatusBadge, AvatarStack } from '@/components/ui';
import { AssigneeCell } from '@/components/assignee-cell';

interface WbsTask {
  id: string;
  code: string;
  title: string;
  type: string;
  status: string;
  priority: string;
  parentId: string | null;
  estimatedHours: number;
  actualHours: number;
  percentComplete: number;
  rolledUpPercent: number;
  plannedStart: Date | null;
  plannedEnd: Date | null;
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

function formatCompactRange(start: Date | string | null | undefined, end: Date | string | null | undefined): string {
  if (!start && !end) return '-';
  if (!start && end) {
    const d = typeof end === 'string' ? new Date(end) : end;
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  }
  if (start && !end) {
    const d = typeof start === 'string' ? new Date(start) : start;
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  }
  const s = typeof start === 'string' ? new Date(start!) : start!;
  const e = typeof end === 'string' ? new Date(end!) : end!;
  const sDay = s.getUTCDate();
  const eDay = e.getUTCDate();
  const sMonth = s.toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' });
  const eMonth = e.toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' });

  if (sMonth === eMonth && s.getUTCFullYear() === e.getUTCFullYear()) {
    if (sDay === eDay) return `${sDay} ${sMonth}`;
    return `${sDay}–${eDay} ${sMonth}`;
  }
  return `${sDay} ${sMonth} – ${eDay} ${eMonth}`;
}

/**
 * The checklist tasks rendered as a clean, focused table.
 */
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
  const [filterMode, setFilterMode] = useState<'all' | 'mine'>('all');

  if (tasks.length === 0) {
    return <p className="p-4 text-body-sm text-muted">No tasks yet. Break the project down below.</p>;
  }

  const critical = new Set(criticalTaskIds);
  const childrenOf = new Map<string | null, WbsTask[]>();
  for (const task of tasks) {
    const key = task.parentId ?? null;
    childrenOf.set(key, [...(childrenOf.get(key) ?? []), task]);
  }

  const myTasksCount = currentUserId
    ? tasks.filter((t) => t.assignments.some((a) => a.user.id === currentUserId)).length
    : 0;

  const rows: Array<{ task: WbsTask; depth: number }> = [];
  if (filterMode === 'mine' && currentUserId) {
    const myTasks = tasks.filter((t) => t.assignments.some((a) => a.user.id === currentUserId));
    for (const task of myTasks) {
      rows.push({ task, depth: 0 });
    }
  } else {
    const walk = (parentId: string | null, depth: number) => {
      for (const task of childrenOf.get(parentId) ?? []) {
        rows.push({ task, depth });
        walk(task.id, depth + 1);
      }
    };
    walk(null, 0);
  }

  return (
    <div>
      {currentUserId ? (
        <div className="flex items-center gap-2 border-b border-hairline bg-surface px-4 py-2 text-xs">
          <button
            type="button"
            onClick={() => setFilterMode('all')}
            className={clsx(
              'rounded px-2.5 py-1 font-medium transition-colors',
              filterMode === 'all'
                ? 'bg-surface-strong text-ink font-semibold'
                : 'text-muted hover:text-ink',
            )}
          >
            All Tasks ({tasks.length})
          </button>
          <button
            type="button"
            onClick={() => setFilterMode('mine')}
            className={clsx(
              'rounded px-2.5 py-1 font-medium transition-colors',
              filterMode === 'mine'
                ? 'bg-surface-strong text-ink font-semibold'
                : 'text-muted hover:text-ink',
            )}
          >
            My Tasks ({myTasksCount})
          </button>
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="table min-w-[760px]">
          <thead>
            <tr>
              <th className="w-[42%]">Task</th>
              <th>Assignee</th>
              <th>Timeline</th>
              <th className="w-32">Progress</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-6 text-center text-body-sm text-muted">
                  No tasks assigned to you in this project.
                </td>
              </tr>
            ) : (
              rows.map(({ task, depth }) => {
                const isPhase = task.type === 'PHASE' || task._count.children > 0;
                const overdue = task.plannedEnd && new Date(task.plannedEnd) < new Date() && !['COMPLETED', 'CANCELLED'].includes(task.status);
                const due = daysUntil(task.plannedEnd);
                const isClosed = ['COMPLETED', 'CANCELLED'].includes(task.status);

                return (
                  <tr key={task.id} className={clsx(isPhase && 'bg-canvas-soft')}>
                    <td style={{ paddingLeft: 12 + depth * 18 }}>
                      <Link
                        href={`/pm/tasks/${task.id}`}
                        className={clsx('hover:text-ink', isPhase ? 'font-semibold text-ink' : 'text-ink')}
                      >
                        {task.title}
                      </Link>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                        {task.type === 'ADHOC' ? <span className="badge bg-surface-strong text-ink">ad-hoc</span> : null}
                        {critical.has(task.id) && !isPhase ? (
                          <span className="badge bg-error/[0.06] text-error" title="Critical path item">
                            critical
                          </span>
                        ) : null}
                        {task._count.dependencies > 0 ? (
                          <span className="badge bg-surface-strong text-muted" title="Depends on other tasks">
                            {task._count.dependencies} dep
                          </span>
                        ) : null}
                        {task._count.handovers > 0 ? (
                          <span className="badge bg-surface-strong text-ink">handover</span>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      {isPhase ? (
                        <AvatarStack people={task.assignments.map((a) => a.user)} />
                      ) : (
                        <AssigneeCell
                          taskId={task.id}
                          projectId={projectId}
                          assignees={task.assignments.map((a) => a.user)}
                          canAssign={canAssign}
                          colleagues={colleagues}
                        />
                      )}
                    </td>
                    <td className="whitespace-nowrap text-caption">
                      <span className={clsx('block font-medium', overdue ? 'text-error' : 'text-ink')}>
                        {formatCompactRange(task.plannedStart, task.plannedEnd)}
                      </span>
                      {!isClosed && due !== null ? (
                        <span className={clsx('block text-[11px]', due < 0 ? 'text-error font-medium' : 'text-muted')}>
                          {due < 0 ? `${-due}d late` : due === 0 ? 'Due today' : `in ${due}d`}
                        </span>
                      ) : null}
                    </td>
                    <td>
                      <ProgressBar
                        value={task.rolledUpPercent}
                        tone={task.status === 'BLOCKED' ? 'danger' : task.status === 'COMPLETED' ? 'success' : 'default'}
                      />
                      <span className="mt-1 block text-caption text-muted">{task.rolledUpPercent}%</span>
                    </td>
                    <td>
                      <StatusBadge status={task.status} />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

