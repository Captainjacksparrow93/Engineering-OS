'use client';

import { useState, useTransition } from 'react';
import { assignTaskAction } from '@/app/actions/pm';
import { formatName } from '@/core/utils/strings';

interface Colleague {
  id: string;
  fullName: string;
  designation?: string | null;
  avatarColor?: string | null;
}

export function AssigneeCell({
  taskId,
  projectId,
  assignees,
  canAssign,
  colleagues,
}: {
  taskId: string;
  projectId?: string;
  assignees: Array<{ id: string; fullName: string; avatarColor?: string | null }>;
  canAssign: boolean;
  colleagues?: Colleague[];
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState(assignees[0]?.id ?? '');
  const [isPending, startTransition] = useTransition();

  if (!canAssign || !colleagues || colleagues.length === 0) {
    return (
      <span className="text-body-sm font-medium text-ink">
        {assignees[0] ? formatName(assignees[0].fullName) : <span className="text-muted font-normal">Unassigned</span>}
      </span>
    );
  }

  if (!isEditing) {
    return (
      <button
        type="button"
        onClick={() => setIsEditing(true)}
        className="group flex items-center gap-1.5 rounded p-1 -m-1 transition-colors hover:bg-canvas-soft text-left"
        title="Click to assign or reassign"
      >
        <span className="text-body-sm font-medium text-ink">
          {assignees[0] ? formatName(assignees[0].fullName) : <span className="text-muted font-normal">Unassigned</span>}
        </span>
        <span className="opacity-0 group-hover:opacity-100 text-xs text-muted transition-opacity">
          ✎
        </span>
      </button>
    );
  }

  const handleSave = () => {
    if (!selectedUserId) {
      setIsEditing(false);
      return;
    }

    startTransition(async () => {
      const formData = new FormData();
      formData.set('taskId', taskId);
      if (projectId) formData.set('projectId', projectId);
      formData.set('userId', selectedUserId);
      formData.set('role', 'OWNER');

      await assignTaskAction({}, formData);
      setIsEditing(false);
    });
  };

  return (
    <div className="flex items-center gap-1.5 min-w-[180px]">
      <select
        value={selectedUserId}
        onChange={(e) => setSelectedUserId(e.target.value)}
        disabled={isPending}
        className="select select-sm py-0.5 px-2 text-xs border border-hairline rounded bg-surface text-ink flex-1"
        autoFocus
      >
        <option value="" disabled>Select engineer</option>
        {colleagues.map((c) => (
          <option key={c.id} value={c.id}>
            {formatName(c.fullName)} {c.designation ? `(${c.designation})` : ''}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={handleSave}
        disabled={isPending || !selectedUserId}
        className="btn btn-primary btn-sm py-0.5 px-2 text-xs"
        title="Save assignment"
      >
        {isPending ? '...' : '✓'}
      </button>
      <button
        type="button"
        onClick={() => setIsEditing(false)}
        disabled={isPending}
        className="btn btn-secondary btn-sm py-0.5 px-2 text-xs text-muted"
        title="Cancel"
      >
        ✕
      </button>
    </div>
  );
}
