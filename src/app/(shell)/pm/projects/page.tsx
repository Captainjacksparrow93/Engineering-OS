import Link from 'next/link';
import { requirePrincipal } from '@/core/auth/session';
import { hasPermissionAnywhere, can } from '@/core/rbac/engine';
import { listProjects } from '@/modules/project-management/services/project.service';
import { PageHeader } from '@/components/ui';
import { ProjectsClient } from './projects-client';

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
  const projects = await listProjects(principal, {
    status: params.status,
    search: params.q,
  });

  const canCreate = hasPermissionAnywhere(principal, 'pm.project.create');
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
            <Link href="/pm/projects/new" className="btn btn-primary text-body-sm px-4 py-2 font-medium">
              New project
            </Link>
          ) : null
        }
      />

      <ProjectsClient projects={projects} canCreate={canCreate} emptyHint={emptyHint} />
    </div>
  );
}
