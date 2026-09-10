import type { NextRequest } from 'next/server';
import { requirePrincipal } from '@/core/auth/session';
import { handler, ok } from '@/core/http/api';
import { changeTaskStatus, deleteTask, getTaskDetail, updateTask } from '@/modules/project-management/services/task.service';
import { changeTaskStatusSchema, updateTaskSchema } from '@/modules/project-management/validation/schemas';

export const GET = handler(async (_request: NextRequest, context: { params: Promise<{ id: string }> }) => {
  const principal = await requirePrincipal();
  const { id } = await context.params;
  return ok(await getTaskDetail(principal, id));
});

/** Accepts either a field update or a status transition; both are validated. */
export const PATCH = handler(async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
  const principal = await requirePrincipal();
  const { id } = await context.params;
  const body = await request.json();

  if (body.status) {
    const input = changeTaskStatusSchema.parse(body);
    return ok({ task: await changeTaskStatus(principal, id, input.status, input.note) });
  }

  const input = updateTaskSchema.parse(body);
  return ok({ task: await updateTask(principal, id, input) });
});

export const DELETE = handler(async (_request: NextRequest, context: { params: Promise<{ id: string }> }) => {
  const principal = await requirePrincipal();
  const { id } = await context.params;
  await deleteTask(principal, id);
  return ok({ deleted: true });
});
