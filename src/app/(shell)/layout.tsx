import { redirect } from 'next/navigation';
import { getPrincipal } from '@/core/auth/session';
import { unreadCount } from '@/core/notifications/notify';
import { prisma } from '@/core/db/prisma';
import { countPendingApprovals } from '@/modules/project-management/services/task.service';
import { Sidebar } from '@/components/shell/sidebar';
import { Topbar } from '@/components/shell/topbar';
import { ShellContainer } from '@/components/shell/shell-container';
import { FreshCountsListener } from '@/components/shell/fresh-counts-listener';

export const dynamic = 'force-dynamic';

/**
 * The authenticated shell. Every module renders inside it, and the navigation is
 * generated from the signed-in person's permissions, so two people at different
 * levels genuinely see different applications.
 */
export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  const principal = await getPrincipal();
  if (!principal) redirect('/login');

  const [notifications, taskHandovers, projectHandovers, pendingApprovals] = await Promise.all([
    unreadCount(principal.userId),
    prisma.taskHandover.count({
      where: { toUserId: principal.userId, status: 'PENDING' },
    }),
    prisma.projectHandover.count({
      where: { toUserId: principal.userId, status: 'PENDING' },
    }),
    countPendingApprovals(principal),
  ]);

  const pendingHandovers = taskHandovers + projectHandovers;

  return (
    <ShellContainer
      sidebar={
        <Sidebar
          key="shell-sidebar"
          principal={principal}
          pendingHandovers={pendingHandovers}
          pendingApprovals={pendingApprovals}
        />
      }
      topbar={<Topbar key="shell-topbar" principal={principal} unread={notifications} />}
    >

      {children}
      <FreshCountsListener />
    </ShellContainer>
  );
}
