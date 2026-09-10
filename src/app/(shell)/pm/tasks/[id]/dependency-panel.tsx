'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { addDependencyAction, removeDependencyAction, type ActionState } from '@/app/actions/pm';
import { FormMessage, SubmitButton } from '@/components/form';
import { StatusBadge } from '@/components/ui';

interface Edge {
  id: string;
  type: string;
  lagDays: number;
  predecessor?: { id: string; code: string; title: string; status: string };
  successor?: { id: string; code: string; title: string; status: string };
}

const TYPE_LABEL: Record<string, string> = {
  FINISH_TO_START: 'finish → start',
  START_TO_START: 'start → start',
  FINISH_TO_FINISH: 'finish → finish',
  START_TO_FINISH: 'start → finish',
};

export function DependencyPanel({
  taskId,
  canManage,
  dependencies,
  dependents,
  projectTasks,
}: {
  taskId: string;
  canManage: boolean;
  dependencies: Edge[];
  dependents: Edge[];
  projectTasks: Array<{ id: string; code: string; title: string }>;
}) {
  const [addState, addAction] = useActionState<ActionState, FormData>(addDependencyAction, {});
  const [removeState, removeAction] = useActionState<ActionState, FormData>(removeDependencyAction, {});
  const [adding, setAdding] = useState(false);

  return (
    <section className="card">
      <header className="card-header">
        <h2 className="card-title">Dependencies</h2>
        {canManage ? (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAdding((v) => !v)}>
            {adding ? 'Cancel' : 'Add'}
          </button>
        ) : null}
      </header>
      <div className="card-body space-y-3">
        <div>
          <p className="label">This task waits on</p>
          {dependencies.length === 0 ? (
            <p className="text-sm text-slate-400">Nothing — it can start as soon as it is scheduled.</p>
          ) : (
            <ul className="space-y-1.5">
              {dependencies.map((edge) => (
                <li key={edge.id} className="flex items-center gap-2 rounded border border-surface-border px-2 py-1.5">
                  <div className="min-w-0 flex-1">
                    <Link href={`/pm/tasks/${edge.predecessor!.id}`} className="block truncate text-sm text-slate-800 hover:text-brand-600">
                      {edge.predecessor!.title}
                    </Link>
                    <span className="text-[11px] text-slate-400">
                      {edge.predecessor!.code} · {TYPE_LABEL[edge.type]}
                      {edge.lagDays !== 0 ? ` · ${edge.lagDays > 0 ? '+' : ''}${edge.lagDays}d` : ''}
                    </span>
                  </div>
                  <StatusBadge status={edge.predecessor!.status} />
                  {canManage ? (
                    <form action={removeAction}>
                      <input type="hidden" name="dependencyId" value={edge.id} />
                      <input type="hidden" name="taskId" value={taskId} />
                      <SubmitButton variant="secondary" size="sm">✕</SubmitButton>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <p className="label">Waiting on this task</p>
          {dependents.length === 0 ? (
            <p className="text-sm text-slate-400">Nothing downstream.</p>
          ) : (
            <ul className="space-y-1">
              {dependents.map((edge) => (
                <li key={edge.id} className="flex items-center gap-2 text-sm">
                  <Link href={`/pm/tasks/${edge.successor!.id}`} className="min-w-0 flex-1 truncate text-slate-700 hover:text-brand-600">
                    {edge.successor!.title}
                  </Link>
                  <StatusBadge status={edge.successor!.status} />
                </li>
              ))}
            </ul>
          )}
        </div>

        <FormMessage state={removeState} />

        {adding ? (
          <form action={addAction} className="border-t border-surface-border pt-3">
            <input type="hidden" name="successorId" value={taskId} />
            <div className="field">
              <label className="label" htmlFor="predecessorId">Must happen before this task</label>
              <select id="predecessorId" name="predecessorId" required className="select" defaultValue="">
                <option value="" disabled>Select a task</option>
                {projectTasks.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.code} — {task.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="field">
                <label className="label" htmlFor="type">Relationship</label>
                <select id="type" name="type" className="select" defaultValue="FINISH_TO_START">
                  {Object.entries(TYPE_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label className="label" htmlFor="lagDays">Lag (days)</label>
                <input id="lagDays" name="lagDays" type="number" defaultValue={0} className="input" />
              </div>
            </div>
            <FormMessage state={addState} />
            <div className="mt-2">
              <SubmitButton size="sm" className="w-full">Add dependency</SubmitButton>
            </div>
          </form>
        ) : null}
      </div>
    </section>
  );
}
