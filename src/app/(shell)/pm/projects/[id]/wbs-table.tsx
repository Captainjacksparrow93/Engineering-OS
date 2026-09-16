'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { ProgressBar, StatusBadge, AvatarStack } from '@/components/ui';
import { AssigneeCell } from '@/components/assignee-cell';
import { cleanTaskTitle } from '@/core/utils/strings';

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

type SortField = 'task' | 'assignee' | 'progress' | 'status';
type SortDir = 'asc' | 'desc';

/**
 * The checklist tasks rendered as a clean, focused table with interactive sorting.
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
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      if (sortDir === 'asc') setSortDir('desc');
      else setSortField(null);
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const critical = useMemo(() => new Set(criticalTaskIds), [criticalTaskIds]);

  const childrenOf = useMemo(() => {
    const map = new Map<string | null, WbsTask[]>();
    for (const task of tasks) {
      const key = task.parentId ?? null;
      map.set(key, [...(map.get(key) ?? []), task]);
    }
    return map;
  }, [tasks]);

  const myTasksCount = useMemo(() => {
    return currentUserId ? tasks.filter((t) => t.assignments.some((a) => a.user.id === currentUserId)).length : 0;
  }, [tasks, currentUserId]);

  const rows = useMemo(() => {
    let baseList = tasks;
    if (filterMode === 'mine' && currentUserId) {
      baseList = tasks.filter((t) => t.assignments.some((a) => a.user.id === currentUserId));
    }

    if (sortField) {
      const sorted = [...baseList];
      sorted.sort((a, b) => {
        let cmp = 0;
        if (sortField === 'task') {
          cmp = a.title.localeCompare(b.title);
        } else if (sortField === 'assignee') {
          const nameA = a.assignments[0]?.user.fullName || '';
          const nameB = b.assignments[0]?.user.fullName || '';
          cmp = nameA.localeCompare(nameB);
        } else if (sortField === 'progress') {
          cmp = a.rolledUpPercent - b.rolledUpPercent;
        } else if (sortField === 'status') {
          cmp = a.status.localeCompare(b.status);
        }
        return sortDir === 'asc' ? cmp : -cmp;
      });
      return sorted.map((task) => ({ task, depth: 0 }));
    }

    // Default hierarchy walk
    const result: Array<{ task: WbsTask; depth: number }> = [];
    if (filterMode === 'mine' && currentUserId) {
      for (const task of baseList) {
        result.push({ task, depth: 0 });
      }
    } else {
      const walk = (parentId: string | null, depth: number) => {
        for (const task of childrenOf.get(parentId) ?? []) {
          result.push({ task, depth });
          walk(task.id, depth + 1);
        }
      };
      walk(null, 0);
    }
    return result;
  }, [tasks, filterMode, currentUserId, sortField, sortDir, childrenOf]);

  if (tasks.length === 0) {
    return <p className="p-4 text-body-sm text-muted">No tasks yet. Break the project down below.</p>;
  }

  const renderSortArrow = (field: SortField) => {
    if (sortField !== field) return <span className="text-muted/40 ml-1">⇅</span>;
    return <span className="text-ink ml-1 font-bold">{sortDir === 'asc' ? '▲' : '▼'}</span>;
  };

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
        <table className="table min-w-[640px]">
          <thead>
            <tr className="select-none">
              <th onClick={() => handleSort('task')} className="w-[45%] cursor-pointer hover:text-ink">
                Task {renderSortArrow('task')}
              </th>
              <th onClick={() => handleSort('assignee')} className="w-[25%] cursor-pointer hover:text-ink">
                Assignee {renderSortArrow('assignee')}
              </th>
              <th onClick={() => handleSort('progress')} className="w-36 cursor-pointer hover:text-ink">
                Progress {renderSortArrow('progress')}
              </th>
              <th onClick={() => handleSort('status')} className="w-28 cursor-pointer hover:text-ink">
                Status {renderSortArrow('status')}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-6 text-center text-body-sm text-muted">
                  No tasks assigned to you in this project.
                </td>
              </tr>
            ) : (
              rows.map(({ task, depth }) => {
                const isPhase = task.type === 'PHASE' || task._count.children > 0;

                return (
                  <tr key={task.id} className={clsx(isPhase && 'bg-canvas-soft')}>
                    <td style={{ paddingLeft: 12 + depth * 18 }}>
                      <Link
                        href={`/pm/tasks/${task.id}`}
                        className={clsx('hover:text-ink', isPhase ? 'font-semibold text-ink' : 'text-ink')}
                      >
                        {cleanTaskTitle(task.title)}
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
