'use client';

import { useActionState } from 'react';
import type { ActionState } from '@/core/utils/actions';
import { SubmitButton } from '@/components/form';

/** A one-click action on one row (remove a document). Errors show under it. */
export function RowButton({
  action,
  name,
  value,
  label,
  confirm,
  variant = 'secondary',
}: {
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  name: string;
  value: string;
  label: string;
  confirm?: string;
  variant?: 'secondary' | 'danger';
}) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className="inline-block">
      <input type="hidden" name={name} value={value} />
      <SubmitButton size="sm" variant={variant} confirm={confirm} className="whitespace-nowrap">{label}</SubmitButton>
      {state.error ? <p role="alert" className="mt-xxs max-w-[16rem] text-caption text-error">{state.error}</p> : null}
    </form>
  );
}
