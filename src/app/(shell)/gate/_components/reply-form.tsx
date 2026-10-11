'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import clsx from 'clsx';
import { replyAction } from '@/app/actions/gate';

const REPLIES = [
  { value: 'COMING', label: 'Coming down', className: 'btn-primary' },
  { value: 'WAIT', label: 'Ask them to wait', className: 'btn-secondary' },
  { value: 'UNAVAILABLE', label: 'Not available', className: 'btn-secondary' },
] as const;

function ReplyButtons() {
  const { pending } = useFormStatus();
  return (
    <>
      {REPLIES.map((r) => (
        <button key={r.value} type="submit" name="reply" value={r.value} disabled={pending} className={clsx('btn btn-sm', r.className)}>
          {r.label}
        </button>
      ))}
    </>
  );
}

/** The host's answer to "your visitor is at reception". The front desk sees it at once. */
export function ReplyForm({ visitId, withNote = false }: { visitId: string; withNote?: boolean }) {
  const [state, formAction] = useActionState(replyAction, {});
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-xs">
      <input type="hidden" name="visitId" value={visitId} />
      {withNote ? (
        <input name="note" maxLength={200} aria-label="Message for the front desk (optional)" placeholder="Message for the front desk (optional)" className="input min-w-[14rem] flex-1" />
      ) : null}
      <ReplyButtons />
      {state.error ? <p role="alert" className="w-full text-caption text-error">{state.error}</p> : null}
    </form>
  );
}
