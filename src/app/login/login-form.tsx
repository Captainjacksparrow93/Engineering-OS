'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { signIn, type AuthFormState } from '@/app/actions/auth';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary w-full" disabled={pending}>
      {pending ? 'Signing in…' : 'Sign in'}
    </button>
  );
}

export function LoginForm() {
  const [state, formAction] = useActionState<AuthFormState, FormData>(signIn, {});

  return (
    <form action={formAction}>
      <div className="field">
        <label className="label" htmlFor="email">
          Work email
        </label>
        <input id="email" name="email" type="email" autoComplete="username" required className="input" placeholder="name@vidyutswitchgear.com" />
      </div>

      <div className="field">
        <label className="label" htmlFor="password">
          Password
        </label>
        <input id="password" name="password" type="password" autoComplete="current-password" required className="input" />
      </div>

      {state.error ? (
        <p className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      ) : null}

      <SubmitButton />
    </form>
  );
}
