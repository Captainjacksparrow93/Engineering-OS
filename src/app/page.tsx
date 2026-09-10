import { redirect } from 'next/navigation';
import { getPrincipal } from '@/core/auth/session';

export default async function RootPage() {
  const principal = await getPrincipal();
  redirect(principal ? '/dashboard' : '/login');
}
