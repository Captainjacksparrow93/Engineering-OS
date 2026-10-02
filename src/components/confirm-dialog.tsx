'use client';

import { useState } from 'react';
import clsx from 'clsx';

export interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'default';
  isPending?: boolean;
  confirmMatch?: string;
  confirmInputPlaceholder?: string;
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
  confirmMatch,
  confirmInputPlaceholder,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [inputVal, setInputVal] = useState('');

  if (!isOpen) return null;

  const matchRequired = typeof confirmMatch === 'string' && confirmMatch.length > 0;
  const isMatchValid = !matchRequired || inputVal.trim() === confirmMatch.trim();

  const handleCancel = () => {
    setInputVal('');
    onCancel();
  };

  const handleConfirm = () => {
    if (!isMatchValid) return;
    onConfirm();
  };

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

        {matchRequired && (
          <div className="mt-4 space-y-1.5">
            <label className="text-caption text-muted block">
              Type <strong className="font-mono text-ink select-all">{confirmMatch}</strong> to confirm:
            </label>
            <input
              type="text"
              autoFocus
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
              placeholder={confirmInputPlaceholder ?? confirmMatch}
              className="input text-body-sm w-full font-mono"
              disabled={isPending}
            />
          </div>
        )}

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            disabled={isPending}
            onClick={handleCancel}
            className="btn btn-secondary text-body-sm px-4 py-2"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={isPending || !isMatchValid}
            onClick={handleConfirm}
            className={clsx(
              'btn text-body-sm px-4 py-2 font-medium',
              tone === 'danger'
                ? 'bg-error text-on-primary hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed'
                : 'btn-primary disabled:opacity-50 disabled:cursor-not-allowed'
            )}
          >
            {isPending ? 'Processing...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
