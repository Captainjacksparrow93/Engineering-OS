'use client';

import { useActionState } from 'react';
import type { ActionState } from '@/core/utils/actions';
import { SubmitButton } from '@/components/form';

/** A one-click action on one visit (check in, check out, cancel). Errors show under it. */
export function VisitButton({
  action,
  visitId,
  label,
  pendingLabel,
  variant = 'secondary',
  confirm,
}: {
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  visitId: string;
  label: string;
  pendingLabel?: string;
  variant?: 'primary' | 'secondary' | 'danger' | 'ink';
  confirm?: string;
}) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className="inline-block">
      <input type="hidden" name="visitId" value={visitId} />
      <SubmitButton size="sm" variant={variant} pendingLabel={pendingLabel} confirm={confirm} className="whitespace-nowrap">{label}</SubmitButton>
      {state.error ? <p role="alert" className="mt-xxs max-w-[16rem] text-caption text-error">{state.error}</p> : null}
    </form>
  );
}
