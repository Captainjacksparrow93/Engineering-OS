import { redirect } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { hasPermissionAnywhere } from '@/core/rbac/engine';
import { prisma } from '@/core/db/prisma';
import { suggestAssignees } from '@/modules/project-management/services/availability.service';
import { projectVisibilityWhere } from '@/modules/project-management/services/access';
import { PageHeader, Alert } from '@/components/ui';
import { AdhocForm } from './adhoc-form';

export const dynamic = 'force-dynamic';

/**
 * Ad-hoc assignment.
 *
 * The scenario this screen exists for: an urgent job lands mid-week and management
 * needs to know, right now, who can absorb it. Filters at the top re-rank the
 * candidate list; picking a candidate and submitting creates the task and assigns it
 * in one step.
 */
export default async function AdhocPage({
  searchParams,
}: {
  searchParams: Promise<{
    projectId?: string;
    skills?: string;
    hours?: string;
    priority?: string;
    departmentId?: string;
  }>;
}) {
  const principal = await requirePrincipal();
  if (!hasPermissionAnywhere(principal, 'pm.task.adhoc.create')) redirect('/dashboard');

  const params = await searchParams;
  const skills = params.skills ? params.skills.split(',').map((s) => s.trim()).filter(Boolean) : [];
  const requiredHours = params.hours ? Number(params.hours) : 8;
  const priority = (params.priority as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL') ?? 'HIGH';

  const [projects, departments, suggestions] = await Promise.all([
    prisma.project.findMany({
      where: { ...projectVisibilityWhere(principal), status: { notIn: ['COMPLETED', 'CANCELLED'] } },
      select: { id: true, code: true, name: true, clientName: true },
      orderBy: { code: 'asc' },
    }),
    prisma.department.findMany({
      where: { companyId: principal.companyId },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    suggestAssignees(principal, {
      skills: skills.length ? skills : undefined,
      requiredHours,
      priority,
      departmentId: params.departmentId,
    }).catch(() => []),
  ]);

  return (
    <>
      <PageHeader
        title="Assign ad-hoc work"
        subtitle="Unplanned work that has to be delivered now. Candidates are ranked by spare capacity, skill fit and grade."
      />

      {projects.length === 0 ? (
        <Alert tone="warning">
          You have no active projects in scope. Ad-hoc work still belongs to a project so that its effort is costed
          correctly — create or join a project first.
        </Alert>
      ) : (
        <AdhocForm
          projects={projects}
          departments={departments}
          filters={{ skills: params.skills ?? '', hours: requiredHours, priority, departmentId: params.departmentId ?? '', projectId: params.projectId ?? '' }}
          suggestions={suggestions.map((s) => ({
            id: s.workload.person.id,
            fullName: s.workload.person.fullName,
            designation: s.workload.person.designation,
            departmentName: s.workload.person.departmentName,
            avatarColor: s.workload.person.avatarColor,
            score: s.score,
            skillMatch: s.skillMatch,
            status: s.workload.status,
            freeHours: s.workload.freeHours,
            utilizationPercent: s.workload.utilizationPercent,
            openTaskCount: s.workload.openTaskCount,
            reasons: s.reasons,
          }))}
        />
      )}
    </>
  );
}
