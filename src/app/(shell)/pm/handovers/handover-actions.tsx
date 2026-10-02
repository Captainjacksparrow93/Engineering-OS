'use client';

import { useActionState, useState } from 'react';
import {
  cancelHandoverAction,
  cancelProjectHandoverAction,
  decideHandoverAction,
  decideProjectHandoverAction,
  type ActionState,
} from '@/app/actions/pm';
import { FormMessage, SubmitButton } from '@/components/form';

export function HandoverDecision({ handoverId }: { handoverId: string }) {
  const [state, action] = useActionState<ActionState, FormData>(decideHandoverAction, {});
  const [showNote, setShowNote] = useState(false);
  const [note, setNote] = useState('');

  return (
    <div className="space-y-2">
      {showNote ? (
        <input
          className="input text-body-sm w-full"
          placeholder="Optional reason / remarks..."
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      ) : null}
      <div className="flex gap-2">
        <form action={action} className="flex-1">
          <input type="hidden" name="handoverId" value={handoverId} />
          <input type="hidden" name="decision" value="ACCEPTED" />
          <input type="hidden" name="note" value={note} />
          <SubmitButton variant="ink" className="w-full" size="sm">
            Accept
          </SubmitButton>
        </form>
        <form action={action} className="flex-1">
          <input type="hidden" name="handoverId" value={handoverId} />
          <input type="hidden" name="decision" value="DECLINED" />
          <input type="hidden" name="note" value={note} />
          <SubmitButton className="w-full" size="sm" variant="danger">
            Decline
          </SubmitButton>
        </form>
      </div>
      {!showNote ? (
        <button
          type="button"
          onClick={() => setShowNote(true)}
          className="text-caption text-muted hover:text-ink underline block"
        >
          Add note
        </button>
      ) : null}
      <FormMessage state={state} />
    </div>
  );
}

export function HandoverWithdraw({ handoverId }: { handoverId: string }) {
  const [state, action] = useActionState<ActionState, FormData>(cancelHandoverAction, {});
  return (
    <form action={action}>
      <input type="hidden" name="handoverId" value={handoverId} />
      <SubmitButton variant="secondary" size="sm" confirm="Withdraw this reassign request?">
        Withdraw
      </SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

export function ProjectHandoverDecision({ handoverId }: { handoverId: string }) {
  const [state, action] = useActionState<ActionState, FormData>(decideProjectHandoverAction, {});
  const [note, setNote] = useState('');

  return (
    <div className="space-y-2">
      <input
        className="input text-body-sm w-full"
        placeholder="Optional handover remarks"
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
      <div className="flex gap-2">
        <form action={action} className="flex-1">
          <input type="hidden" name="handoverId" value={handoverId} />
          <input type="hidden" name="decision" value="ACCEPTED" />
          <input type="hidden" name="note" value={note} />
          <SubmitButton variant="ink" className="w-full" size="sm">
            Accept & Become PM
          </SubmitButton>
        </form>
        <form action={action} className="flex-1">
          <input type="hidden" name="handoverId" value={handoverId} />
          <input type="hidden" name="decision" value="DECLINED" />
          <input type="hidden" name="note" value={note} />
          <SubmitButton className="w-full" size="sm" variant="danger">
            Decline
          </SubmitButton>
        </form>
      </div>
      <FormMessage state={state} />
    </div>
  );
}

export function ProjectHandoverWithdraw({ handoverId }: { handoverId: string }) {
  const [state, action] = useActionState<ActionState, FormData>(cancelProjectHandoverAction, {});
  return (
    <form action={action}>
      <input type="hidden" name="handoverId" value={handoverId} />
      <SubmitButton variant="secondary" size="sm" confirm="Withdraw this project handover request?">
        Withdraw
      </SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}
