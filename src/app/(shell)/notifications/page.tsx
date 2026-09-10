import Link from 'next/link';
import { requirePrincipal } from '@/core/auth/session';
import { prisma } from '@/core/db/prisma';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { MarkReadButton } from './mark-read';

export const dynamic = 'force-dynamic';

export default async function NotificationsPage() {
  const principal = await requirePrincipal();
  const notifications = await prisma.notification.findMany({
    where: { userId: principal.userId },
    orderBy: { createdAt: 'desc' },
    take: 60,
  });

  return (
    <>
      <PageHeader title="Notifications" subtitle="Assignments, handovers, blockers and approvals that involve you." />

      {notifications.length === 0 ? (
        <EmptyState title="Nothing yet" hint="You will be told when work is assigned to you or something you depend on moves." />
      ) : (
        <Card bodyClassName="p-0">
          <ul className="divide-y divide-hairline">
            {notifications.map((notification) => (
              <li key={notification.id} className={`flex items-start gap-3 px-4 py-3 ${notification.readAt ? 'opacity-60' : ''}`}>
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-pill ${notification.readAt ? 'bg-hairline-strong' : 'bg-ink'}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-body-sm font-medium text-ink">{notification.title}</p>
                  <p className="text-body-sm text-body">{notification.body}</p>
                  <p className="mt-0.5 text-caption text-muted-soft">
                    {notification.createdAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {notification.link ? (
                    <Link href={notification.link} className="btn btn-secondary btn-sm">
                      Open
                    </Link>
                  ) : null}
                  {!notification.readAt ? <MarkReadButton notificationId={notification.id} /> : null}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
