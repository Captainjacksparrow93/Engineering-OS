'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { formatDate } from '@/core/utils/dates';
import { formatName } from '@/core/utils/strings';
import { Avatar, EmptyState, PriorityBadge, ProgressBar, StatusBadge } from '@/components/ui';

interface ProjectListItem {
  id: string;
  code: string;
  name: string;
  clientName: string;
  status: string;
  priority: string;
  targetEndDate: Date | string | null;
  panelCount: number;
  manager: { id: string; fullName: string; avatarColor?: string | null };
  stats: {
    taskCount: number;
    completedCount: number;
    blockedCount: number;
    progressPercent: number;
  };
}

export function ProjectsClient({
  projects,
  canCreate,
  emptyHint,
  initialStatus,
}: {
  projects: ProjectListItem[];
  canCreate: boolean;
  emptyHint: string;
  initialStatus?: string;
}) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>(initialStatus || 'ALL');

  const filtered = useMemo(() => {
    return projects.filter((p) => {
      // Status filter
      if (statusFilter !== 'ALL' && p.status !== statusFilter) {
        return false;
      }
      // Search query
      if (search.trim()) {
        const q = search.toLowerCase();
        const matchesName = p.name.toLowerCase().includes(q);
        const matchesCode = p.code.toLowerCase().includes(q);
        const matchesClient = p.clientName.toLowerCase().includes(q);
        const matchesManager = p.manager ? p.manager.fullName.toLowerCase().includes(q) : false;
        if (!matchesName && !matchesCode && !matchesClient && !matchesManager) {
          return false;
        }
      }
      return true;
    });
  }, [projects, search, statusFilter]);

  const filterChips = [
    { key: 'ALL', label: `All (${projects.length})` },
    { key: 'IN_PROGRESS', label: `In progress (${projects.filter((p) => p.status === 'IN_PROGRESS').length})` },
    { key: 'COMMISSIONING', label: `Commissioning (${projects.filter((p) => p.status === 'COMMISSIONING').length})` },
    { key: 'PLANNING', label: `Planning (${projects.filter((p) => p.status === 'PLANNING').length})` },
    { key: 'ON_HOLD', label: `On hold (${projects.filter((p) => p.status === 'ON_HOLD').length})` },
    { key: 'COMPLETED', label: `Completed (${projects.filter((p) => p.status === 'COMPLETED').length})` },
    { key: 'CLOSED', label: `Closed (${projects.filter((p) => p.status === 'CLOSED').length})` },
  ];

  return (
    <div className="space-y-4">
      {/* Search & Status Filter Chips */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {filterChips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={() => setStatusFilter(chip.key)}
              className={clsx(
                'rounded-pill px-3 py-1 text-xs font-medium transition-colors',
                statusFilter === chip.key
                  ? 'bg-ink text-canvas font-semibold'
                  : 'bg-surface-strong text-muted hover:text-ink'
              )}
            >
              {chip.label}
            </button>
          ))}
        </div>

        <div className="w-full sm:w-64">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search projects..."
            className="input w-full text-xs py-1.5"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="No projects match"
          hint={emptyHint}
          action={
            canCreate ? (
              <Link href="/pm/projects/new" className="btn btn-secondary text-body-sm">
                New project
              </Link>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
          {filtered.map((project) => {
            const isLate =
              project.targetEndDate &&
              new Date(project.targetEndDate).getTime() < new Date().getTime() &&
              project.status !== 'COMPLETED';

            return (
              <Link
                key={project.id}
                href={`/pm/projects/${project.id}`}
                className="card p-4 transition hover:border-hairline-strong bg-surface block space-y-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-title-sm font-semibold text-ink">{project.name}</p>
                    <p className="text-caption text-muted">{project.clientName}</p>
                  </div>
                  <StatusBadge status={project.status} />
                </div>

                <div>
                  <ProgressBar value={project.stats.progressPercent} />
                  <div className="mt-1 flex items-center justify-between text-caption text-muted font-mono">
                    <span>
                      {project.stats.completedCount}/{project.stats.taskCount} steps
                    </span>
                    <span>{project.stats.progressPercent}%</span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <PriorityBadge priority={project.priority} />
                  {project.stats.blockedCount > 0 ? (
                    <span className="badge bg-error/[0.08] text-error text-xs">
                      {project.stats.blockedCount} blocked
                    </span>
                  ) : null}
                  {project.panelCount > 0 ? (
                    <span className="badge bg-surface-strong text-ink text-xs">
                      {project.panelCount} panels
                    </span>
                  ) : null}
                </div>

                <div className="flex items-center justify-between border-t border-hairline pt-2.5 text-caption">
                  {project.manager ? (
                    <span className="flex items-center gap-1.5 text-ink">
                      <Avatar
                        name={formatName(project.manager.fullName)}
                        color={project.manager.avatarColor}
                        size={20}
                      />
                      <span className="font-medium">{formatName(project.manager.fullName)}</span>
                    </span>
                  ) : (
                    <span className="text-muted-soft">Unassigned</span>
                  )}
                  <span className={isLate ? 'font-semibold text-error' : 'text-muted'}>
                    {project.targetEndDate ? formatDate(project.targetEndDate) : 'No target date'}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
