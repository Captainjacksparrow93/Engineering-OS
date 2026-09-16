'use client';

import clsx from 'clsx';

export interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'default';
  isPending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  isOpen,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default',
  isPending = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-description"
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/20 p-4 backdrop-blur-[2px] transition-all"
    >
      <div className="w-full max-w-md rounded-xl border border-hairline-strong bg-surface p-6 text-ink shadow-none">
        <h3 id="confirm-dialog-title" className="text-title-sm font-semibold text-ink">
          {title}
        </h3>
        <p id="confirm-dialog-description" className="mt-2 text-body-sm text-muted">
          {description}
        </p>

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            disabled={isPending}
            onClick={onCancel}
            className="btn btn-secondary text-body-sm px-4 py-2"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={onConfirm}
            className={clsx(
              'btn text-body-sm px-4 py-2 font-medium',
              tone === 'danger'
                ? 'bg-error text-on-primary hover:opacity-90'
                : 'btn-primary'
            )}
          >
            {isPending ? 'Processing...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
