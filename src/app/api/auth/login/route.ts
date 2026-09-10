import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/core/db/prisma';
import { verifyPassword } from '@/core/auth/password';
import { createSession } from '@/core/auth/session';
import { handler, ok } from '@/core/http/api';
import { audit } from '@/core/audit/audit';
import { NextResponse } from 'next/server';

const schema = z.object({ email: z.string().email(), password: z.string().min(1) });

/**
 * The API twin of the sign-in form. Exists so the same credentials work for the mobile
 * shop-floor client and for integration tests.
 */
export const POST = handler(async (request: NextRequest) => {
  const body = schema.parse(await request.json());
  const user = await prisma.user.findUnique({
    where: { email: body.email.toLowerCase() },
    select: { id: true, passwordHash: true, status: true, fullName: true },
  });

  if (!user || !(await verifyPassword(body.password, user.passwordHash)) || user.status !== 'ACTIVE') {
    return NextResponse.json({ error: 'Those credentials do not match an active account.' }, { status: 401 });
  }

  const session = await createSession(user.id, {
    userAgent: request.headers.get('user-agent') ?? undefined,
    ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim(),
  });
  await audit({ actorId: user.id, module: 'core', action: 'auth.signed_in', entityType: 'User', entityId: user.id });

  return ok({ user: { id: user.id, fullName: user.fullName }, expiresAt: session.expiresAt });
});
