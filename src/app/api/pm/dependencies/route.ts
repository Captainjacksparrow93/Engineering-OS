import type { NextRequest } from 'next/server';
import { requirePrincipal } from '@/core/auth/session';
import { handler, ok } from '@/core/http/api';
import { addDependency, removeDependency } from '@/modules/project-management/services/dependency.service';
import { dependencySchema } from '@/modules/project-management/validation/schemas';

export const POST = handler(async (request: NextRequest) => {
  const principal = await requirePrincipal();
  const input = dependencySchema.parse(await request.json());
  return ok({ dependency: await addDependency(principal, input) }, 201);
});

export const DELETE = handler(async (request: NextRequest) => {
  const principal = await requirePrincipal();
  const id = request.nextUrl.searchParams.get('id');
  if (!id) return ok({ error: 'id is required' }, 400);
  await removeDependency(principal, id);
  return ok({ deleted: true });
});
