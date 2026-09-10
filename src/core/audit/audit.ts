import { prisma, type Tx } from '@/core/db/prisma';

export interface AuditInput {
  actorId?: string | null;
  module: string;
  action: string;
  entityType: string;
  entityId: string;
  diff?: Record<string, unknown> | null;
  ip?: string | null;
}

/**
 * Writes an audit row. Pass the transaction client when auditing a write so the log
 * and the change land together - a half-written audit trail is worse than none.
 */
export async function audit(input: AuditInput, tx: Tx = prisma): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorId: input.actorId ?? null,
      module: input.module,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      diff: (input.diff ?? undefined) as never,
      ip: input.ip ?? null,
    },
  });
}

/** Keeps audit diffs small: only the fields that actually moved. */
export function diffOf<T extends Record<string, unknown>>(before: T, after: Partial<T>) {
  const changed: Record<string, { from: unknown; to: unknown }> = {};
  for (const [key, value] of Object.entries(after)) {
    if (value === undefined) continue;
    const previous = before[key as keyof T];
    if (JSON.stringify(previous) === JSON.stringify(value)) continue;
    changed[key] = { from: previous ?? null, to: value ?? null };
  }
  return changed;
}
