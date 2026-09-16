import { isClientSafeError } from '@/core/rbac/errors';

export interface ActionState {
  error?: string;
  success?: string;
  fieldErrors?: Record<string, string[]>;
}

export function toState(error: unknown): ActionState {
  if (error && typeof error === 'object' && 'issues' in error && Array.isArray((error as { issues: unknown[] }).issues)) {
    const zodError = error as { issues: Array<{ path: (string | number)[]; message: string }> };
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of zodError.issues) {
      const key = issue.path.join('.') || 'form';
      fieldErrors[key] = [...(fieldErrors[key] ?? []), issue.message];
    }
    return { error: zodError.issues[0]?.message ?? 'Please check the form.', fieldErrors };
  }
  if (isClientSafeError(error) && error instanceof Error) {
    return { error: error.message };
  }
  console.error('Unhandled action error:', error);
  return { error: 'Something went wrong.' };
}

export const value = (form: FormData, key: string): string | undefined => {
  const raw = form.get(key);
  if (raw === null) return undefined;
  const text = String(raw).trim();
  return text === '' ? undefined : text;
};

export const list = (form: FormData, key: string): string[] =>
  String(form.get(key) ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
