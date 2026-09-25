import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { NotFoundError } from '@/core/rbac/errors';
import { getClientPortfolio, type ClientPortfolioProject } from '@/modules/project-management/services/client.service';
import { projectLabel } from '@/modules/project-management/domain/project-label';
import { PageHeader, StatusBadge, PriorityBadge, ProgressBar, Avatar } from '@/components/ui';
import { formatDate } from '@/core/utils/dates';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return {
    title: `Client ${id}`,
  };
}

function ProjectRow({ project }: { project: ClientPortfolioProject }) {
  return (
    <tr className="hover:bg-surface-strong/20 transition-colors group">
      <td className="py-3 px-4">
        <Link
          href={`/pm/projects/${project.id}`}
          className="font-semibold text-ink hover:text-primary hover:underline block"
        >
          {projectLabel({
            workOrderNo: project.workOrderNo,
            name: project.name,
            clientName: project.clientName,
          })}
        </Link>
        <span className="font-mono text-caption text-muted">{project.code}</span>
      </td>
      <td className="py-3 px-4">
        <StatusBadge status={project.status} />
      </td>
      <td className="py-3 px-4">
        <PriorityBadge priority={project.priority} />
      </td>
      <td className="py-3 px-4 w-36">
        <div className="flex items-center justify-between text-caption font-mono mb-1">
          <span>{project.progressPercent}%</span>
        </div>
        <ProgressBar
          value={project.progressPercent}
          tone={project.progressPercent === 100 ? 'success' : 'default'}
        />
      </td>
      <td className="py-3 px-4 text-caption text-muted whitespace-nowrap">
        {project.targetEndDate ? formatDate(project.targetEndDate) : '—'}
      </td>
      <td className="py-3 px-4">
        {project.manager ? (
          <div className="flex items-center gap-2">
            <Avatar
              name={project.manager.fullName}
              color={project.manager.avatarColor}
              size={24}
            />
            <span className="text-body-sm text-ink truncate">
              {project.manager.fullName}
            </span>
          </div>
        ) : (
          <span className="text-caption text-muted">Unassigned</span>
        )}
      </td>
      <td className="py-3 px-4 text-right">
        <Link
          href={`/pm/projects/${project.id}`}
          className="btn btn-secondary btn-sm text-xs group-hover:border-hairline-strong"
        >
          View workspace →
        </Link>
      </td>
    </tr>
  );
}

function ProjectsTable({
  projects,
  emptyMessage,
}: {
  projects: ClientPortfolioProject[];
  emptyMessage: string;
}) {
  if (projects.length === 0) {
    return (
      <div className="p-8 text-center text-muted border border-hairline rounded-lg bg-surface">
        <p className="text-body-sm font-medium">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="card border-hairline bg-surface overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-body-sm">
          <thead className="border-b border-hairline bg-surface-strong/30 text-caption font-semibold text-muted">
            <tr>
              <th className="py-3 px-4">Project</th>
              <th className="py-3 px-4">Status</th>
              <th className="py-3 px-4">Priority</th>
              <th className="py-3 px-4">Progress</th>
              <th className="py-3 px-4">Target Date</th>
              <th className="py-3 px-4">Project Manager</th>
              <th className="py-3 px-4 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {projects.map((p) => (
              <ProjectRow key={p.id} project={p} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const principal = await requirePrincipal();
  const { id } = await params;

  let portfolio;
  try {
    portfolio = await getClientPortfolio(principal, id);
  } catch (err: unknown) {
    if (err instanceof NotFoundError) {
      notFound();
    }
    throw err;
  }

  const { client, stats, currentProjects, pastProjects } = portfolio;

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={[
          { label: 'Clients', href: '/pm/clients' },
          { label: client.name },
        ]}
        title={client.name}
        subtitle={
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-surface-strong text-ink">
              {client.refNumber}
            </span>
            <span className="text-muted-soft">·</span>
            <span className="text-caption text-muted">
              {stats.totalCount} project{stats.totalCount === 1 ? '' : 's'} ({stats.activeCount} active, {stats.completedCount} past)
            </span>
          </div>
        }
      />

      {/* Current Projects Section */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink flex items-center gap-2">
            Current Projects
            <span className="badge bg-primary/[0.08] text-primary text-xs font-bold">
              {currentProjects.length}
            </span>
          </h2>
        </div>
        <ProjectsTable
          projects={currentProjects}
          emptyMessage="No active projects for this client."
        />
      </section>

      {/* Past Projects Section */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink flex items-center gap-2">
            Past & Completed Projects
            <span className="badge bg-surface-strong text-muted text-xs font-semibold">
              {pastProjects.length}
            </span>
          </h2>
        </div>
        <ProjectsTable
          projects={pastProjects}
          emptyMessage="No past or completed projects for this client."
        />
      </section>
    </div>
  );
}
