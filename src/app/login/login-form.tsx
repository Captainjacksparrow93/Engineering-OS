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
        <p className="mb-base rounded-md border border-error/30 bg-error/[0.06] px-base py-sm text-body-sm text-ink">
          {state.error}
        </p>
      ) : null}

      <SubmitButton />
    </form>
  );
}
