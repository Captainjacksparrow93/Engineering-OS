import { requirePrincipal } from '@/core/auth/session';
import { handler, ok } from '@/core/http/api';
import { listHandovers } from '@/modules/project-management/services/handover.service';

export const GET = handler(async () => {
  const principal = await requirePrincipal();
  return ok(await listHandovers(principal));
});
