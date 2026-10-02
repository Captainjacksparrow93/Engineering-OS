import { redirect } from 'next/navigation';
import { getPrincipal } from '@/core/auth/session';
import { hasPermissionAnywhere } from '@/core/rbac/engine';

export default async function RootPage() {
  const principal = await getPrincipal();
  if (!principal) redirect('/login');
  redirect(hasPermissionAnywhere(principal, 'pm.report.read') ? '/dashboard' : '/pm/my-work');
}

