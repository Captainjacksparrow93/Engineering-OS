'use client';

import { useState, useTransition } from 'react';
import { holdProjectAction, resumeProjectAction } from '@/app/actions/pm';

interface HoldProjectButtonProps {
  projectId: string;
  projectName: string;
  status: string;
}

export function HoldProjectButton({ projectId, projectName, status }: HoldProjectButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [isOpen, setIsOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const isOnHold = status === 'ON_HOLD';

  if (status === 'COMPLETED' || status === 'CANCELLED') {
    return null;
  }

  const handleOpen = () => {
    setReason('');
    setError(null);
    setIsOpen(true);
  };

  const handleClose = () => {
    if (isPending) return;
    setIsOpen(false);
    setError(null);
  };

  const handleHold = () => {
    const trimmed = reason.trim();
    if (!trimmed) {
      setError('Please provide a reason for placing this project on hold.');
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await holdProjectAction(projectId, trimmed);
      if (!res.success) {
        setError(res.error ?? 'Failed to place project on hold.');
      } else {
        setIsOpen(false);
      }
    });
  };

  const handleResume = () => {
    setError(null);
    startTransition(async () => {
      const res = await resumeProjectAction(projectId);
      if (!res.success) {
        setError(res.error ?? 'Failed to resume project.');
      } else {
        setIsOpen(false);
      }
    });
  };

  return (
    <>
      {isOnHold ? (
        <button
          type="button"
          onClick={handleOpen}
          className="btn btn-secondary text-body-sm font-semibold flex items-center gap-1.5 border-warning/40 text-warning hover:bg-warning/[0.08]"
        >
          <span>▶</span>
          <span>Resume project</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={handleOpen}
          className="btn btn-secondary text-body-sm text-muted hover:text-ink flex items-center gap-1.5"
        >
          <span>⏸</span>
          <span>Put on hold</span>
        </button>
      )}

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-hairline bg-surface p-6 shadow-xl space-y-4">
            <div>
              <h3 className="text-body font-semibold text-ink">
                {isOnHold ? 'Resume project' : 'Put project on hold'}
              </h3>
              <p className="mt-1 text-body-sm text-muted">
                {isOnHold
                  ? `Resume "${projectName}". Its tasks will re-enter My Work and Team Load capacity with their previous progress intact.`
                  : `Placing "${projectName}" on hold will freeze all tasks and temporarily remove them from My Work and Team Load capacity.`}
              </p>
            </div>

            {error && (
              <div className="rounded-lg bg-error/10 border border-error/20 p-3 text-caption text-error">
                {error}
              </div>
            )}

            {!isOnHold && (
              <div>
                <label htmlFor="hold-reason" className="block text-caption font-semibold text-ink mb-1.5">
                  Reason for hold <span className="text-error">*</span>
                </label>
                <textarea
                  id="hold-reason"
                  rows={3}
                  value={reason}
                  onChange={(e) => {
                    setReason(e.target.value);
                    if (error) setError(null);
                  }}
                  placeholder="e.g. Awaiting client design signoff, site civil work pending, commercial hold..."
                  className="w-full rounded-lg border border-hairline bg-canvas p-2.5 text-body-sm text-ink focus:border-primary focus:outline-none"
                  disabled={isPending}
                />
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={handleClose}
                disabled={isPending}
                className="btn btn-secondary text-body-sm"
              >
                Cancel
              </button>
              {isOnHold ? (
                <button
                  type="button"
                  onClick={handleResume}
                  disabled={isPending}
                  className="btn btn-primary text-body-sm font-semibold"
                >
                  {isPending ? 'Resuming...' : 'Yes, resume project'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleHold}
                  disabled={isPending}
                  className="btn btn-primary text-body-sm font-semibold bg-warning text-ink hover:brightness-105"
                >
                  {isPending ? 'Holding...' : 'Confirm put on hold'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
