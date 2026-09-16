'use client';

import { useState, useActionState } from 'react';
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
    canReview?: boolean;
    canCancel?: boolean;
    canReopen?: boolean;
    canReportProblem?: boolean;
    isHolder: boolean;
  };
  assignableUsers: Array<{ id: string; fullName: string; designation: string | null }>;
}) {
  const router = useRouter();
  const [statusState, statusAction] = useActionState<ActionState, FormData>(changeTaskStatusAction, {});
  const [assignState, assignAction] = useActionState<ActionState, FormData>(assignTaskAction, {});
  const [deleteState, deleteAction] = useActionState<ActionState, FormData>(deleteTaskAction, {});

  const [showProblemForm, setShowProblemForm] = useState(false);
  const [problemNote, setProblemNote] = useState('');
  const [problemPending, setProblemPending] = useState(false);
  const [problemError, setProblemError] = useState<string | null>(null);

  const [showSendBackForm, setShowSendBackForm] = useState(false);
  const [sendBackNote, setSendBackNote] = useState('');
  const [sendBackPending, setSendBackPending] = useState(false);

  const [showMoreActions, setShowMoreActions] = useState(false);

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
      if (res.success) {
        setShowSendBackForm(false);
        setSendBackNote('');
        router.refresh();
      }
    } finally {
      setSendBackPending(false);
    }
  };

  return (
    <section className="card border-hairline">
      <header className="card-header bg-canvas-soft">
        <h2 className="card-title">Actions</h2>
      </header>
      <div className="card-body space-y-3">
        {/* Primary Next-Step Action */}
        {permissions.canStart ? (
          <form action={statusAction}>
            <input type="hidden" name="taskId" value={task.id} />
            <input type="hidden" name="status" value="IN_PROGRESS" />
            <SubmitButton className="w-full bg-ink text-canvas font-medium hover:bg-ink/90">
              Start work
            </SubmitButton>
          </form>
        ) : null}

        {permissions.canSubmit ? (
          <form action={statusAction}>
            <input type="hidden" name="taskId" value={task.id} />
            <input type="hidden" name="status" value="IN_REVIEW" />
            <SubmitButton className="w-full bg-ink text-canvas font-medium hover:bg-ink/90">
              Submit for review
            </SubmitButton>
          </form>
        ) : null}

        {permissions.canReview ? (
          <div className="space-y-2">
            <form action={async () => {
              const res = await approveTaskReviewAction(task.id);
              if (res.success) router.refresh();
            }}>
              <SubmitButton className="w-full bg-ink text-canvas font-medium hover:bg-ink/90">
                Approve
              </SubmitButton>
            </form>

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

        <FormMessage state={statusState} />

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
                  <form action={statusAction}>
                    <input type="hidden" name="taskId" value={task.id} />
                    <input type="hidden" name="status" value="IN_PROGRESS" />
                    <input type="hidden" name="note" value="Reopened by manager" />
                    <SubmitButton variant="secondary" size="sm" className="w-full">
                      Reopen task
                    </SubmitButton>
                  </form>
                ) : null}

                {permissions.canCancel ? (
                  <form action={statusAction}>
                    <input type="hidden" name="taskId" value={task.id} />
                    <input type="hidden" name="status" value="CANCELLED" />
                    <SubmitButton variant="secondary" size="sm" className="w-full text-error border-error/30 hover:bg-error/10" confirm="Cancel this task?">
                      Cancel task
                    </SubmitButton>
                  </form>
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
                  <form action={deleteAction} className="border-t border-hairline pt-3">
                    <input type="hidden" name="taskId" value={task.id} />
                    <input type="hidden" name="projectId" value={task.projectId} />
                    <SubmitButton variant="danger" size="sm" className="w-full" confirm="Delete this task permanently?">
                      Delete task
                    </SubmitButton>
                    <FormMessage state={deleteState} />
                  </form>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
