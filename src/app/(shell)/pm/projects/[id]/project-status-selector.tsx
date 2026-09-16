'use client';

import { useState, useTransition } from 'react';
import { updateProjectStatusAction } from '@/app/actions/pm';
import { StatusBadge } from '@/components/ui';

interface ProjectStatusSelectorProps {
  projectId: string;
  currentStatus: string;
  canEdit: boolean;
}

const STATUS_OPTIONS = [
  { value: 'PLANNING', label: 'Planning' },
  { value: 'IN_PROGRESS', label: 'In Progress' },
  { value: 'ON_HOLD', label: 'On Hold' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

export function ProjectStatusSelector({ projectId, currentStatus, canEdit }: ProjectStatusSelectorProps) {
  const [isPending, startTransition] = useTransition();
  const [selected, setSelected] = useState(currentStatus);
  const [error, setError] = useState<string | null>(null);

  if (!canEdit) {
    return <StatusBadge status={currentStatus} />;
  }

  const handleChange = (newStatus: string) => {
    if (newStatus === selected || isPending) return;
    setSelected(newStatus);
    setError(null);

    startTransition(async () => {
      const res = await updateProjectStatusAction(projectId, newStatus);
      if (!res.success) {
        setSelected(currentStatus);
        setError(res.error || 'Failed to update status');
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
          title="Click to change project status"
        >
          {STATUS_OPTIONS.map((opt) => (
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
