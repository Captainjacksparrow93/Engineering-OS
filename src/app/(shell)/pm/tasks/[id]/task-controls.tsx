'use client';

import { useState, useActionState, useTransition } from 'react';
import {
  assignTaskAction,
  changeTaskStatusAction,
  deleteTaskAction,
  flagRoadblockAction,
  approveTaskReviewAction,
  disapproveTaskReviewAction,
  type ActionState,
} from '@/app/actions/pm';
import { FormMessage, SubmitButton } from '@/components/form';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { useToast } from '@/components/toast';
import { formatName } from '@/core/utils/strings';
import { useRouter } from 'next/navigation';

export function TaskControls({
  task,
  permissions,
  assignableUsers,
}: {
  task: { id: string; status: string; projectId: string };
  permissions: {
    canEdit: boolean;
    canAssign: boolean;
    canDelete: boolean;
    canStart?: boolean;
    canSubmit?: boolean;
    canMarkCompleted?: boolean;
    canReview?: boolean;
    canCancel?: boolean;
    canReopen?: boolean;
    canReportProblem?: boolean;
    isHolder: boolean;
  };
  assignableUsers: Array<{ id: string; fullName: string; designation: string | null }>;
}) {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();

  const [assignState, assignAction] = useActionState<ActionState, FormData>(assignTaskAction, {});

  const [showProblemForm, setShowProblemForm] = useState(false);
  const [problemNote, setProblemNote] = useState('');
  const [problemPending, setProblemPending] = useState(false);
  const [problemError, setProblemError] = useState<string | null>(null);

  const [showSendBackForm, setShowSendBackForm] = useState(false);
  const [sendBackNote, setSendBackNote] = useState('');
  const [sendBackPending, setSendBackPending] = useState(false);

  const [showMoreActions, setShowMoreActions] = useState(false);

  // Confirmation dialogs state
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [confirmReopenOpen, setConfirmReopenOpen] = useState(false);

  const handleStartWork = () => {
    startTransition(async () => {
      const formData = new FormData();
      formData.set('taskId', task.id);
      formData.set('status', 'IN_PROGRESS');
      const res = await changeTaskStatusAction({}, formData);
      if (res?.error) {
        toast.error(res.error);
      } else {
        toast.success('Started work on this task');
        router.refresh();
      }
    });
  };

  const handleMarkCompleted = () => {
    startTransition(async () => {
      const formData = new FormData();
      formData.set('taskId', task.id);
      formData.set('status', 'IN_REVIEW');
      const res = await changeTaskStatusAction({}, formData);
      if (res?.error) {
        toast.error(res.error);
      } else {
        toast.success('Marked as completed — waiting for approval');
        router.refresh();
      }
    });
  };

  const handleApprove = () => {
    startTransition(async () => {
      const res = await approveTaskReviewAction(task.id);
      if (!res.success) {
        toast.error(res.error || 'Failed to approve task');
      } else {
        toast.success('Approved — next step unlocked');
        router.refresh();
      }
    });
  };

  const handleReportProblem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!problemNote.trim()) return;
    setProblemPending(true);
    setProblemError(null);
    try {
      const res = await flagRoadblockAction(task.id, problemNote.trim());
      if (!res.success) {
        setProblemError(res.error || 'Failed to report problem.');
      } else {
        setShowProblemForm(false);
        setProblemNote('');
        toast.success('Problem reported to project manager');
        router.refresh();
      }
    } catch {
      setProblemError('Failed to report problem.');
    } finally {
      setProblemPending(false);
    }
  };

  const handleSendBack = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sendBackNote.trim()) return;
    setSendBackPending(true);
    try {
      const res = await disapproveTaskReviewAction(task.id, sendBackNote.trim());
      if (!res.success) {
        toast.error(res.error || 'Failed to send back task');
      } else {
        setShowSendBackForm(false);
        setSendBackNote('');
        toast.success('Sent back for rework');
        router.refresh();
      }
    } finally {
      setSendBackPending(false);
    }
  };

  const handleReopen = () => {
    startTransition(async () => {
      const formData = new FormData();
      formData.set('taskId', task.id);
      formData.set('status', 'IN_PROGRESS');
      formData.set('note', 'Reopened by manager');
      const res = await changeTaskStatusAction({}, formData);
      if (res?.error) {
        toast.error(res.error);
      } else {
        toast.success('Task reopened and placed back in progress');
        setConfirmReopenOpen(false);
        router.refresh();
      }
    });
  };

  const handleCancelTask = () => {
    startTransition(async () => {
      const formData = new FormData();
      formData.set('taskId', task.id);
      formData.set('status', 'CANCELLED');
      const res = await changeTaskStatusAction({}, formData);
      if (res?.error) {
        toast.error(res.error);
      } else {
        toast.success('Task cancelled');
        setConfirmCancelOpen(false);
        router.refresh();
      }
    });
  };

  const handleDeleteTask = () => {
    startTransition(async () => {
      const formData = new FormData();
      formData.set('taskId', task.id);
      formData.set('projectId', task.projectId);
      const res = await deleteTaskAction({}, formData);
      if (res?.error) {
        toast.error(res.error);
      } else {
        toast.success('Task deleted permanently');
        setConfirmDeleteOpen(false);
        router.push(`/pm/projects/${task.projectId}`);
      }
    });
  };

  const canMarkComplete = permissions.canMarkCompleted || permissions.canSubmit;

  return (
    <>
      <section className="card border-hairline">
        <header className="card-header bg-canvas-soft">
          <h2 className="card-title">Actions</h2>
        </header>
        <div className="card-body space-y-3">
          {/* Primary Next-Step Action */}
          {permissions.canStart ? (
            <button
              type="button"
              disabled={isPending}
              onClick={handleStartWork}
              className="btn btn-primary w-full bg-ink text-canvas font-medium hover:bg-ink/90"
            >
              {isPending ? 'Starting…' : 'Start work'}
            </button>
          ) : null}

          {canMarkComplete ? (
            <button
              type="button"
              disabled={isPending}
              onClick={handleMarkCompleted}
              className="btn btn-primary w-full bg-ink text-canvas font-medium hover:bg-ink/90"
            >
              {isPending ? 'Submitting…' : 'Mark as completed'}
            </button>
          ) : null}

          {permissions.canReview ? (
            <div className="space-y-2">
              <button
                type="button"
                disabled={isPending}
                onClick={handleApprove}
                className="btn btn-primary w-full bg-ink text-canvas font-medium hover:bg-ink/90"
              >
                {isPending ? 'Approving…' : 'Approve'}
              </button>

              {!showSendBackForm ? (
                <button
                  type="button"
                  onClick={() => setShowSendBackForm(true)}
                  className="btn btn-secondary btn-sm w-full"
                >
                  Send back
                </button>
              ) : (
                <form onSubmit={handleSendBack} className="p-3 bg-surface-strong/40 rounded-lg border border-hairline space-y-2">
                  <label className="label text-caption">Reason for rework *</label>
                  <textarea
                    rows={2}
                    required
                    value={sendBackNote}
                    onChange={(e) => setSendBackNote(e.target.value)}
                    placeholder="Explain what needs to be fixed..."
                    className="textarea text-xs w-full"
                  />
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={sendBackPending || !sendBackNote.trim()}
                      className="btn btn-primary btn-sm flex-1"
                    >
                      {sendBackPending ? 'Sending…' : 'Send back'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowSendBackForm(false)}
                      className="btn btn-secondary btn-sm"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </div>
          ) : null}

          {/* Problem Reporting */}
          {permissions.canReportProblem ? (
            <div>
              {!showProblemForm ? (
                <button
                  type="button"
                  onClick={() => setShowProblemForm(true)}
                  className="btn btn-secondary btn-sm w-full text-error border-error/30 hover:bg-error/[0.04]"
                >
                  Report a problem
                </button>
              ) : (
                <form onSubmit={handleReportProblem} className="p-3 rounded-lg border border-error/30 bg-error/[0.04] space-y-2">
                  <p className="text-caption font-semibold text-error">Report a problem</p>
                  <textarea
                    required
                    rows={2}
                    value={problemNote}
                    onChange={(e) => setProblemNote(e.target.value)}
                    placeholder="What is blocking this task? (e.g. Awaiting client drawing signoff)"
                    className="textarea text-xs w-full bg-surface border-error/30 focus:border-error"
                  />
                  {problemError ? <p className="text-caption text-error">{problemError}</p> : null}
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={problemPending || !problemNote.trim()}
                      className="btn btn-sm flex-1 bg-error text-white hover:opacity-90"
                    >
                      {problemPending ? 'Reporting…' : 'Submit problem'}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setShowProblemForm(false); setProblemError(null); }}
                      className="btn btn-secondary btn-sm"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </div>
          ) : null}

          {/* More Options Section */}
          {(permissions.canAssign || permissions.canCancel || permissions.canReopen || permissions.canDelete) ? (
            <div className="border-t border-hairline pt-3">
              <button
                type="button"
                onClick={() => setShowMoreActions(!showMoreActions)}
                className="flex items-center justify-between w-full text-caption font-semibold uppercase tracking-wider text-muted-soft hover:text-ink"
              >
                <span>More actions</span>
                <span>{showMoreActions ? '−' : '+'}</span>
              </button>

              {showMoreActions ? (
                <div className="mt-3 space-y-3">
                  {permissions.canReopen ? (
                    <button
                      type="button"
                      onClick={() => setConfirmReopenOpen(true)}
                      className="btn btn-secondary btn-sm w-full"
                    >
                      Reopen task
                    </button>
                  ) : null}

                  {permissions.canCancel ? (
                    <button
                      type="button"
                      onClick={() => setConfirmCancelOpen(true)}
                      className="btn btn-secondary btn-sm w-full text-error border-error/30 hover:bg-error/10"
                    >
                      Cancel task
                    </button>
                  ) : null}

                  {permissions.canAssign && assignableUsers.length > 0 ? (
                    <form action={assignAction} className="border-t border-hairline pt-3">
                      <p className="mb-2 text-caption font-semibold text-muted">Reassign</p>
                      <input type="hidden" name="taskId" value={task.id} />
                      <div className="field">
                        <select name="userId" required className="select w-full text-xs" defaultValue="">
                          <option value="" disabled>Select colleague</option>
                          {assignableUsers.map((user) => (
                            <option key={user.id} value={user.id}>
                              {formatName(user.fullName)} {user.designation ? `(${user.designation})` : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                      <FormMessage state={assignState} />
                      <div className="mt-2">
                        <SubmitButton size="sm" variant="secondary" className="w-full">Reassign</SubmitButton>
                      </div>
                    </form>
                  ) : null}

                  {permissions.canDelete ? (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteOpen(true)}
                      className="btn btn-sm w-full bg-error text-white hover:opacity-90"
                    >
                      Delete task
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>

      {/* Confirmation Dialogs */}
      <ConfirmDialog
        isOpen={confirmCancelOpen}
        title="Cancel this task?"
        description="Cancelling this task will halt work on it and unblock any dependent tasks that were waiting on its completion."
        confirmLabel="Cancel task"
        tone="danger"
        isPending={isPending}
        onConfirm={handleCancelTask}
        onCancel={() => setConfirmCancelOpen(false)}
      />

      <ConfirmDialog
        isOpen={confirmDeleteOpen}
        title="Delete this task permanently?"
        description="This action cannot be undone. All logs, assignments, and dependencies associated with this task will be permanently removed."
        confirmLabel="Delete permanently"
        tone="danger"
        isPending={isPending}
        onConfirm={handleDeleteTask}
        onCancel={() => setConfirmDeleteOpen(false)}
      />

      <ConfirmDialog
        isOpen={confirmReopenOpen}
        title="Reopen task?"
        description="This will clear the previous completion date and move the task back to in-progress status."
        confirmLabel="Reopen task"
        tone="default"
        isPending={isPending}
        onConfirm={handleReopen}
        onCancel={() => setConfirmReopenOpen(false)}
      />
    </>
  );
}
