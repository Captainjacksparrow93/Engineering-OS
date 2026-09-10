import { redirect } from 'next/navigation';
import { getPrincipal } from '@/core/auth/session';
import { LoginForm } from './login-form';

export const dynamic = 'force-dynamic';

/** Editorial sign-in band: cream canvas, display type at weight 400, one orange CTA. */
export default async function LoginPage() {
  const principal = await getPrincipal();
  if (principal) redirect('/dashboard');

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-base py-section">
      <div className="w-full max-w-sm">
        <div className="mb-xxl">
          <p className="mb-lg flex items-baseline gap-xxs">
            <span className="text-display-sm text-primary">Engineering</span>
            <span className="text-display-sm text-ink">OS</span>
          </p>
          <h1 className="text-display-lg text-ink">Sign in</h1>
          <p className="mt-sm text-body-md text-body">
            One platform for the whole plant — projects today, the rest of the works to follow.
          </p>
        </div>

        <div className="card">
          <div className="card-body">
            <LoginForm />
          </div>
        </div>

        <p className="mt-lg text-caption text-muted">
          Access is controlled by your role. Contact the PMO if a screen you expect is missing.
        </p>
      </div>
    </main>
  );
}
