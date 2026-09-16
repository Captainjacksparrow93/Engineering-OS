import Link from 'next/link';
import clsx from 'clsx';
import { formatDate } from '@/core/utils/dates';
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

/**
 * The checklist tasks rendered as a clean, focused table.
 */
export function WbsTable({
  tasks,
  criticalTaskIds,
  projectId,
  canAssign = false,
  colleagues = [],
}: {
  tasks: WbsTask[];
  criticalTaskIds: string[];
  projectId?: string;
  canAssign?: boolean;
  colleagues?: Colleague[];
}) {
  if (tasks.length === 0) {
    return <p className="p-4 text-body-sm text-muted">No tasks yet. Break the project down below.</p>;
  }

  const critical = new Set(criticalTaskIds);
  const childrenOf = new Map<string | null, WbsTask[]>();
  for (const task of tasks) {
    const key = task.parentId ?? null;
    childrenOf.set(key, [...(childrenOf.get(key) ?? []), task]);
  }

  const rows: Array<{ task: WbsTask; depth: number }> = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const task of childrenOf.get(parentId) ?? []) {
      rows.push({ task, depth });
      walk(task.id, depth + 1);
    }
  };
  walk(null, 0);

  return (
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
          {rows.map(({ task, depth }) => {
            const isPhase = task.type === 'PHASE' || task._count.children > 0;
            const overdue = task.plannedEnd && task.plannedEnd < new Date() && !['COMPLETED', 'CANCELLED'].includes(task.status);
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
                  <span className={overdue ? 'font-medium text-error' : 'text-body'}>
                    {formatDate(task.plannedStart)} → {formatDate(task.plannedEnd)}
                  </span>
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
          })}
        </tbody>
      </table>
    </div>
  );
}

