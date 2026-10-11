'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import type { ActionState } from '@/core/utils/actions';
import { ActionMessage } from '@/components/action-form';

function Buttons() {
  const { pending } = useFormStatus();
  return (
    <div className="flex flex-wrap gap-xs">
      <button type="submit" name="decision" value="APPROVE" disabled={pending} className="btn btn-primary btn-sm">Approve</button>
      <button type="submit" name="decision" value="REJECT" disabled={pending} className="btn btn-secondary btn-sm">Reject</button>
    </div>
  );
}

/** Approve or reject one request, with an optional note the employee sees. */
export function DecisionForm({ action, id }: { action: (prev: ActionState, form: FormData) => Promise<ActionState>; id: string }) {
  const [state, formAction] = useActionState(action, {});
  if (state.success) return <p className="text-body-sm text-muted">{state.success}</p>;
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-xs">
      <input type="hidden" name="id" value={id} />
      <input name="note" maxLength={300} placeholder="Note (optional)" aria-label="Note for the employee" className="input min-w-[10rem] flex-1" />
      <Buttons />
      <div className="w-full"><ActionMessage state={state} quiet /></div>
    </form>
  );
}
