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
        className="btn btn-secondary btn-sm"
      >
        Not Yet
      </button>
      <button
        onClick={handleComplete}
        disabled={isPending}
        className="btn btn-secondary btn-sm font-semibold flex items-center gap-1.5"
      >
        {isPending ? 'Notifying Head...' : 'Yes, Mark Project Completed'}
      </button>
    </div>
  );
}
