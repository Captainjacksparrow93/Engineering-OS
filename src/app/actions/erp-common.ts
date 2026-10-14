import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { toState, type ActionState } from '@/core/utils/actions';

/**
 * Shared plumbing for ERP server actions: run the service, refresh every ERP page, and turn
 * domain errors into form messages. No rules live in actions; services validate and authorise.
 */
export async function run(fn: () => Promise<unknown>, success: string): Promise<ActionState> {
  try {
    await fn();
  } catch (error) {
    return toState(error);
  }
  revalidatePath('/erp', 'layout');
  return { success };
}

/** Creates a record and opens it. `redirect` must run outside the try, or Next's signal is swallowed. */
export async function runAndOpen(fn: () => Promise<{ id: string }>, path: (id: string) => string): Promise<ActionState> {
  let id: string;
  try {
    id = (await fn()).id;
  } catch (error) {
    return toState(error);
  }
  revalidatePath('/erp', 'layout');
  redirect(path(id));
}

export const field = (form: FormData, key: string) => {
  const raw = form.get(key);
  return raw === null ? undefined : String(raw);
};

/** Every form field as a plain object, for services that parse with zod. */
export const fields = (form: FormData): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === 'string') out[k] = v;
  return out;
};
