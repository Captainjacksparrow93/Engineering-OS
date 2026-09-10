import { NextResponse } from 'next/server';
import { prisma } from '@/core/db/prisma';

/** Liveness + readiness in one: the container is only useful if the database answers. */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: 'ok', database: 'up', time: new Date().toISOString() });
  } catch {
    return NextResponse.json({ status: 'degraded', database: 'down' }, { status: 503 });
  }
}
