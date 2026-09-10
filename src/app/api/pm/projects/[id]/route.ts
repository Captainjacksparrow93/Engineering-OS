import type { NextRequest } from 'next/server';
import { requirePrincipal } from '@/core/auth/session';
import { handler, ok } from '@/core/http/api';
import { getProjectWorkspace, updateProject } from '@/modules/project-management/services/project.service';
import { updateProjectSchema } from '@/modules/project-management/validation/schemas';

export const GET = handler(async (_request: NextRequest, context: { params: Promise<{ id: string }> }) => {
  const principal = await requirePrincipal();
  const { id } = await context.params;
  return ok(await getProjectWorkspace(principal, id));
});

export const PATCH = handler(async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
  const principal = await requirePrincipal();
  const { id } = await context.params;
  const input = updateProjectSchema.parse(await request.json());
  return ok({ project: await updateProject(principal, id, input) });
});
