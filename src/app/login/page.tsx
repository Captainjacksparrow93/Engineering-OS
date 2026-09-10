import { redirect } from 'next/navigation';
import { getPrincipal } from '@/core/auth/session';
import { LoginForm } from './login-form';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  const principal = await getPrincipal();
  if (principal) redirect('/dashboard');

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-100 via-white to-brand-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 text-xl text-white">
            ⚡
          </div>
          <h1 className="text-xl font-semibold text-slate-900">Engineering OS</h1>
          <p className="mt-1 text-sm text-slate-500">Vidyut Switchgear - one platform for the whole plant</p>
        </div>

        <div className="card">
          <div className="card-body">
            <LoginForm />
          </div>
        </div>

        <p className="mt-4 text-center text-xs text-slate-400">
          Access is controlled by your role. Contact the PMO if a screen is missing.
        </p>
      </div>
    </main>
  );
}
