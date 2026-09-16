'use client';

import { useState, useTransition } from 'react';
import { updateProjectPriorityAction } from '@/app/actions/pm';
import { PriorityBadge } from '@/components/ui';

interface ProjectPrioritySelectorProps {
  projectId: string;
  currentPriority: string;
  canEdit: boolean;
}

const PRIORITY_OPTIONS = [
  { value: 'LOW', label: 'Low' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'HIGH', label: 'High' },
  { value: 'CRITICAL', label: 'Critical' },
];

export function ProjectPrioritySelector({
  projectId,
  currentPriority,
  canEdit,
}: ProjectPrioritySelectorProps) {
  const [isPending, startTransition] = useTransition();
  const [selected, setSelected] = useState(currentPriority);
  const [error, setError] = useState<string | null>(null);

  if (!canEdit) {
    return <PriorityBadge priority={currentPriority} />;
  }

  const handleChange = (newPriority: string) => {
    if (newPriority === selected || isPending) return;
    setSelected(newPriority);
    setError(null);

    startTransition(async () => {
      const res = await updateProjectPriorityAction(projectId, newPriority);
      if (!res.success) {
        setSelected(currentPriority);
        setError(res.error || 'Failed to update priority');
      }
    });
  };

  return (
    <div className="inline-flex items-center gap-1.5">
      <div className="relative inline-flex items-center">
        <select
          value={selected}
          disabled={isPending}
          onChange={(e) => handleChange(e.target.value)}
          className="cursor-pointer appearance-none rounded-pill border border-hairline bg-surface-strong pl-2.5 pr-6 py-0.5 text-caption font-semibold text-ink transition-colors hover:border-hairline-strong focus:outline-none focus:ring-1 focus:ring-ink disabled:opacity-60"
          title="Click to change project priority"
        >
          {PRIORITY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <span className="pointer-events-none absolute right-2 text-[9px] text-muted">▼</span>
      </div>
      {isPending ? (
        <span className="text-[11px] text-muted animate-pulse">updating...</span>
      ) : null}
      {error ? (
        <span className="text-caption text-error font-medium" title={error}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
