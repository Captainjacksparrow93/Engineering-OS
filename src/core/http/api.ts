import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { DomainError, ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from '@/core/rbac/errors';
import { drainOutbox } from '@/core/events/bus';

/**
 * One error contract for the whole API. Route handlers throw domain errors and this
 * maps them; nothing has to remember which status code goes with which failure.
 */
export function toErrorResponse(error: unknown): NextResponse {
  if (error instanceof ZodError) {
    return NextResponse.json(
      { error: 'Invalid request.', issues: error.flatten().fieldErrors },
      { status: 400 },
    );
  }
  if (error instanceof ValidationError) {
    return NextResponse.json({ error: error.message, issues: error.issues }, { status: 400 });
  }
  if (
    error instanceof UnauthorizedError ||
    error instanceof ForbiddenError ||
    error instanceof NotFoundError ||
    error instanceof DomainError
  ) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error('[api] unhandled error', error);
  return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 });
}

/**
 * Wraps a route handler with error mapping and an outbox drain, so an event published
 * inside a request is delivered before the response goes out whenever possible.
 */
export function handler<Args extends unknown[]>(
  fn: (...args: Args) => Promise<NextResponse>,
): (...args: Args) => Promise<NextResponse> {
  return async (...args: Args) => {
    try {
      const response = await fn(...args);
      void drainOutbox().catch((e) => console.error('[outbox] drain failed', e));
      return response;
    } catch (error) {
      return toErrorResponse(error);
    }
  };
}

export const ok = <T>(data: T, status = 200) => NextResponse.json(data, { status });
