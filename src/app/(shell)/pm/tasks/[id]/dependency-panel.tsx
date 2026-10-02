'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { StatusBadge } from '@/components/ui';
import { addDependencyAction, removeDependencyAction } from '@/app/actions/pm';
import { useToast } from '@/components/toast';
import { cleanTaskTitle } from '@/core/utils/strings';

interface Edge {
  id: string;
  type: string;
  lagDays: number;
  predecessor?: { id: string; code: string; title: string; status: string };
  successor?: { id: string; code: string; title: string; status: string };
}

export function DependencyPanel({
  taskId,
  canManage = false,
  dependencies,
  dependents,
  projectTasks = [],
}: {
  taskId: string;
  canManage?: boolean;
  dependencies: Edge[];
  dependents: Edge[];
  projectTasks?: Array<{ id: string; code: string; title: string }>;
}) {
  const [selectedPredId, setSelectedPredId] = useState('');
  const [isPending, startTransition] = useTransition();
  const toast = useToast();

  const handleRemove = (edgeId: string) => {
    startTransition(async () => {
      const res = await removeDependencyAction(edgeId);
      if (res.success) {
        toast.success('Blocker removed successfully.');
      } else {
        toast.error(res.error ?? 'Failed to remove blocker.');
      }
    });
  };

  const handleAdd = () => {
    if (!selectedPredId) return;
    startTransition(async () => {
      const res = await addDependencyAction({
        predecessorId: selectedPredId,
        successorId: taskId,
        type: 'FINISH_TO_START',
      });
      if (res.success) {
        setSelectedPredId('');
        toast.success('Blocker added successfully.');
      } else {
        toast.error(res.error ?? 'Failed to add blocker.');
      }
    });
  };

  const existingPredIds = new Set(dependencies.map((d) => d.predecessor?.id));
  const availableTasks = projectTasks.filter((t) => t.id !== taskId && !existingPredIds.has(t.id));

  return (
    <section className="card border-hairline">
      <header className="card-header bg-canvas-soft">
        <h2 className="card-title text-body-sm font-semibold">Dependencies & Blockers</h2>
      </header>
      <div className="card-body space-y-4">
        <div>
          <p className="label mb-1.5">Waiting on (Blockers)</p>
          {dependencies.length === 0 ? (
            <p className="text-body-sm text-muted-soft">Nothing — ready to start.</p>
          ) : (
            <ul className="space-y-1.5">
              {dependencies.map((edge) => (
                <li key={edge.id} className="flex items-center justify-between gap-2 rounded border border-hairline px-2.5 py-1.5 bg-surface">
                  <div className="min-w-0 flex-1 flex items-center gap-2">
                    <Link href={`/pm/tasks/${edge.predecessor!.id}`} className="block truncate text-body-sm font-medium text-ink hover:underline">
                      {cleanTaskTitle(edge.predecessor!.title)}
                    </Link>
                    <StatusBadge status={edge.predecessor!.status} />
                  </div>
                  {canManage ? (
                    <button
                      type="button"
                      onClick={() => handleRemove(edge.id)}
                      disabled={isPending}
                      className="text-caption text-error hover:text-error/80 hover:underline px-1 py-0.5"
                      title="Remove this blocker"
                    >
                      Remove
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {canManage && availableTasks.length > 0 ? (
            <div className="mt-2.5 flex items-center gap-2">
              <select
                value={selectedPredId}
                onChange={(e) => setSelectedPredId(e.target.value)}
                disabled={isPending}
                className="select text-xs py-1 flex-1"
              >
                <option value="">+ Add blocking predecessor...</option>
                {availableTasks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {cleanTaskTitle(t.title)}
                  </option>
                ))}
              </select>
              {selectedPredId ? (
                <button
                  type="button"
                  onClick={handleAdd}
                  disabled={isPending}
                  className="btn btn-primary btn-sm text-xs py-1 px-2.5"
                >
                  Add
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="border-t border-hairline pt-3">
          <p className="label mb-1.5">Next step (Downstream)</p>
          {dependents.length === 0 ? (
            <p className="text-body-sm text-muted-soft">Nothing downstream.</p>
          ) : (
            <ul className="space-y-1.5">
              {dependents.map((edge) => (
                <li key={edge.id} className="flex items-center justify-between gap-2 rounded border border-hairline px-2.5 py-1.5 bg-surface">
                  <div className="min-w-0 flex-1">
                    <Link href={`/pm/tasks/${edge.successor!.id}`} className="block truncate text-body-sm font-medium text-ink hover:underline">
                      {cleanTaskTitle(edge.successor!.title)}
                    </Link>
                  </div>
                  <StatusBadge status={edge.successor!.status} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
