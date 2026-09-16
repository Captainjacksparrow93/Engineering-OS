'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { formatDate, daysUntil } from '@/core/utils/dates';
import { cleanTaskTitle } from '@/core/utils/strings';
import { EmptyState, PriorityBadge, ProgressBar, StatusBadge } from '@/components/ui';

export interface DashboardMyWorkItem {
  id: string;
  task: {
    id: string;
    code: string;
    title: string;
    status: string;
    priority: string;
    percentComplete: number;
    plannedEnd: Date | string | null;
    type: string;
    project: { id: string; code: string; name: string };
  };
}

type SortField = 'task' | 'project' | 'due' | 'progress' | 'status';
type SortDir = 'asc' | 'desc';

export function DashboardMyWorkTable({ items }: { items: DashboardMyWorkItem[] }) {
  const [sortField, setSortField] = useState<SortField | null>('due');
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

  const sortedItems = useMemo(() => {
    if (!sortField) return items;
    const list = [...items];
    list.sort((a, b) => {
      let cmp = 0;
      if (sortField === 'task') {
        cmp = a.task.title.localeCompare(b.task.title);
      } else if (sortField === 'project') {
        cmp = a.task.project.name.localeCompare(b.task.project.name);
      } else if (sortField === 'due') {
        const timeA = a.task.plannedEnd ? new Date(a.task.plannedEnd).getTime() : Number.POSITIVE_INFINITY;
        const timeB = b.task.plannedEnd ? new Date(b.task.plannedEnd).getTime() : Number.POSITIVE_INFINITY;
        cmp = timeA - timeB;
      } else if (sortField === 'progress') {
        cmp = a.task.percentComplete - b.task.percentComplete;
      } else if (sortField === 'status') {
        cmp = a.task.status.localeCompare(b.task.status);
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [items, sortField, sortDir]);

  if (items.length === 0) {
    return (
      <div className="p-4">
        <EmptyState title="Nothing assigned to you right now" hint="New work will appear here the moment it is assigned." />
      </div>
    );
  }

  const renderSortArrow = (field: SortField) => {
    if (sortField !== field) return <span className="text-muted/40 ml-1">⇅</span>;
    return <span className="text-ink ml-1 font-bold">{sortDir === 'asc' ? '▲' : '▼'}</span>;
  };

  return (
    <table className="table">
      <thead>
        <tr className="select-none">
          <th onClick={() => handleSort('task')} className="cursor-pointer hover:text-ink">
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
        </tr>
      </thead>
      <tbody>
        {sortedItems.slice(0, 8).map(({ task }) => {
          const due = daysUntil(task.plannedEnd ? new Date(task.plannedEnd) : null);
          return (
            <tr key={task.id}>
              <td>
                <Link href={`/pm/tasks/${task.id}`} className="font-medium text-ink hover:text-ink">
                  {cleanTaskTitle(task.title)}
                </Link>
                {task.priority !== 'MEDIUM' ? (
                  <div className="mt-0.5 flex items-center gap-2">
                    <PriorityBadge priority={task.priority} />
                  </div>
                ) : null}
              </td>
              <td className="text-caption text-muted">{task.project.name}</td>
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
  );
}
