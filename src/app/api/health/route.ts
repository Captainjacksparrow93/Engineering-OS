import { NextResponse } from 'next/server';
import { prisma } from '@/core/db/prisma';

/** Liveness + readiness in one: database must answer and have no half-applied migrations. */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;

    // Verify no unapplied / half-finished migrations exist if migration table exists
    const unapplied = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM _prisma_migrations
      WHERE finished_at IS NULL
    `.catch(() => [{ count: 0n }]);

    if (unapplied[0] && Number(unapplied[0].count) > 0) {
      return NextResponse.json(
        { status: 'degraded', database: 'migrating', error: 'Unfinished migrations present' },
        { status: 503 }
      );
    }

    return NextResponse.json({ status: 'ok', database: 'up', time: new Date().toISOString() });
  } catch {
    return NextResponse.json({ status: 'degraded', database: 'down' }, { status: 503 });
  }
}
