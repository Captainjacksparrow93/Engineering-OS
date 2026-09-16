'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { formatName, cleanTaskTitle } from '@/core/utils/strings';
import { formatDate } from '@/core/utils/dates';
import { Avatar, EmptyState, ProgressBar, StatusBadge } from '@/components/ui';
import type { Workload } from '@/modules/project-management/domain/availability';

type FilterStatus = 'all' | 'overloaded' | 'busy' | 'free' | 'leave';

export function TeamLoadTable({ workloads }: { workloads: Workload[] }) {
  const [filter, setFilter] = useState<FilterStatus>('all');
  const [expandedPersonIds, setExpandedPersonIds] = useState<Set<string>>(new Set());
  const [sortField, setSortField] = useState<'utilization' | 'name' | 'freeDays' | 'openTasks'>('utilization');
  const [sortAsc, setSortAsc] = useState(false);

  const toggleExpand = (id: string) => {
    setExpandedPersonIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const counts = useMemo(() => {
    return {
      all: workloads.length,
      overloaded: workloads.filter((w) => w.status === 'OVERLOADED').length,
      busy: workloads.filter((w) => w.status === 'BUSY').length,
      free: workloads.filter((w) => w.status === 'FREE' || w.status === 'AVAILABLE').length,
      leave: workloads.filter((w) => w.status === 'ON_LEAVE' || w.leaveDays > 0).length,
    };
  }, [workloads]);

  const filtered = useMemo(() => {
    return workloads.filter((w) => {
      if (filter === 'overloaded') return w.status === 'OVERLOADED';
      if (filter === 'busy') return w.status === 'BUSY';
      if (filter === 'free') return w.status === 'FREE' || w.status === 'AVAILABLE';
      if (filter === 'leave') return w.status === 'ON_LEAVE' || w.leaveDays > 0;
      return true;
    });
  }, [workloads, filter]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let diff = 0;
      if (sortField === 'utilization') {
        diff = a.utilizationPercent - b.utilizationPercent;
      } else if (sortField === 'name') {
        diff = a.person.fullName.localeCompare(b.person.fullName);
      } else if (sortField === 'freeDays') {
        diff = a.freeHours - b.freeHours;
      } else if (sortField === 'openTasks') {
        diff = a.openTaskCount - b.openTaskCount;
      }
      return sortAsc ? diff : -diff;
    });
  }, [filtered, sortField, sortAsc]);

  const handleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortAsc((prev) => !prev);
    } else {
      setSortField(field);
      setSortAsc(field === 'name'); // default asc for name, desc for numbers
    }
  };

  const chips: Array<{ key: FilterStatus; label: string; count: number }> = [
    { key: 'all', label: 'All', count: counts.all },
    { key: 'overloaded', label: 'Overloaded', count: counts.overloaded },
    { key: 'busy', label: 'Busy', count: counts.busy },
    { key: 'free', label: 'Free', count: counts.free },
    { key: 'leave', label: 'On leave', count: counts.leave },
  ];

  return (
    <div className="space-y-4">
      {/* Filter Chips */}
      <div className="flex flex-wrap items-center gap-1.5">
        {chips.map((chip) => (
          <button
            key={chip.key}
            type="button"
            onClick={() => setFilter(chip.key)}
            className={clsx(
              'rounded-pill px-3 py-1 text-xs font-medium transition-colors',
              filter === chip.key
                ? 'bg-ink text-canvas font-semibold'
                : 'bg-surface-strong text-muted hover:text-ink'
            )}
          >
            {chip.label} ({chip.count})
          </button>
        ))}
      </div>

      {sorted.length === 0 ? (
        <EmptyState
          title="No team members match this filter"
          hint="Try switching filters or adjusting the date window above."
        />
      ) : (
        <div className="card overflow-hidden divide-y divide-hairline">
          {/* Desktop Table View */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-left text-body-sm">
              <thead className="border-b border-hairline bg-surface text-caption font-semibold text-muted">
                <tr>
                  <th
                    className="cursor-pointer px-4 py-3 hover:text-ink select-none"
                    onClick={() => handleSort('name')}
                    aria-sort={sortField === 'name' ? (sortAsc ? 'ascending' : 'descending') : undefined}
                  >
                    <span className="flex items-center gap-1">
                      Person {sortField === 'name' ? (sortAsc ? '▲' : '▼') : ''}
                    </span>
                  </th>
                  <th
                    className="cursor-pointer px-4 py-3 hover:text-ink select-none w-48"
                    onClick={() => handleSort('utilization')}
                    aria-sort={sortField === 'utilization' ? (sortAsc ? 'ascending' : 'descending') : undefined}
                  >
                    <span className="flex items-center gap-1">
                      Load (%) {sortField === 'utilization' ? (sortAsc ? '▲' : '▼') : ''}
                    </span>
                  </th>
                  <th
                    className="cursor-pointer px-4 py-3 hover:text-ink select-none"
                    onClick={() => handleSort('freeDays')}
                    aria-sort={sortField === 'freeDays' ? (sortAsc ? 'ascending' : 'descending') : undefined}
                  >
                    <span className="flex items-center gap-1">
                      Free {sortField === 'freeDays' ? (sortAsc ? '▲' : '▼') : ''}
                    </span>
                  </th>
                  <th
                    className="cursor-pointer px-4 py-3 hover:text-ink select-none"
                    onClick={() => handleSort('openTasks')}
                    aria-sort={sortField === 'openTasks' ? (sortAsc ? 'ascending' : 'descending') : undefined}
                  >
                    <span className="flex items-center gap-1">
                      Open steps {sortField === 'openTasks' ? (sortAsc ? '▲' : '▼') : ''}
                    </span>
                  </th>
                  <th className="px-4 py-3">Leave</th>
                  <th className="px-4 py-3 text-right">Status</th>
                </tr>
              </thead>
                {sorted.map((workload) => {
                  const isExpanded = expandedPersonIds.has(workload.person.id);
                  const freeDays = Math.max(0, Math.round((workload.freeHours / 8) * 10) / 10);
                  const commDays = Math.round((workload.committedHours / 8) * 10) / 10;
                  const totalDays = workload.workingDays;

                  return (
                    <tbody key={workload.person.id} className="divide-y divide-hairline">
                      <tr
                        onClick={() => toggleExpand(workload.person.id)}
                        className={clsx(
                          'group cursor-pointer transition-colors hover:bg-surface-strong/50',
                          isExpanded ? 'bg-surface-strong/30' : ''
                        )}
                      >
                        {/* Person Info */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <span className="text-caption text-muted w-3 text-center shrink-0">
                              {isExpanded ? '▼' : '▶'}
                            </span>
                            <Avatar
                              name={formatName(workload.person.fullName)}
                              color={workload.person.avatarColor}
                              size={32}
                            />
                            <div className="min-w-0 flex-1 truncate">
                              <p className="truncate text-body-sm font-semibold text-ink">
                                {formatName(workload.person.fullName)}
                              </p>
                              <p className="truncate text-caption text-muted">
                                {workload.person.designation || workload.person.grade.replaceAll('_', ' ').toLowerCase()}
                              </p>
                            </div>
                          </div>
                        </td>

                        {/* Load Bar */}
                        <td className="px-4 py-3 w-48">
                          <div className="w-full">
                            <div className="flex items-center justify-between text-caption text-muted mb-1 font-mono">
                              <span>{commDays}d of {totalDays}d</span>
                              <span
                                className={
                                  workload.utilizationPercent > 100
                                    ? 'font-bold text-error'
                                    : 'font-medium text-ink'
                                }
                              >
                                {workload.utilizationPercent}%
                              </span>
                            </div>
                            <ProgressBar
                              value={Math.min(100, workload.utilizationPercent)}
                              tone={
                                workload.utilizationPercent > 100
                                  ? 'danger'
                                  : workload.utilizationPercent < 60
                                  ? 'success'
                                  : 'default'
                              }
                            />
                          </div>
                        </td>

                        {/* Free Capacity in Days */}
                        <td className="px-4 py-3 text-body-sm whitespace-nowrap">
                          {freeDays > 0 ? (
                            <span className="font-medium text-ink">{freeDays} days</span>
                          ) : (
                            <span className="text-muted">0 days</span>
                          )}
                        </td>

                        {/* Open Steps */}
                        <td className="px-4 py-3 text-body-sm whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <span>{workload.openTaskCount} steps</span>
                            {workload.overdueTaskCount > 0 ? (
                              <span className="badge bg-error/[0.08] text-error text-[10px] font-bold">
                                {workload.overdueTaskCount} late
                              </span>
                            ) : null}
                          </div>
                        </td>

                        {/* Leave Days */}
                        <td className="px-4 py-3 text-caption text-muted whitespace-nowrap">
                          {workload.leaveDays > 0 ? `${workload.leaveDays}d leave` : '—'}
                        </td>

                        {/* Status Pill */}
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <StatusBadge status={workload.status} />
                        </td>
                      </tr>

                      {/* Expanded Tasks Drawer */}
                      {isExpanded ? (
                        <tr className="bg-surface">
                          <td colSpan={6} className="px-6 py-3 border-t border-hairline">
                            <div className="space-y-2">
                              <p className="text-caption font-semibold text-muted uppercase tracking-wider">
                                Assigned Steps ({workload.assignments.length})
                              </p>
                              {workload.assignments.length === 0 ? (
                                <p className="text-caption text-success py-1">
                                  No open tasks assigned in this window — available immediately.
                                </p>
                              ) : (
                                <div className="divide-y divide-hairline rounded border border-hairline bg-canvas">
                                  {workload.assignments.map((a) => (
                                    <div
                                      key={a.taskId}
                                      className="flex items-center justify-between gap-3 px-3 py-2 text-body-sm hover:bg-surface transition-colors"
                                    >
                                      <div className="min-w-0 flex-1">
                                        <Link
                                          href={`/pm/tasks/${a.taskId}`}
                                          className="font-medium text-ink hover:underline truncate block"
                                        >
                                          {cleanTaskTitle(a.taskTitle)}
                                        </Link>
                                        <p className="text-caption text-muted font-mono">
                                          {a.projectName || a.projectCode}
                                          {a.plannedEnd ? ` · Due ${formatDate(a.plannedEnd)}` : ''}
                                        </p>
                                      </div>
                                      <StatusBadge status={a.status} />
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  );
                })}
            </table>
          </div>

          {/* Mobile Stacked Cards View (<640px) */}
          <div className="sm:hidden divide-y divide-hairline">
            {sorted.map((workload) => {
              const isExpanded = expandedPersonIds.has(workload.person.id);
              const freeDays = Math.max(0, Math.round((workload.freeHours / 8) * 10) / 10);
              const commDays = Math.round((workload.committedHours / 8) * 10) / 10;
              const totalDays = workload.workingDays;

              return (
                <div key={workload.person.id} className="p-4 space-y-3 bg-canvas">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <Avatar
                        name={formatName(workload.person.fullName)}
                        color={workload.person.avatarColor}
                        size={32}
                      />
                      <div>
                        <p className="font-semibold text-ink text-body-sm">
                          {formatName(workload.person.fullName)}
                        </p>
                        <p className="text-caption text-muted">
                          {workload.person.designation || workload.person.grade.replaceAll('_', ' ').toLowerCase()}
                        </p>
                      </div>
                    </div>
                    <StatusBadge status={workload.status} />
                  </div>

                  <div>
                    <div className="flex items-center justify-between text-caption text-muted mb-1 font-mono">
                      <span>{commDays}d of {totalDays}d committed</span>
                      <span className={workload.utilizationPercent > 100 ? 'font-bold text-error' : 'font-medium text-ink'}>
                        {workload.utilizationPercent}%
                      </span>
                    </div>
                    <ProgressBar
                      value={Math.min(100, workload.utilizationPercent)}
                      tone={workload.utilizationPercent > 100 ? 'danger' : workload.utilizationPercent < 60 ? 'success' : 'default'}
                    />
                  </div>

                  <div className="flex items-center justify-between text-caption text-muted border-t border-hairline pt-2">
                    <span>{freeDays} days free</span>
                    <span>{workload.openTaskCount} steps {workload.overdueTaskCount > 0 ? `(${workload.overdueTaskCount} late)` : ''}</span>
                    {workload.leaveDays > 0 ? <span>{workload.leaveDays}d leave</span> : null}
                  </div>

                  <button
                    type="button"
                    onClick={() => toggleExpand(workload.person.id)}
                    className="w-full text-center text-caption font-semibold text-muted hover:text-ink pt-1"
                  >
                    {isExpanded ? 'Hide tasks ▲' : `View ${workload.assignments.length} tasks ▼`}
                  </button>

                  {isExpanded ? (
                    <div className="mt-2 space-y-1 rounded border border-hairline bg-surface p-2">
                      {workload.assignments.length === 0 ? (
                        <p className="text-caption text-success">No open tasks assigned.</p>
                      ) : (
                        workload.assignments.map((a) => (
                          <Link
                            key={a.taskId}
                            href={`/pm/tasks/${a.taskId}`}
                            className="flex items-center justify-between gap-2 py-1 text-caption text-ink hover:underline"
                          >
                            <span className="truncate">{cleanTaskTitle(a.taskTitle)}</span>
                            <StatusBadge status={a.status} />
                          </Link>
                        ))
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
