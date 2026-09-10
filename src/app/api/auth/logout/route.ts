import { destroySession } from '@/core/auth/session';
import { handler, ok } from '@/core/http/api';

export const POST = handler(async () => {
  await destroySession();
  return ok({ signedOut: true });
});
