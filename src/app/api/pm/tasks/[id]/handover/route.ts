import type { NextRequest } from 'next/server';
import { requirePrincipal } from '@/core/auth/session';
import { handler, ok } from '@/core/http/api';
import { requestHandover } from '@/modules/project-management/services/handover.service';
import { handoverCandidates, peersForHandover } from '@/modules/project-management/services/availability.service';
import { handoverRequestSchema } from '@/modules/project-management/validation/schemas';

/**
 * Ranked peers who could take the remaining work.
 *
 * `peers` is always populated; `candidates` carries the capacity ranking and is empty
 * for callers without resource-read rights, so a junior engineer can still choose
 * somebody sensibly rather than being handed an empty list.
 */
export const GET = handler(async (_request: NextRequest, context: { params: Promise<{ id: string }> }) => {
  const principal = await requirePrincipal();
  const { id } = await context.params;
  const [candidates, peers] = await Promise.all([handoverCandidates(principal, id), peersForHandover(principal, id)]);
  return ok({ candidates, peers });
});

export const POST = handler(async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
  const principal = await requirePrincipal();
  const { id } = await context.params;
  const input = handoverRequestSchema.parse({ ...(await request.json()), taskId: id });
  return ok({ handover: await requestHandover(principal, input) }, 201);
});
