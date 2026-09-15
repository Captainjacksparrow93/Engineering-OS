'use client';

import { useState, useTransition } from 'react';
import { completeAutomationProjectAction } from '@/app/actions/pm';

export function CompleteProjectButton({ projectId }: { projectId: string }) {
  const [isPending, startTransition] = useTransition();
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const handleComplete = () => {
    startTransition(async () => {
      await completeAutomationProjectAction(projectId);
    });
  };

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => setDismissed(true)}
        disabled={isPending}
        className="btn btn-secondary btn-sm bg-white hover:bg-emerald-50 text-emerald-900 border-emerald-300"
      >
        Not Yet
      </button>
      <button
        onClick={handleComplete}
        disabled={isPending}
        className="btn btn-primary btn-sm bg-emerald-600 hover:bg-emerald-700 text-white font-semibold flex items-center gap-1.5 shadow-sm"
      >
        {isPending ? 'Notifying Head...' : 'Yes, Mark Project Completed'}
      </button>
    </div>
  );
}
