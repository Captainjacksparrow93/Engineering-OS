import { prisma, type Tx } from '@/core/db/prisma';

export interface DomainEventInput {
  name: string;
  module: string;
  entityType: string;
  entityId: string;
  payload: Record<string, unknown>;
  actorId?: string | null;
}

export type EventHandler = (event: DomainEventInput & { id: string }) => Promise<void>;

/**
 * In-process handler registry. Modules subscribe at boot; the dispatcher below drains
 * the outbox and calls them. When HRMS/ERP arrive they register here first, and only
 * move to a queue worker if volume demands it - the publish contract does not change.
 */
const handlers = new Map<string, EventHandler[]>();

export function subscribe(eventName: string, handler: EventHandler): void {
  const list = handlers.get(eventName) ?? [];
  list.push(handler);
  handlers.set(eventName, list);
}

export function subscribersFor(eventName: string): EventHandler[] {
  return handlers.get(eventName) ?? [];
}

/**
 * Transactional outbox publish. MUST be called with the same `tx` as the business
 * write, so an event can never describe a change that was rolled back.
 */
export async function publish(event: DomainEventInput, tx: Tx): Promise<void> {
  await tx.domainEvent.create({
    data: {
      name: event.name,
      module: event.module,
      entityType: event.entityType,
      entityId: event.entityId,
      payload: event.payload as never,
      actorId: event.actorId ?? null,
    },
  });
}

/**
 * Drains pending events. Called after a request's transaction commits, and by a cron
 * worker as a safety net for anything the request-path drain missed.
 */
export async function drainOutbox(limit = 50): Promise<number> {
  const pending = await prisma.domainEvent.findMany({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });

  let processed = 0;
  for (const event of pending) {
    const listeners = subscribersFor(event.name);
    try {
      for (const listener of listeners) {
        await listener({
          id: event.id,
          name: event.name,
          module: event.module,
          entityType: event.entityType,
          entityId: event.entityId,
          payload: (event.payload ?? {}) as Record<string, unknown>,
          actorId: event.actorId,
        });
      }
      await prisma.domainEvent.update({
        where: { id: event.id },
        data: { status: 'PROCESSED', processedAt: new Date(), attempts: { increment: 1 } },
      });
      processed += 1;
    } catch (error) {
      await prisma.domainEvent.update({
        where: { id: event.id },
        data: {
          status: event.attempts >= 4 ? 'FAILED' : 'PENDING',
          attempts: { increment: 1 },
          lastError: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }
  return processed;
}
