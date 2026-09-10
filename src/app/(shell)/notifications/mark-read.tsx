'use client';

import { useActionState } from 'react';
import { markNotificationReadAction, type ActionState } from '@/app/actions/pm';
import { SubmitButton } from '@/components/form';

export function MarkReadButton({ notificationId }: { notificationId: string }) {
  const [, action] = useActionState<ActionState, FormData>(markNotificationReadAction, {});
  return (
    <form action={action}>
      <input type="hidden" name="notificationId" value={notificationId} />
      <SubmitButton variant="secondary" size="sm">
        Mark read
      </SubmitButton>
    </form>
  );
}
