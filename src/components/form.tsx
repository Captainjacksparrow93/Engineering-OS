'use client';

import { useFormStatus } from 'react-dom';
import clsx from 'clsx';
import type { ActionState } from '@/app/actions/pm';

export function SubmitButton({
  children,
  className,
  pendingLabel,
  variant = 'primary',
  size,
  confirm,
}: {
  children: React.ReactNode;
  className?: string;
  pendingLabel?: string;
  variant?: 'primary' | 'secondary' | 'danger';
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
    return <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>;
  }
  if (state.success) {
    return <p className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{state.success}</p>;
  }
  return null;
}
