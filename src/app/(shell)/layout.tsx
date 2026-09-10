import { redirect } from 'next/navigation';
import { getPrincipal } from '@/core/auth/session';
import { unreadCount } from '@/core/notifications/notify';
import { Sidebar } from '@/components/shell/sidebar';
import { Topbar } from '@/components/shell/topbar';

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
    <div className="flex min-h-screen">
      <Sidebar principal={principal} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar principal={principal} unread={notifications} />
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 md:px-6">{children}</main>
        <footer className="border-t border-surface-border bg-white px-6 py-3 text-xs text-slate-400">
          Engineering OS · Project Management module · Further modules are on the roadmap
        </footer>
      </div>
    </div>
  );
}
