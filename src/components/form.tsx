'use client';

import { useFormStatus } from 'react-dom';
import clsx from 'clsx';
import type { ActionState } from '@/app/actions/pm';

/**
 * Defaults to `secondary` on purpose: Cursor Orange is reserved for the single most
 * important action on a screen, so `primary` is always an explicit choice.
 */
export function SubmitButton({
  children,
  className,
  pendingLabel,
  variant = 'secondary',
  size,
  confirm,
}: {
  children: React.ReactNode;
  className?: string;
  pendingLabel?: string;
  variant?: 'primary' | 'secondary' | 'danger' | 'ink';
  size?: 'sm';
  confirm?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      onClick={confirm ? (event) => { if (!window.confirm(confirm)) event.preventDefault(); } : undefined}
      className={clsx('btn', `btn-${variant}`, size === 'sm' && 'btn-sm', className)}
    >
      {pending ? (pendingLabel ?? 'Working…') : children}
    </button>
  );
}

/** Renders whatever the last server action returned. Errors here are domain errors. */
export function FormMessage({ state }: { state: ActionState }) {
  if (state.error) {
    return (
      <p className="mt-sm rounded-md border border-error/30 bg-error/[0.06] px-base py-sm text-body-sm text-ink">
        {state.error}
      </p>
    );
  }
  if (state.success) {
    return (
      <p className="mt-sm rounded-md border border-success/30 bg-success/[0.07] px-base py-sm text-body-sm text-ink">
        {state.success}
      </p>
    );
  }
  return null;
}
