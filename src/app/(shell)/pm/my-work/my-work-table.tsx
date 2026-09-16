'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { formatDate, daysUntil } from '@/core/utils/dates';
import { PriorityBadge, ProgressBar, StatusBadge } from '@/components/ui';

export interface MyWorkRow {
  task: {
    id: string;
    code: string;
    title: string;
    status: string;
    priority: string;
    percentComplete: number;
    plannedEnd: Date | string | null;
    type: string;
    project: { id: string; code: string; name: string; clientName: string };
  };
  assignment: {
    id: string;
    role: string;
    allocatedHours: number;
  };
  unmetDependencies: Array<{
    id: string;
    code: string;
    title: string;
    status: string;
  }>;
}

type SortField = 'task' | 'project' | 'due' | 'progress' | 'status' | 'waitingOn';
type SortDir = 'asc' | 'desc';

export function MyWorkTable({ rows }: { rows: MyWorkRow[] }) {
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

  const sortedRows = useMemo(() => {
    if (!sortField) return rows;
    const list = [...rows];
    list.sort((a, b) => {
      let cmp = 0;
      if (sortField === 'task') {
        cmp = a.task.title.localeCompare(b.task.title);
      } else if (sortField === 'project') {
        cmp = a.task.project.name.localeCompare(b.task.project.name);
      } else if (sortField === 'due') {
        const timeA = a.task.plannedEnd ? new Date(a.task.plannedEnd).getTime() : 0;
        const timeB = b.task.plannedEnd ? new Date(b.task.plannedEnd).getTime() : 0;
        cmp = timeA - timeB;
      } else if (sortField === 'progress') {
        cmp = a.task.percentComplete - b.task.percentComplete;
      } else if (sortField === 'status') {
        cmp = a.task.status.localeCompare(b.task.status);
      } else if (sortField === 'waitingOn') {
        cmp = a.unmetDependencies.length - b.unmetDependencies.length;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [rows, sortField, sortDir]);

  const renderSortArrow = (field: SortField) => {
    if (sortField !== field) return <span className="text-muted/40 ml-1">⇅</span>;
    return <span className="text-ink ml-1 font-bold">{sortDir === 'asc' ? '▲' : '▼'}</span>;
  };

  return (
    <div className="overflow-x-auto">
      <table className="table min-w-[860px]">
        <thead>
          <tr className="select-none">
            <th onClick={() => handleSort('task')} className="w-[34%] cursor-pointer hover:text-ink">
              Task {renderSortArrow('task')}
            </th>
            <th onClick={() => handleSort('project')} className="cursor-pointer hover:text-ink">
              Project {renderSortArrow('project')}
            </th>
            <th onClick={() => handleSort('due')} className="cursor-pointer hover:text-ink">
              Due {renderSortArrow('due')}
            </th>
            <th onClick={() => handleSort('progress')} className="cursor-pointer hover:text-ink">
              Progress {renderSortArrow('progress')}
            </th>
            <th onClick={() => handleSort('status')} className="cursor-pointer hover:text-ink">
              Status {renderSortArrow('status')}
            </th>
            <th onClick={() => handleSort('waitingOn')} className="cursor-pointer hover:text-ink">
              Waiting on {renderSortArrow('waitingOn')}
            </th>
          </tr>
        </thead>
        <tbody>
          {sortedRows.map(({ task, assignment, unmetDependencies }) => {
            const due = daysUntil(task.plannedEnd ? new Date(task.plannedEnd) : null);
            return (
              <tr key={assignment.id}>
                <td>
                  <Link href={`/pm/tasks/${task.id}`} className="font-medium text-ink hover:text-ink">
                    {task.title}
                  </Link>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                    {task.priority !== 'MEDIUM' ? <PriorityBadge priority={task.priority} /> : null}
                    {task.type === 'ADHOC' ? <span className="badge bg-surface-strong text-ink">ad-hoc</span> : null}
                    {assignment.role !== 'OWNER' ? (
                      <span className="badge bg-surface-strong text-body">{assignment.role.toLowerCase()}</span>
                    ) : null}
                  </div>
                </td>
                <td className="text-caption text-muted">
                  <Link href={`/pm/projects/${task.project.id}`} className="hover:text-ink">
                    {task.project.name}
                  </Link>
                  <span className="block text-caption text-muted-soft">{task.project.clientName}</span>
                </td>
                <td className="whitespace-nowrap text-caption">
                  {task.plannedEnd ? (
                    <>
                      <span className={due !== null && due < 0 ? 'font-medium text-error' : 'text-body'}>
                        {formatDate(task.plannedEnd)}
                      </span>
                      <span className="block text-caption text-muted-soft">
                        {due !== null ? (due < 0 ? `${-due}d late` : `in ${due}d`) : ''}
                      </span>
                    </>
                  ) : (
                    '-'
                  )}
                </td>
                <td className="w-28">
                  <ProgressBar value={task.percentComplete} tone={task.status === 'BLOCKED' ? 'danger' : undefined} />
                  <span className="mt-1 block text-caption text-muted">{task.percentComplete}%</span>
                </td>
                <td>
                  <StatusBadge status={task.status} />
                </td>
                <td className="text-caption">
                  {unmetDependencies.length === 0 ? (
                    <span className="text-success font-medium">Ready to start</span>
                  ) : (
                    unmetDependencies.map((dep) => (
                      <Link key={dep.id} href={`/pm/tasks/${dep.id}`} className="block text-caption text-error hover:underline">
                        {dep.title}
                      </Link>
                    ))
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
