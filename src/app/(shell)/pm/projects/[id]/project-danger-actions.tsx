'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/toast';
import { ConfirmDialog } from '@/components/confirm-dialog';
import {
  cancelProjectAction,
  deleteProjectAction,
  restoreProjectAction,
} from '@/app/actions/pm';

interface ProjectDangerActionsProps {
  projectId: string;
  projectCode: string;
  projectName: string;
  status: string;
}

export function ProjectDangerActions({
  projectId,
  projectCode,
  projectName,
  status,
}: ProjectDangerActionsProps) {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();

  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const isCancelled = status === 'CANCELLED';

  const handleCancel = () => {
    startTransition(async () => {
      const res = await cancelProjectAction(projectId);
      if (!res.success) {
        toast.error(res.error || 'Failed to cancel project.');
      } else {
        toast.success(`Project "${projectName}" cancelled.`);
        setShowCancelDialog(false);
        router.refresh();
      }
    });
  };

  const handleRestore = () => {
    startTransition(async () => {
      const res = await restoreProjectAction(projectId);
      if (!res.success) {
        toast.error(res.error || 'Failed to restore project.');
      } else {
        toast.success(`Project "${projectName}" restored to Planning.`);
        router.refresh();
      }
    });
  };

  const handleDelete = () => {
    setDeleteError(null);
    startTransition(async () => {
      const res = await deleteProjectAction(projectId, projectCode);
      if (!res.success) {
        setDeleteError(res.error || 'Failed to delete project.');
        toast.error(res.error || 'Failed to delete project.');
      } else {
        toast.success(`Project "${projectName}" (${projectCode}) deleted.`);
        setShowDeleteDialog(false);
        router.push('/pm/projects');
      }
    });
  };

  return (
    <>
      <div className="flex items-center gap-2">
        {isCancelled ? (
          <button
            type="button"
            disabled={isPending}
            onClick={handleRestore}
            className="btn btn-secondary text-body-sm font-semibold flex items-center gap-1.5 text-success border-success/40 hover:bg-success/[0.08]"
          >
            <span>↺</span>
            <span>{isPending ? 'Restoring...' : 'Restore project'}</span>
          </button>
        ) : (
          <button
            type="button"
            disabled={isPending}
            onClick={() => setShowCancelDialog(true)}
            className="btn btn-secondary text-body-sm text-muted hover:text-ink flex items-center gap-1.5"
          >
            <span>✕</span>
            <span>Cancel project</span>
          </button>
        )}

        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            setDeleteError(null);
            setShowDeleteDialog(true);
          }}
          className="btn btn-secondary text-body-sm text-error border-error/30 hover:bg-error/[0.08] flex items-center gap-1.5"
          title="Director only: Permanently delete project (requires no progress logs)"
        >
          <span>🗑</span>
          <span>Delete</span>
        </button>
      </div>

      {/* Cancel Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showCancelDialog}
        title="Cancel project"
        description={`Cancel "${projectName}" (${projectCode})? All tasks, progress logs, and history will be preserved, and the project can be restored to Planning at any time.`}
        confirmLabel="Cancel Project"
        cancelLabel="Keep Project"
        tone="danger"
        isPending={isPending}
        onConfirm={handleCancel}
        onCancel={() => setShowCancelDialog(false)}
      />

      {/* Delete Type-to-Confirm Dialog */}
      <ConfirmDialog
        isOpen={showDeleteDialog}
        title="Permanently delete project"
        description={
          deleteError
            ? deleteError
            : `This will permanently erase "${projectName}" and its entire task tree. This action cannot be undone. If any progress logs exist, the delete will be refused to protect history.`
        }
        confirmMatch={projectCode}
        confirmLabel="Permanently Delete"
        cancelLabel="Keep Project"
        tone="danger"
        isPending={isPending}
        onConfirm={handleDelete}
        onCancel={() => {
          setShowDeleteDialog(false);
          setDeleteError(null);
        }}
      />
    </>
  );
}
