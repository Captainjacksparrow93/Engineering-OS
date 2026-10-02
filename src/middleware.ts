import { NextResponse, type NextRequest } from 'next/server';

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

// In-memory rate limiting store (per container process)
const ipRateLimits = new Map<string, RateLimitRecord>();

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 15; // 15 attempts per 15 minutes for auth endpoints

function cleanupExpired() {
  const now = Date.now();
  for (const [key, record] of ipRateLimits.entries()) {
    if (record.resetAt <= now) {
      ipRateLimits.delete(key);
    }
  }
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Rate limit authentication POSTs and login actions
  if (
    request.method === 'POST' &&
    (pathname.startsWith('/api/auth') || pathname === '/login' || pathname.startsWith('/api/auth/login'))
  ) {
    cleanupExpired();

    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      request.headers.get('x-real-ip') ||
      'anonymous';

    const now = Date.now();
    const record = ipRateLimits.get(ip);

    if (record) {
      if (record.resetAt > now) {
        if (record.count >= MAX_ATTEMPTS) {
          const retryAfter = Math.ceil((record.resetAt - now) / 1000);
          return new NextResponse(
            JSON.stringify({
              error: 'Too many authentication attempts. Please try again later.',
              retryAfterSeconds: retryAfter,
            }),
            {
              status: 429,
              headers: {
                'Content-Type': 'application/json',
                'Retry-After': String(retryAfter),
              },
            }
          );
        }
        record.count += 1;
      } else {
        ipRateLimits.set(ip, { count: 1, resetAt: now + WINDOW_MS });
      }
    } else {
      ipRateLimits.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - api/health (health check)
     */
    '/((?!_next/static|_next/image|favicon.ico|api/health).*)',
  ],
};
