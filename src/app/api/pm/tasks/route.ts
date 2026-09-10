import type { NextRequest } from 'next/server';
import { requirePrincipal } from '@/core/auth/session';
import { handler, ok } from '@/core/http/api';
import { createTask, listMyTasks } from '@/modules/project-management/services/task.service';
import { createTaskSchema } from '@/modules/project-management/validation/schemas';

/** Without a project filter this returns the caller's own queue - the mobile home screen. */
export const GET = handler(async (request: NextRequest) => {
  const principal = await requirePrincipal();
  const params = request.nextUrl.searchParams;
  const tasks = await listMyTasks(principal, {
    status: params.get('status') ?? undefined,
    includeCompleted: params.get('all') === '1',
  });
  return ok({ tasks });
});

export const POST = handler(async (request: NextRequest) => {
  const principal = await requirePrincipal();
  const input = createTaskSchema.parse(await request.json());
  return ok({ task: await createTask(principal, input) }, 201);
});
