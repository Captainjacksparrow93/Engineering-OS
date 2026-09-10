import type { NextRequest } from 'next/server';
import { requirePrincipal } from '@/core/auth/session';
import { handler, ok } from '@/core/http/api';
import { cancelHandover, decideHandover } from '@/modules/project-management/services/handover.service';
import { handoverDecisionSchema } from '@/modules/project-management/validation/schemas';

export const POST = handler(async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
  const principal = await requirePrincipal();
  const { id } = await context.params;
  const input = handoverDecisionSchema.parse(await request.json());
  return ok({ handover: await decideHandover(principal, id, input.decision, input.note) });
});

export const DELETE = handler(async (_request: NextRequest, context: { params: Promise<{ id: string }> }) => {
  const principal = await requirePrincipal();
  const { id } = await context.params;
  await cancelHandover(principal, id);
  return ok({ cancelled: true });
});
