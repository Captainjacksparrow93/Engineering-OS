'use client';

import { useActionState } from 'react';
import type { ActionState } from '@/core/utils/actions';
import { SubmitButton } from '@/components/form';

/** A one-click document action (submit, cancel, delete, remove line). Errors show under it. */
export function DocButton({
  action,
  fields,
  label,
  pendingLabel,
  variant = 'secondary',
  confirm,
}: {
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  fields: Record<string, string>;
  label: string;
  pendingLabel?: string;
  variant?: 'primary' | 'secondary' | 'danger' | 'ink';
  confirm?: string;
}) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className="inline-block">
      {Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <SubmitButton size="sm" variant={variant} pendingLabel={pendingLabel} confirm={confirm} className="whitespace-nowrap">{label}</SubmitButton>
      {state.error ? <p role="alert" className="mt-xxs max-w-[20rem] whitespace-pre-line text-caption text-error">{state.error}</p> : null}
    </form>
  );
}
