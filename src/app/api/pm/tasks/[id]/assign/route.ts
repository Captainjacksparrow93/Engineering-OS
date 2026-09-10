import type { NextRequest } from 'next/server';
import { requirePrincipal } from '@/core/auth/session';
import { handler, ok } from '@/core/http/api';
import { assignTask } from '@/modules/project-management/services/task.service';
import { assignTaskSchema } from '@/modules/project-management/validation/schemas';

export const POST = handler(async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
  const principal = await requirePrincipal();
  const { id } = await context.params;
  const input = assignTaskSchema.parse(await request.json());
  return ok({ assignment: await assignTask(principal, id, input) }, 201);
});
