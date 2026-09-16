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
 * Fast unplanned work creation. No complex composite scoring or page-reload filters:
 * candidates are ranked cleanly by current available capacity (free hours).
 */
export default async function AdhocPage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string }>;
}) {
  const principal = await requirePrincipal();
  if (!hasPermissionAnywhere(principal, 'pm.task.adhoc.create')) redirect('/dashboard');

  const params = await searchParams;

  const [projects, suggestions] = await Promise.all([
    prisma.project.findMany({
      where: { ...projectVisibilityWhere(principal), status: { notIn: ['COMPLETED', 'CANCELLED'] } },
      select: { id: true, code: true, name: true, clientName: true },
      orderBy: { code: 'asc' },
    }),
    suggestAssignees(principal, {
      requiredHours: 8,
      priority: 'HIGH',
    }).catch(() => []),
  ]);

  return (
    <>
      <PageHeader
        title="Assign ad-hoc work"
        subtitle="Unplanned work that has to be delivered now. Ranked directly by who is free right now."
      />

      {projects.length === 0 ? (
        <Alert tone="warning">
          You have no active projects in scope. Ad-hoc work still belongs to a project so that its effort is costed
          correctly - create or join a project first.
        </Alert>
      ) : (
        <AdhocForm
          projects={projects}
          defaultProjectId={params.projectId}
          suggestions={suggestions.map((s) => ({
            id: s.workload.person.id,
            fullName: s.workload.person.fullName,
            designation: s.workload.person.designation,
            departmentName: s.workload.person.departmentName,
            avatarColor: s.workload.person.avatarColor,
            status: s.workload.status,
            freeHours: s.workload.freeHours,
          }))}
        />
      )}
    </>
  );
}
