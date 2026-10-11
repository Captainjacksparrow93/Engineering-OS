'use server';

import { revalidatePath } from 'next/cache';
import { requirePrincipal } from '@/core/auth/session';
import { toState, value, type ActionState } from '@/core/utils/actions';
import { cancelVisit, checkIn, checkOut, logWalkIn, replyToVisitor, scheduleVisit } from '@/modules/gate/services/visit.service';

/**
 * Gate write path for the UI. Each action authenticates, hands the raw form to the service
 * (which validates and authorises) and refreshes the gate pages. No rules live here.
 */

async function run(fn: () => Promise<unknown>, success: string): Promise<ActionState> {
  try {
    await fn();
    for (const p of ['/gate', '/gate/my-visitors', '/gate/register']) revalidatePath(p);
    // The arrival alert sits in the shell, on every page.
    revalidatePath('/', 'layout');
    return { success };
  } catch (error) {
    return toState(error);
  }
}

const visitorFields = (form: FormData) => ({
  visitorName: value(form, 'visitorName') ?? '',
  visitorPhone: value(form, 'visitorPhone') ?? '',
  visitorCompany: value(form, 'visitorCompany'),
  purpose: value(form, 'purpose') ?? '',
});

export async function scheduleVisitAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  return run(
    () => scheduleVisit(principal, { ...visitorFields(form), date: value(form, 'date') ?? '', time: value(form, 'time') ?? '', hostId: value(form, 'hostId') }),
    'Visit scheduled. The front desk will expect them.',
  );
}

export async function walkInAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  return run(() => logWalkIn(principal, { ...visitorFields(form), hostId: value(form, 'hostId') ?? '' }), 'Checked in. The host has been told.');
}

export async function checkInAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  return run(() => checkIn(principal, String(form.get('visitId') ?? '')), 'Checked in. The host has been told.');
}

export async function checkOutAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  return run(() => checkOut(principal, String(form.get('visitId') ?? '')), 'Checked out.');
}

export async function cancelVisitAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  return run(() => cancelVisit(principal, String(form.get('visitId') ?? '')), 'Visit cancelled.');
}

export async function replyAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  return run(
    () => replyToVisitor(principal, String(form.get('visitId') ?? ''), { reply: String(form.get('reply') ?? ''), note: value(form, 'note') }),
    'Reply sent to the front desk.',
  );
}
