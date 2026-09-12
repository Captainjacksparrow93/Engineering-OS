import { redirect } from 'next/navigation';
import { getPrincipal } from '@/core/auth/session';
import { unreadCount } from '@/core/notifications/notify';
import { Sidebar } from '@/components/shell/sidebar';
import { Topbar } from '@/components/shell/topbar';
import { ShellContainer } from '@/components/shell/shell-container';

export const dynamic = 'force-dynamic';

/**
 * The authenticated shell. Every module renders inside it, and the navigation is
 * generated from the signed-in person's permissions, so two people at different
 * levels genuinely see different applications.
 */
export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  const principal = await getPrincipal();
  if (!principal) redirect('/login');

  const notifications = await unreadCount(principal.userId);

  return (
    <ShellContainer
      sidebar={<Sidebar principal={principal} />}
      topbar={<Topbar principal={principal} unread={notifications} />}
    >
      {children}
    </ShellContainer>
  );
}
