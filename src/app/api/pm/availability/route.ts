import type { NextRequest } from 'next/server';
import { requirePrincipal } from '@/core/auth/session';
import { handler, ok } from '@/core/http/api';
import { getWorkloads, suggestAssignees } from '@/modules/project-management/services/availability.service';

/**
 * `GET /api/pm/availability` - the resource board as data.
 * Add `?suggest=1` to get the ranked candidate list for a specific piece of work.
 */
export const GET = handler(async (request: NextRequest) => {
  const principal = await requirePrincipal();
  const params = request.nextUrl.searchParams;

  const query = {
    from: params.get('from') ? new Date(`${params.get('from')}T00:00:00.000Z`) : undefined,
    to: params.get('to') ? new Date(`${params.get('to')}T00:00:00.000Z`) : undefined,
    departmentId: params.get('departmentId') ?? undefined,
    projectId: params.get('projectId') ?? undefined,
    skills: params.get('skills')?.split(',').map((s) => s.trim()).filter(Boolean),
    requiredHours: params.get('requiredHours') ? Number(params.get('requiredHours')) : undefined,
    priority: (params.get('priority') as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | null) ?? undefined,
  };

  if (params.get('suggest') === '1') {
    return ok({ suggestions: await suggestAssignees(principal, query) });
  }
  return ok({ workloads: await getWorkloads(principal, query) });
});
