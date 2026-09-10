'use client';

import { useActionState, useState } from 'react';
import { cancelHandoverAction, decideHandoverAction, type ActionState } from '@/app/actions/pm';
import { FormMessage, SubmitButton } from '@/components/form';

export function HandoverDecision({ handoverId, asManager }: { handoverId: string; asManager?: boolean }) {
  const [state, action] = useActionState<ActionState, FormData>(decideHandoverAction, {});
  const [note, setNote] = useState('');

  return (
    <div>
      <input
        className="input mb-2 text-body-sm"
        placeholder={asManager ? 'Note (recorded as a decision on their behalf)' : 'Optional note'}
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
      <div className="flex gap-2">
        <form action={action} className="flex-1">
          <input type="hidden" name="handoverId" value={handoverId} />
          <input type="hidden" name="decision" value="ACCEPTED" />
          <input type="hidden" name="note" value={note} />
          <SubmitButton variant="ink" className="w-full" size="sm">
            {asManager ? 'Force accept' : 'Accept the work'}
          </SubmitButton>
        </form>
        <form action={action} className="flex-1">
          <input type="hidden" name="handoverId" value={handoverId} />
          <input type="hidden" name="decision" value="REJECTED" />
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

export function HandoverWithdraw({ handoverId }: { handoverId: string }) {
  const [state, action] = useActionState<ActionState, FormData>(cancelHandoverAction, {});
  return (
    <form action={action}>
      <input type="hidden" name="handoverId" value={handoverId} />
      <SubmitButton variant="secondary" size="sm" confirm="Withdraw this handover request?">
        Withdraw
      </SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}
