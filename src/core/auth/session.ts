import { cookies } from 'next/headers';
import { SignJWT, jwtVerify } from 'jose';
import { randomUUID } from 'node:crypto';
import { prisma } from '@/core/db/prisma';
import { config } from '@/core/config';
import { loadPrincipal } from '@/core/rbac/principal';
import { UnauthorizedError } from '@/core/rbac/errors';
import type { Principal } from '@/core/rbac/types';

export const SESSION_COOKIE = 'engos_session';

interface SessionClaims {
  sub: string;
  jti: string;
}

function secretKey(): Uint8Array {
  return new TextEncoder().encode(config().AUTH_SECRET);
}

/**
 * Sessions are JWT cookies backed by a `core_sessions` row. The row is what makes
 * "sign out everywhere" and forced revocation on exit possible - a stateless token
 * alone cannot be withdrawn, which is unacceptable when someone leaves the company.
 */
export async function createSession(userId: string, meta: { userAgent?: string; ip?: string } = {}) {
  const ttl = config().SESSION_TTL_SECONDS;
  const tokenId = randomUUID();
  const expiresAt = new Date(Date.now() + ttl * 1000);

  await prisma.session.create({
    data: { userId, tokenId, expiresAt, userAgent: meta.userAgent, ip: meta.ip },
  });
  await prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });

  const token = await new SignJWT({ sub: userId, jti: tokenId } satisfies SessionClaims)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(secretKey());

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: expiresAt,
  });

  return { token, expiresAt };
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    const claims = await verifyToken(token);
    if (claims) {
      await prisma.session.updateMany({
        where: { tokenId: claims.jti, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
  }
  store.delete(SESSION_COOKIE);
}

async function verifyToken(token: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (typeof payload.sub !== 'string' || typeof payload.jti !== 'string') return null;
    return { sub: payload.sub, jti: payload.jti };
  } catch {
    return null;
  }
}

/** Returns the current principal, or null when signed out. Never throws. */
export async function getPrincipal(): Promise<Principal | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const claims = await verifyToken(token);
  if (!claims) return null;

  const session = await prisma.session.findUnique({
    where: { tokenId: claims.jti },
    select: { userId: true, revokedAt: true, expiresAt: true },
  });
  if (!session || session.revokedAt || session.expiresAt < new Date()) return null;
  if (session.userId !== claims.sub) return null;

  return loadPrincipal(session.userId);
}

/** Use in server components and route handlers that require a signed-in user. */
export async function requirePrincipal(): Promise<Principal> {
  const principal = await getPrincipal();
  if (!principal) throw new UnauthorizedError();
  return principal;
}
