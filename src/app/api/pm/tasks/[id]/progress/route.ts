import type { NextRequest } from 'next/server';
import { requirePrincipal } from '@/core/auth/session';
import { handler, ok } from '@/core/http/api';
import { logProgress } from '@/modules/project-management/services/progress.service';
import { progressSchema } from '@/modules/project-management/validation/schemas';

export const POST = handler(async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
  const principal = await requirePrincipal();
  const { id } = await context.params;
  const input = progressSchema.parse({ ...(await request.json()), taskId: id });
  return ok({ log: await logProgress(principal, input) }, 201);
});
