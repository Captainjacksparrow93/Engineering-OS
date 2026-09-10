import Link from 'next/link';
import clsx from 'clsx';
import { formatDate } from '@/core/utils/dates';
import { AvatarStack, ProgressBar, PriorityBadge, StatusBadge } from '@/components/ui';

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
  assignments: Array<{ user: { id: string; fullName: string; avatarColor: string } }>;
  schedule: { floatDays: number; isCritical: boolean } | null;
  _count: { children: number; dependencies: number; handovers: number };
}

/**
 * The WBS rendered as an indented table.
 *
 * Two signals are called out because they are the ones managers act on: tasks on the
 * critical path (zero float - any slip moves the delivery date) and tasks that are
 * blocked by an unmet dependency.
 */
export function WbsTable({ tasks, criticalTaskIds }: { tasks: WbsTask[]; criticalTaskIds: string[] }) {
  if (tasks.length === 0) {
    return <p className="p-4 text-sm text-slate-500">No tasks yet. Break the project down below.</p>;
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
      <table className="table min-w-[820px]">
        <thead>
          <tr>
            <th className="w-[38%]">Task</th>
            <th>Owner</th>
            <th>Planned</th>
            <th>Effort</th>
            <th className="w-32">Progress</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ task, depth }) => {
            const isPhase = task.type === 'PHASE' || task._count.children > 0;
            const overdue = task.plannedEnd && task.plannedEnd < new Date() && !['COMPLETED', 'CANCELLED'].includes(task.status);
            return (
              <tr key={task.id} className={clsx(isPhase && 'bg-slate-50/60')}>
                <td style={{ paddingLeft: 12 + depth * 18 }}>
                  <Link
                    href={`/pm/tasks/${task.id}`}
                    className={clsx('hover:text-brand-600', isPhase ? 'font-semibold text-slate-900' : 'text-slate-800')}
                  >
                    {task.title}
                  </Link>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-[11px] text-slate-400">{task.code}</span>
                    {task.type === 'ADHOC' ? <span className="badge bg-fuchsia-100 text-fuchsia-700">ad-hoc</span> : null}
                    {critical.has(task.id) && !isPhase ? (
                      <span className="badge bg-red-50 text-red-600" title="Zero float - any slip moves the delivery date">
                        critical path
                      </span>
                    ) : null}
                    {task._count.dependencies > 0 ? (
                      <span className="badge bg-slate-100 text-slate-500" title="Depends on other tasks">
                        {task._count.dependencies} dep
                      </span>
                    ) : null}
                    {task._count.handovers > 0 ? (
                      <span className="badge bg-violet-100 text-violet-700">handover</span>
                    ) : null}
                    {!isPhase ? <PriorityBadge priority={task.priority} /> : null}
                  </div>
                </td>
                <td>
                  <AvatarStack people={task.assignments.map((a) => a.user)} />
                </td>
                <td className="whitespace-nowrap text-xs">
                  <span className={overdue ? 'font-medium text-red-600' : 'text-slate-600'}>
                    {formatDate(task.plannedStart)} → {formatDate(task.plannedEnd)}
                  </span>
                  {task.schedule && task.schedule.floatDays > 0 ? (
                    <span className="block text-[11px] text-slate-400">{task.schedule.floatDays}d float</span>
                  ) : null}
                </td>
                <td className="whitespace-nowrap text-xs text-slate-600">
                  {isPhase ? '—' : `${Math.round(task.actualHours)}/${Math.round(task.estimatedHours)}h`}
                </td>
                <td>
                  <ProgressBar
                    value={task.rolledUpPercent}
                    tone={task.status === 'BLOCKED' ? 'danger' : task.status === 'COMPLETED' ? 'success' : 'default'}
                  />
                  <span className="mt-1 block text-[11px] text-slate-500">{task.rolledUpPercent}%</span>
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
