import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { prisma } from '@/core/db/prisma';
import { getProjectWorkspace, getProjectTimeline } from '@/modules/project-management/services/project.service';
import { TECHNICAL_DEPARTMENT_CODES } from '@/modules/project-management/domain/constants';
import { can } from '@/core/rbac/engine';
import { formatDate, daysUntil } from '@/core/utils/dates';
import { Alert, Card, PageHeader, ProgressBar, Stat, StatusBadge, PriorityBadge } from '@/components/ui';
import { ProjectTimeline } from '@/components/project-timeline';
import { WbsTable } from './wbs-table';
import { AddTaskForm } from './add-task-form';
import { TeamPanel } from './team-panel';
import { CompleteProjectButton } from './complete-project-button';
import { HandoverProjectButton } from './handover-project-button';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await prisma.project.findUnique({ where: { id }, select: { name: true } });
  return {
    title: `${project?.name || 'Project'} · Engineering OS`,
  };
}

/**
 * The project workspace: the checklist tasks, the schedule and the team, on one
 * screen. This is where a manager spends their day.
 */
export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const principal = await requirePrincipal();
  const { id } = await params;

  let workspace;
  let timeline;
  try {
    [workspace, timeline] = await Promise.all([
      getProjectWorkspace(principal, id),
      getProjectTimeline(principal, id),
    ]);
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
          department: { code: { in: [...TECHNICAL_DEPARTMENT_CODES] } },
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
  const allLeafClosed = tasks
    .filter((t) => t.type !== 'PHASE' && !tasks.some((c) => c.parentId === t.id))
    .every((t) => t.status === 'COMPLETED' || t.status === 'CANCELLED');

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
                <span className="text-caption text-muted">PO {project.poNumber}</span>
                <span className="text-muted-soft">·</span>
              </>
            ) : null}
            <StatusBadge status={project.status} />
            <PriorityBadge priority={project.priority} />
          </span>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/pm/resources?projectId=${project.id}`} className="btn btn-secondary text-body-sm">
              Team load
            </Link>
            {permissions.canManageMembers ? (
              <HandoverProjectButton projectId={project.id} colleagues={colleagues} />
            ) : null}
            {permissions.canCreateTask ? (
              <Link href={`/pm/adhoc?projectId=${project.id}`} className="btn btn-primary text-body-sm">
                Add urgent task
              </Link>
            ) : null}
          </div>
        }
      />

      {/* Interactive Project Visual Timeline */}
      <ProjectTimeline data={timeline} className="mb-6" />

      {/* Completion Banner */}
      {project.status !== 'COMPLETED' && allLeafClosed ? (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-success/30 bg-success/[0.08] p-4 text-ink">
          <div>
            <p className="font-semibold text-ink">All tasks are completed!</p>
            <p className="text-body-sm text-muted">
              Ready to mark this project completed and notify leadership?
            </p>
          </div>
          {permissions.canEditProject ? (
            <CompleteProjectButton projectId={project.id} />
          ) : null}
        </div>
      ) : null}

      {/* 4 Stat Cards without hours */}
      <div className="mb-5 grid gap-3 grid-cols-2 sm:grid-cols-4">
        <Stat
          label="Progress"
          value={`${summary.progressPercent}%`}
          hint={`${summary.completedCount}/${summary.taskCount} tasks done`}
        />
        <Stat label="Open tasks" value={summary.openCount} />
        <Stat
          label="Blocked"
          value={summary.blockedCount}
          tone={summary.blockedCount ? 'danger' : 'success'}
        />
        <Stat
          label="Overdue"
          value={summary.overdueCount}
          tone={summary.overdueCount ? 'danger' : 'success'}
        />
      </div>

      {workspace.scheduleError ? (
        <div className="mb-4">
          <Alert tone="danger">Schedule could not be computed: {workspace.scheduleError}</Alert>
        </div>
      ) : null}

      {/* Main Grid: Checklist & Details Sidebar */}
      <div className="mb-5 grid gap-4 lg:grid-cols-4">
        <Card className="lg:col-span-3" title="Project Deliverables & Tasks" bodyClassName="p-0">
          <WbsTable
            tasks={tasks}
            criticalTaskIds={criticalTaskIds}
            projectId={project.id}
            canAssign={permissions.canAssign}
            colleagues={colleagues}
            currentUserId={principal.userId}
          />
        </Card>

        <div className="space-y-4">
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
              {project.orderValue && (permissions.canEditProject || can(principal, 'pm.oversight')) ? (
                <div className="flex justify-between gap-2">
                  <dt className="text-muted">Order value</dt>
                  <dd className="font-medium font-mono">₹{Number(project.orderValue).toLocaleString('en-IN')}</dd>
                </div>
              ) : null}
            </dl>
            <div className="mt-3 border-t border-hairline pt-3">
              <p className="text-caption uppercase tracking-wide text-muted">Overall progress</p>
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
