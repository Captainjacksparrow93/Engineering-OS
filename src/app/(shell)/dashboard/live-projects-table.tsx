'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { formatName } from '@/core/utils/strings';
import { formatDate, daysUntil } from '@/core/utils/dates';
import { Avatar, EmptyState, PriorityBadge, ProgressBar } from '@/components/ui';

export interface DashboardProject {
  id: string;
  code: string;
  name: string;
  clientName: string;
  status: string;
  priority: string;
  targetEndDate: Date | string | null;
  startDate?: Date | string | null;
  manager: { id: string; fullName: string; avatarColor?: string | null; designation?: string | null };
  taskCount: number;
  completedTaskCount: number;
  currentStep: string;
  blockedCount: number;
  overdueCount: number;
  progressPercent: number;
  dueSoon: boolean;
  health: 'ON_TRACK' | 'AT_RISK' | 'ROADBLOCK';
}

type SortField = 'project' | 'manager' | 'delivery' | 'progress' | 'health';
type SortDir = 'asc' | 'desc';

export function LiveProjectsTable({ projects }: { projects: DashboardProject[] }) {
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

  const sortedProjects = useMemo(() => {
    if (!sortField) return projects;
    const list = [...projects];
    list.sort((a, b) => {
      let cmp = 0;
      if (sortField === 'project') {
        cmp = a.name.localeCompare(b.name);
      } else if (sortField === 'manager') {
        cmp = (a.manager?.fullName || '').localeCompare(b.manager?.fullName || '');
      } else if (sortField === 'delivery') {
        const timeA = a.targetEndDate ? new Date(a.targetEndDate).getTime() : 0;
        const timeB = b.targetEndDate ? new Date(b.targetEndDate).getTime() : 0;
        cmp = timeA - timeB;
      } else if (sortField === 'progress') {
        cmp = a.progressPercent - b.progressPercent;
      } else if (sortField === 'health') {
        const healthScore = (h: string) => (h === 'ROADBLOCK' ? 2 : h === 'AT_RISK' ? 1 : 0);
        cmp = healthScore(a.health) - healthScore(b.health);
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [projects, sortField, sortDir]);

  if (projects.length === 0) {
    return (
      <div className="p-4">
        <EmptyState title="No active projects" hint="Create an automation project to start tracking." />
      </div>
    );
  }

  const renderSortArrow = (field: SortField) => {
    if (sortField !== field) return <span className="text-muted/40 ml-1">⇅</span>;
    return <span className="text-ink ml-1 font-bold">{sortDir === 'asc' ? '▲' : '▼'}</span>;
  };

  return (
    <div className="overflow-x-auto">
      <table className="table w-full text-xs">
        <thead>
          <tr className="bg-surface-subtle text-muted text-left uppercase tracking-wider select-none">
            <th onClick={() => handleSort('project')} className="cursor-pointer hover:text-ink">
              Project & Client {renderSortArrow('project')}
            </th>
            <th onClick={() => handleSort('manager')} className="cursor-pointer hover:text-ink">
              Project Manager {renderSortArrow('manager')}
            </th>
            <th onClick={() => handleSort('delivery')} className="cursor-pointer hover:text-ink">
              Target Delivery {renderSortArrow('delivery')}
            </th>
            <th onClick={() => handleSort('progress')} className="w-36 cursor-pointer hover:text-ink">
              Progress {renderSortArrow('progress')}
            </th>
            <th onClick={() => handleSort('health')} className="text-right cursor-pointer hover:text-ink">
              Health {renderSortArrow('health')}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-hairline">
          {sortedProjects.map((project) => {
            const due = daysUntil(project.targetEndDate ? new Date(project.targetEndDate) : null);
            return (
              <tr key={project.id} className="hover:bg-surface-subtle/50">
                <td>
                  <Link href={`/pm/projects/${project.id}`} className="font-semibold text-ink text-sm hover:underline">
                    {project.name}
                  </Link>
                  <div className="mt-0.5 flex items-center gap-2">
                    <span className="text-caption text-muted font-medium">• {project.clientName}</span>
                    {project.priority !== 'MEDIUM' ? <PriorityBadge priority={project.priority} /> : null}
                  </div>
                </td>
                <td>
                  <span className="flex items-center gap-2 font-medium text-ink text-xs">
                    <Avatar name={formatName(project.manager.fullName)} color={project.manager.avatarColor} size={22} />
                    {formatName(project.manager.fullName)}
                  </span>
                </td>
                <td className="whitespace-nowrap">
                  {project.targetEndDate ? (
                    <div>
                      <span className="font-medium text-ink text-xs">{formatDate(project.targetEndDate)}</span>
                      {due !== null ? (
                        <span
                          className={`block text-caption font-semibold ${
                            due < 0 ? 'text-error' : due <= 7 ? 'text-amber-600' : 'text-muted-soft'
                          }`}
                        >
                          {due < 0 ? `${-due}d late` : due === 0 ? 'Due today' : `in ${due} days`}
                        </span>
                      ) : null}
                    </div>
                  ) : (
                    '-'
                  )}
                </td>
                <td>
                  <ProgressBar value={project.progressPercent} />
                  <div className="mt-1 flex items-center justify-between text-caption text-muted">
                    <span>{project.progressPercent}%</span>
                    {project.blockedCount > 0 && (
                      <span className="text-amber-600 font-medium">{project.blockedCount} roadblock</span>
                    )}
                  </div>
                </td>
                <td className="text-right">
                  <span
                    className={`badge text-xs font-semibold ${
                      project.health === 'ON_TRACK'
                        ? 'bg-success/[0.08] text-success'
                        : project.health === 'AT_RISK'
                        ? 'bg-error/[0.08] text-error'
                        : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {project.health === 'ROADBLOCK'
                      ? `${project.blockedCount} ROADBLOCK`
                      : project.health.replace('_', ' ')}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
