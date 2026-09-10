import { prisma, type Tx } from '@/core/db/prisma';

export interface NotifyInput {
  userIds: string[];
  title: string;
  body: string;
  link?: string;
}

/**
 * In-app notifications today. Email/WhatsApp are separate channels on the same table,
 * so adding a dispatcher later needs no change at the call sites.
 */
export async function notify(input: NotifyInput, tx: Tx = prisma): Promise<void> {
  const recipients = [...new Set(input.userIds)].filter(Boolean);
  if (recipients.length === 0) return;
  await tx.notification.createMany({
    data: recipients.map((userId) => ({
      userId,
      title: input.title,
      body: input.body,
      link: input.link,
    })),
  });
}

export async function markRead(userId: string, notificationId: string): Promise<void> {
  await prisma.notification.updateMany({
    where: { id: notificationId, userId, readAt: null },
    data: { readAt: new Date() },
  });
}

export async function unreadCount(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, readAt: null } });
}
