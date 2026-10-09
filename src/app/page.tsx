import { redirect } from 'next/navigation';
import { getPrincipal } from '@/core/auth/session';
import { homePath } from '@/core/rbac/engine';

export default async function RootPage() {
  const principal = await getPrincipal();
  if (!principal) redirect('/login');
  redirect(homePath(principal));
}

