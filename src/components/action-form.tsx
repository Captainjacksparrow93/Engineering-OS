'use client';

import { useActionState, useEffect, useRef } from 'react';
import clsx from 'clsx';
import type { ActionState } from '@/core/utils/actions';

/**
 * A form bound to a server action, with its result shown underneath. Multi-line
 * errors (import row lists) keep their line breaks.
 */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess = false,
  quiet = false,
}: {
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  children: React.ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  /** Hide the success message (for one-click buttons whose effect is visible). */
  quiet?: boolean;
}) {
  const [state, formAction] = useActionState(action, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.success && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form ref={ref} action={formAction} className={className}>
      {children}
      <ActionMessage state={state} quiet={quiet} />
    </form>
  );
}

export function ActionMessage({ state, quiet = false }: { state: ActionState; quiet?: boolean }) {
  if (state.error) {
    return <p role="alert" className="mt-sm whitespace-pre-line rounded-md border border-error/30 bg-error/[0.06] px-base py-sm text-body-sm text-ink">{state.error}</p>;
  }
  if (state.success && !quiet) {
    return <p className={clsx('mt-sm rounded-md border border-success/30 bg-success/[0.07] px-base py-sm text-body-sm text-ink')}>{state.success}</p>;
  }
  return null;
}
