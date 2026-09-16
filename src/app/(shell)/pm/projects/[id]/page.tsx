import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { prisma } from '@/core/db/prisma';
import { getProjectWorkspace } from '@/modules/project-management/services/project.service';
import { formatDate, daysUntil } from '@/core/utils/dates';
import { Alert, Card, PageHeader, ProgressBar, Stat } from '@/components/ui';
import { WbsTable } from './wbs-table';
import { AddTaskForm } from './add-task-form';
import { TeamPanel } from './team-panel';
import { CompleteProjectButton } from './complete-project-button';
import { HandoverProjectButton } from './handover-project-button';
import { ProjectStatusSelector } from './project-status-selector';
import { ProjectPrioritySelector } from './project-priority-selector';

export const dynamic = 'force-dynamic';

/**
 * The project workspace: the checklist tasks, the schedule and the team, on one
 * screen. This is where a manager spends their day.
 */
export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const principal = await requirePrincipal();
  const { id } = await params;
  let workspace;
  try {
    workspace = await getProjectWorkspace(principal, id);
  } catch {
    notFound();
  }
  const { project, tasks, summary, permissions, criticalTaskIds } = workspace;

  const colleagues = permissions.canAssign || permissions.canManageMembers || permissions.canEditProject
    ? await prisma.user.findMany({
        where: {
          companyId: principal.companyId,
          status: 'ACTIVE',
          id: { not: project.managerId },
          department: { code: { in: ['TECH', 'DESIGN'] } },
          NOT: [
            { designation: { contains: 'Director', mode: 'insensitive' } },
            { grade: 'DIRECTOR' },
          ],
        },
        select: { id: true, fullName: true, designation: true, grade: true, avatarColor: true, skills: true },
        orderBy: { fullName: 'asc' },
      })
    : [];

  const due = daysUntil(project.targetEndDate);

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: 'Projects', href: '/pm/projects' }, { label: project.name }]}
        title={project.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span>{project.clientName}</span>
            <span className="text-muted-soft">·</span>
            
            {project.poNumber ? (
              <>
                <span className="text-muted-soft">·</span>
                <span className="text-caption">PO {project.poNumber}</span>
              </>
            ) : null}
            <ProjectStatusSelector projectId={project.id} currentStatus={project.status} canEdit={permissions.canEditProject} />
            <ProjectPrioritySelector projectId={project.id} currentPriority={project.priority} canEdit={permissions.canEditProject} />
          </span>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/pm/resources?projectId=${project.id}`} className="btn btn-secondary">
              Team load
            </Link>
            {permissions.canManageMembers ? (
              <HandoverProjectButton projectId={project.id} colleagues={colleagues} />
            ) : null}
            {permissions.canCreateTask ? (
              <Link href={`/pm/adhoc?projectId=${project.id}`} className="btn btn-primary">
                Raise ad-hoc task
              </Link>
            ) : null}
          </div>
        }
      />

      {project.status !== 'COMPLETED' && summary.progressPercent === 100 ? (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4">
          <div>
            <p className="font-semibold text-emerald-950">All tasks are 100% complete!</p>
            <p className="text-body-sm text-emerald-800">
              Ready to mark this project completed and notify leadership?
            </p>
          </div>
          <CompleteProjectButton projectId={project.id} />
        </div>
      ) : null}

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
        <Card className="lg:col-span-3" title="Project Tasks & Checklist" bodyClassName="p-0">
          <WbsTable
            tasks={tasks}
            criticalTaskIds={criticalTaskIds}
            projectId={project.id}
            canAssign={permissions.canAssign}
            colleagues={colleagues}
            currentUserId={principal.userId}
          />
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


