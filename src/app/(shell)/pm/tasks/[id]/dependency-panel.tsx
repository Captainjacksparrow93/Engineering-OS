'use client';

import Link from 'next/link';
import { StatusBadge } from '@/components/ui';

interface Edge {
  id: string;
  type: string;
  lagDays: number;
  predecessor?: { id: string; code: string; title: string; status: string };
  successor?: { id: string; code: string; title: string; status: string };
}

export function DependencyPanel({
  dependencies,
  dependents,
}: {
  taskId: string;
  canManage?: boolean;
  dependencies: Edge[];
  dependents: Edge[];
  projectTasks?: Array<{ id: string; code: string; title: string }>;
}) {
  return (
    <section className="card border-hairline">
      <header className="card-header bg-canvas-soft">
        <h2 className="card-title">Dependencies</h2>
      </header>
      <div className="card-body space-y-3">
        <div>
          <p className="label">Waiting on</p>
          {dependencies.length === 0 ? (
            <p className="text-body-sm text-muted-soft">Nothing — ready to start.</p>
          ) : (
            <ul className="space-y-1.5">
              {dependencies.map((edge) => (
                <li key={edge.id} className="flex items-center gap-2 rounded border border-hairline px-2 py-1.5">
                  <div className="min-w-0 flex-1">
                    <Link href={`/pm/tasks/${edge.predecessor!.id}`} className="block truncate text-body-sm text-ink hover:underline">
                      {edge.predecessor!.title}
                    </Link>
                  </div>
                  <StatusBadge status={edge.predecessor!.status} />
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <p className="label">Next step</p>
          {dependents.length === 0 ? (
            <p className="text-body-sm text-muted-soft">Nothing downstream.</p>
          ) : (
            <ul className="space-y-1.5">
              {dependents.map((edge) => (
                <li key={edge.id} className="flex items-center gap-2 rounded border border-hairline px-2 py-1.5">
                  <div className="min-w-0 flex-1">
                    <Link href={`/pm/tasks/${edge.successor!.id}`} className="block truncate text-body-sm text-ink hover:underline">
                      {edge.successor!.title}
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
