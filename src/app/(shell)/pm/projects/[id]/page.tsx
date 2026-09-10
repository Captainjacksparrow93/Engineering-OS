import Link from 'next/link';
import { requirePrincipal } from '@/core/auth/session';
import { prisma } from '@/core/db/prisma';
import { getProjectWorkspace } from '@/modules/project-management/services/project.service';
import { formatDate, daysUntil } from '@/core/utils/dates';
import { Alert, Card, PageHeader, PriorityBadge, ProgressBar, Stat, StatusBadge } from '@/components/ui';
import { WbsTable } from './wbs-table';
import { AddTaskForm } from './add-task-form';
import { TeamPanel } from './team-panel';

export const dynamic = 'force-dynamic';

/**
 * The project workspace: the WBS, the dependency-aware schedule and the team, on one
 * screen. This is where a manager spends their day.
 */
export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const principal = await requirePrincipal();
  const { id } = await params;
  const workspace = await getProjectWorkspace(principal, id);
  const { project, tasks, summary, permissions, criticalTaskIds } = workspace;

  const colleagues = permissions.canAssign
    ? await prisma.user.findMany({
        where: { companyId: principal.companyId, status: 'ACTIVE' },
        select: { id: true, fullName: true, designation: true, grade: true, avatarColor: true, skills: true },
        orderBy: { fullName: 'asc' },
      })
    : [];

  const due = daysUntil(project.targetEndDate);

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: 'Projects', href: '/pm/projects' }, { label: project.code }]}
        title={project.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span>{project.clientName}</span>
            <span className="text-muted-soft">·</span>
            <span className="code text-caption">{project.code}</span>
            {project.poNumber ? (
              <>
                <span className="text-muted-soft">·</span>
                <span className="text-caption">PO {project.poNumber}</span>
              </>
            ) : null}
            <StatusBadge status={project.status} />
            <PriorityBadge priority={project.priority} />
          </span>
        }
        actions={
          <>
            <Link href={`/pm/resources?projectId=${project.id}`} className="btn btn-secondary">
              Team load
            </Link>
            {permissions.canCreateTask ? (
              <Link href={`/pm/adhoc?projectId=${project.id}`} className="btn btn-primary">
                Raise ad-hoc task
              </Link>
            ) : null}
          </>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Progress" value={`${summary.progressPercent}%`} hint={`${summary.completedCount}/${summary.taskCount} tasks done`} />
        <Stat label="Open tasks" value={summary.openCount} />
        <Stat label="Blocked" value={summary.blockedCount} tone={summary.blockedCount ? 'danger' : 'success'} />
        <Stat label="Overdue" value={summary.overdueCount} tone={summary.overdueCount ? 'danger' : 'success'} />
        <Stat
          label="Effort"
          value={`${summary.actualHours}/${summary.estimatedHours}h`}
          tone={summary.actualHours > summary.estimatedHours ? 'warning' : 'default'}
          hint="Actual vs estimated"
        />
      </div>

      {workspace.scheduleError ? (
        <div className="mb-4">
          <Alert tone="danger">Schedule could not be computed: {workspace.scheduleError}</Alert>
        </div>
      ) : null}

      <div className="mb-5 grid gap-3 lg:grid-cols-4">
        <Card className="lg:col-span-3" title="Work breakdown structure" bodyClassName="p-0">
          <WbsTable tasks={tasks} criticalTaskIds={criticalTaskIds} />
        </Card>

        <div className="space-y-3">
          <Card title="Delivery">
            <dl className="space-y-2 text-body-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-muted">Kick-off</dt>
                <dd className="font-medium">{formatDate(project.startDate)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted">Target</dt>
                <dd className={due !== null && due < 0 ? 'font-medium text-error' : 'font-medium'}>
                  {formatDate(project.targetEndDate)}
                </dd>
              </div>
              {due !== null ? (
                <div className="flex justify-between gap-2">
                  <dt className="text-muted">Time left</dt>
                  <dd className={due < 0 ? 'font-medium text-error' : 'font-medium'}>
                    {due < 0 ? `${-due} days late` : `${due} days`}
                  </dd>
                </div>
              ) : null}
              {project.panelType ? (
                <div className="flex justify-between gap-2">
                  <dt className="text-muted">Panels</dt>
                  <dd className="text-right font-medium">{project.panelCount} · {project.panelType}</dd>
                </div>
              ) : null}
              {project.orderValue ? (
                <div className="flex justify-between gap-2">
                  <dt className="text-muted">Order value</dt>
                  <dd className="font-medium">₹{Number(project.orderValue).toLocaleString('en-IN')}</dd>
                </div>
              ) : null}
            </dl>
            <div className="mt-3 border-t border-hairline pt-3">
              <p className="text-caption uppercase tracking-wide text-muted-soft">Overall</p>
              <ProgressBar className="mt-1.5" value={summary.progressPercent} />
            </div>
          </Card>

          <TeamPanel
            projectId={project.id}
            members={project.members}
            canManage={permissions.canManageMembers}
            colleagues={colleagues}
          />
        </div>
      </div>

      {permissions.canCreateTask ? (
        <AddTaskForm
          projectId={project.id}
          tasks={tasks.map((t) => ({ id: t.id, code: t.code, title: t.title, type: t.type }))}
          people={colleagues}
        />
      ) : null}
    </>
  );
}
