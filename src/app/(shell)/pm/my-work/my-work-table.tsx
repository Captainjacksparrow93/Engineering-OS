'use client';

import { useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { formatDate, formatRelativeDate } from '@/core/utils/dates';
import { PriorityBadge, ProgressBar, StatusBadge } from '@/components/ui';
import { cleanTaskTitle } from '@/core/utils/strings';
import { changeTaskStatusAction } from '@/app/actions/pm';
import { useToast } from '@/components/toast';

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
    parent?: { id: string; code: string; title: string } | null;
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

export function MyWorkTable({ rows }: { rows: MyWorkRow[] }) {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();

  const handleQuickStatus = (taskId: string, newStatus: 'IN_PROGRESS' | 'IN_REVIEW', title: string) => {
    startTransition(async () => {
      const formData = new FormData();
      formData.set('taskId', taskId);
      formData.set('status', newStatus);
      const res = await changeTaskStatusAction({}, formData);
      if (res?.error) {
        toast.error(res.error);
      } else {
        if (newStatus === 'IN_PROGRESS') {
          toast.success(`Started work on ${cleanTaskTitle(title)}`);
        } else {
          toast.success(`Submitted ${cleanTaskTitle(title)} for review`);
        }
      }
      router.refresh();
    });
  };

  // Group rows into: To do now, Waiting, Completed / Later
  const isCompletedView = rows.length > 0 && rows.every((r) => r.task.status === 'COMPLETED');

  const todoNow: MyWorkRow[] = [];
  const waiting: MyWorkRow[] = [];
  const completedOrLater: MyWorkRow[] = [];

  for (const r of rows) {
    if (r.task.status === 'COMPLETED') {
      completedOrLater.push(r);
    } else if (r.task.status === 'IN_PROGRESS' || (r.task.status === 'TODO' && r.unmetDependencies.length === 0)) {
      todoNow.push(r);
    } else if (r.task.status === 'BLOCKED' || r.task.status === 'IN_REVIEW' || (r.task.status === 'TODO' && r.unmetDependencies.length > 0)) {
      waiting.push(r);
    } else {
      completedOrLater.push(r);
    }
  }

  const renderSection = (title: string, items: MyWorkRow[], emptyMsg: string) => {
    if (items.length === 0) return null;

    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between px-4 pt-3">
          <h3 className="text-caption font-semibold uppercase tracking-wider text-muted-soft">
            {title} ({items.length})
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="table min-w-[860px]">
            <thead>
              <tr className="select-none text-caption text-muted">
                <th className="w-[38%]">Task & Unit</th>
                <th>Project</th>
                <th>Due</th>
                <th className="w-28">Progress</th>
                <th>Status</th>
                <th className="text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {items.map(({ task, assignment, unmetDependencies }) => {
                const relative = formatRelativeDate(task.plannedEnd);
                const isOverdue = relative.includes('late') && task.status !== 'COMPLETED';
                const parentTitle = task.parent?.title ? cleanTaskTitle(task.parent.title) : null;
                const isBlocked = task.status === 'BLOCKED' || (task.status === 'TODO' && unmetDependencies.length > 0);
                const effectiveStatus = isBlocked ? 'BLOCKED' : task.status;

                return (
                  <tr key={assignment.id} className="hover:bg-canvas-soft/60 transition-colors">
                    <td>
                      <Link href={`/pm/tasks/${task.id}`} className="font-medium text-ink hover:underline">
                        {cleanTaskTitle(task.title)}
                      </Link>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                        {parentTitle ? (
                          <span className="text-caption text-muted font-normal">
                            {parentTitle}
                          </span>
                        ) : null}
                        {task.priority !== 'MEDIUM' ? <PriorityBadge priority={task.priority} /> : null}
                        {task.type === 'ADHOC' ? <span className="badge bg-surface-strong text-ink">ad-hoc</span> : null}
                      </div>
                    </td>
                    <td className="text-caption text-muted">
                      <Link href={`/pm/projects/${task.project.id}`} className="hover:text-ink font-medium">
                        {task.project.name}
                      </Link>
                      <span className="block text-caption text-muted-soft">{task.project.clientName}</span>
                    </td>
                    <td className="whitespace-nowrap text-caption">
                      {task.plannedEnd ? (
                        <>
                          <span className={isOverdue ? 'font-semibold text-error' : 'text-body'}>
                            {formatDate(task.plannedEnd)}
                          </span>
                          <span className="block text-caption text-muted-soft">
                            {relative}
                          </span>
                        </>
                      ) : (
                        <span className="text-muted-soft">—</span>
                      )}
                    </td>
                    <td>
                      <ProgressBar value={task.percentComplete} tone={isBlocked ? 'danger' : undefined} />
                      <span className="mt-0.5 block text-caption text-muted">{task.percentComplete}%</span>
                    </td>
                    <td>
                      <StatusBadge status={effectiveStatus} />
                    </td>
                    <td className="text-right whitespace-nowrap">
                      {task.status === 'TODO' && unmetDependencies.length === 0 ? (
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() => handleQuickStatus(task.id, 'IN_PROGRESS', task.title)}
                          className="btn btn-primary btn-sm py-1 px-2.5 text-xs"
                        >
                          Start
                        </button>
                      ) : task.status === 'IN_PROGRESS' ? (
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() => handleQuickStatus(task.id, 'IN_REVIEW', task.title)}
                          className="btn btn-secondary btn-sm py-1 px-2.5 text-xs font-medium"
                        >
                          Submit
                        </button>
                      ) : (
                        <Link href={`/pm/tasks/${task.id}`} className="text-xs text-muted hover:text-ink font-medium">
                          View →
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  if (isCompletedView) {
    return renderSection('Completed Deliverables', completedOrLater, 'No completed deliverables.');
  }

  return (
    <div className="divide-y divide-hairline">
      {renderSection('To do now', todoNow, 'No tasks ready right now.')}
      {renderSection('Waiting', waiting, 'No blocked or review tasks.')}
      {renderSection('Later', completedOrLater, 'No upcoming tasks.')}
    </div>
  );
}
