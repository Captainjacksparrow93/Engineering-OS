import Link from 'next/link';
import { requirePrincipal } from '@/core/auth/session';
import { hasPermissionAnywhere, can } from '@/core/rbac/engine';
import { listProjects } from '@/modules/project-management/services/project.service';
import { listClients } from '@/modules/project-management/services/client.service';
import { getPMTeamData } from '@/modules/project-management/services/automation-project.service';
import { PageHeader } from '@/components/ui';
import { ProjectsClient } from './projects-client';
import { ServiceCallModal } from './service-call-modal';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Projects',
};

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const principal = await requirePrincipal();
  const params = await searchParams;
  const canCreate = hasPermissionAnywhere(principal, 'pm.project.create');

  const [projects, clients, pmData] = await Promise.all([
    listProjects(principal, {
      status: params.status,
      search: params.q,
    }),
    canCreate ? listClients(principal.companyId) : Promise.resolve([]),
    canCreate ? getPMTeamData(principal.companyId) : Promise.resolve({ managers: [] }),
  ]);

  const isManagerOrDirector = can(principal, 'pm.report.read') || can(principal, 'pm.oversight');
  const emptyHint = isManagerOrDirector
    ? 'Projects you manage appear here.'
    : 'Projects you work on appear here.';

  return (
    <div className="space-y-4">
      <PageHeader
        title="Projects"
        subtitle={`${projects.length} project${projects.length === 1 ? '' : 's'}`}
        actions={
          canCreate ? (
            <div className="flex items-center gap-2">
              <ServiceCallModal clients={clients} managers={pmData.managers} />
              <Link href="/pm/projects/new" className="btn btn-primary text-body-sm px-4 py-2 font-medium">
                New project
              </Link>
            </div>
          ) : null
        }
      />

      <ProjectsClient
        projects={projects}
        canCreate={canCreate}
        emptyHint={emptyHint}
        initialStatus={params.status}
      />
    </div>
  );
}
