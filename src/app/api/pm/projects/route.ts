import type { NextRequest } from 'next/server';
import { requirePrincipal } from '@/core/auth/session';
import { handler, ok } from '@/core/http/api';
import { createProject, listProjects } from '@/modules/project-management/services/project.service';
import { createProjectSchema } from '@/modules/project-management/validation/schemas';

export const GET = handler(async (request: NextRequest) => {
  const principal = await requirePrincipal();
  const params = request.nextUrl.searchParams;
  const projects = await listProjects(principal, {
    status: params.get('status') ?? undefined,
    search: params.get('q') ?? undefined,
    mine: params.get('mine') === '1',
  });
  return ok({ projects });
});

export const POST = handler(async (request: NextRequest) => {
  const principal = await requirePrincipal();
  const input = createProjectSchema.parse(await request.json());
  const project = await createProject(principal, input);
  return ok({ project }, 201);
});
