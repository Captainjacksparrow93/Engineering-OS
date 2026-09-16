'use client';

import { useActionState } from 'react';
import { markAllNotificationsReadAction, markNotificationReadAction, type ActionState } from '@/app/actions/pm';
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

export function MarkAllReadButton() {
  const [, action] = useActionState<ActionState, FormData>(markAllNotificationsReadAction, {});
  return (
    <form action={action}>
      <SubmitButton variant="secondary" size="sm">
        Mark all as read
      </SubmitButton>
    </form>
  );
}
