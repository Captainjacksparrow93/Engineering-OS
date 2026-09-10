import Link from 'next/link';
import { requirePrincipal } from '@/core/auth/session';
import { prisma } from '@/core/db/prisma';
import { getTaskDetail } from '@/modules/project-management/services/task.service';
import { handoverCandidates, peersForHandover } from '@/modules/project-management/services/availability.service';
import { formatDate, daysUntil } from '@/core/utils/dates';
import { Alert, Avatar, Card, PageHeader, PriorityBadge, ProgressBar, StatusBadge } from '@/components/ui';
import { ProgressForm } from './progress-form';
import { HandoverForm } from './handover-form';
import { TaskControls } from './task-controls';
import { DependencyPanel } from './dependency-panel';
import { CommentBox } from './comment-box';

export const dynamic = 'force-dynamic';

/** Everything about one task, and every action anyone is allowed to take on it. */
export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const principal = await requirePrincipal();
  const { id } = await params;
  const { task, blockers, downstreamCount, permissions } = await getTaskDetail(principal, id);

  const [candidates, peers, projectTasks, assignableUsers] = await Promise.all([
    permissions.canHandover ? handoverCandidates(principal, task.id) : Promise.resolve([]),
    permissions.canHandover ? peersForHandover(principal, task.id) : Promise.resolve([]),
    permissions.canManageDependencies
      ? prisma.task.findMany({
          where: { projectId: task.projectId, id: { not: task.id } },
          select: { id: true, code: true, title: true },
          orderBy: { code: 'asc' },
        })
      : Promise.resolve([]),
    permissions.canAssign
      ? prisma.user.findMany({
          where: { companyId: principal.companyId, status: 'ACTIVE' },
          select: { id: true, fullName: true, designation: true },
          orderBy: { fullName: 'asc' },
        })
      : Promise.resolve([]),
  ]);

  const activeAssignments = task.assignments.filter((a) => a.status === 'ACTIVE');
  const pastAssignments = task.assignments.filter((a) => a.status !== 'ACTIVE');
  const pendingHandover = task.handovers.find((h) => h.status === 'PENDING');
  const due = daysUntil(task.plannedEnd);

  return (
    <>
      <PageHeader
        breadcrumb={[
          { label: 'Projects', href: '/pm/projects' },
          { label: task.project.code, href: `/pm/projects/${task.project.id}` },
          { label: task.code },
        ]}
        title={task.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span className="code text-caption">{task.code}</span>
            <StatusBadge status={task.status} />
            <PriorityBadge priority={task.priority} />
            {task.type === 'ADHOC' ? <span className="badge bg-surface-strong text-ink">ad-hoc</span> : null}
            {task.parent ? (
              <Link href={`/pm/tasks/${task.parent.id}`} className="text-caption text-ink hover:underline">
                under {task.parent.code}
              </Link>
            ) : null}
          </span>
        }
      />

      {blockers.length > 0 ? (
        <div className="mb-4">
          <Alert tone="danger">
            <strong>Blocked.</strong> Waiting on{' '}
            {blockers.map((blocker, index) => (
              <span key={blocker.predecessorId}>
                {index > 0 ? ', ' : ''}
                <Link href={`/pm/tasks/${blocker.predecessorId}`} className="code underline">
                  {blocker.predecessorCode}
                </Link>{' '}
                ({blocker.reason})
              </span>
            ))}
            .
          </Alert>
        </div>
      ) : null}

      {pendingHandover ? (
        <div className="mb-4">
          <Alert tone="warning">
            Handover pending: <strong>{pendingHandover.fromUser.fullName}</strong> →{' '}
            <strong>{pendingHandover.toUser.fullName}</strong> ({pendingHandover.remainingPercent}% remaining).{' '}
            <Link href="/pm/handovers" className="underline">
              Open handovers
            </Link>
          </Alert>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Details">
            {task.description ? (
              <p className="mb-3 whitespace-pre-wrap text-body-sm text-ink">{task.description}</p>
            ) : (
              <p className="mb-3 text-body-sm italic text-muted-soft">No description.</p>
            )}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <p className="label">Planned</p>
                <p className={`text-body-sm ${due !== null && due < 0 ? 'font-medium text-error' : 'text-ink'}`}>
                  {formatDate(task.plannedStart)} → {formatDate(task.plannedEnd)}
                </p>
              </div>
              <div>
                <p className="label">Effort</p>
                <p className="text-body-sm text-ink">
                  {Math.round(task.actualHours)}h spent of {Math.round(task.estimatedHours)}h
                </p>
              </div>
              <div>
                <p className="label">Downstream</p>
                <p className="text-body-sm text-ink">{downstreamCount} task(s) wait on this</p>
              </div>
              <div>
                <p className="label">Raised by</p>
                <p className="flex items-center gap-1.5 text-body-sm text-ink">
                  <Avatar name={task.createdBy.fullName} color={task.createdBy.avatarColor} size={18} />
                  {task.createdBy.fullName}
                </p>
              </div>
            </div>

            {task.requiredSkills.length ? (
              <div className="mt-3">
                <p className="label">Skills needed</p>
                <div className="flex flex-wrap gap-1">
                  {task.requiredSkills.map((skill) => (
                    <span key={skill} className="badge bg-surface-strong text-body">
                      {skill}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="mt-4 border-t border-hairline pt-3">
              <div className="mb-1 flex items-center justify-between text-caption text-muted">
                <span>Progress</span>
                <span className="font-medium text-ink">{task.percentComplete}%</span>
              </div>
              <ProgressBar value={task.percentComplete} tone={task.status === 'BLOCKED' ? 'danger' : undefined} />
            </div>
          </Card>

          {task.children.length > 0 ? (
            <Card title={`Subtasks (${task.children.length})`} bodyClassName="p-0">
              <table className="table">
                <tbody>
                  {task.children.map((child) => (
                    <tr key={child.id}>
                      <td>
                        <Link href={`/pm/tasks/${child.id}`} className="text-body-sm text-ink hover:text-ink">
                          {child.title}
                        </Link>
                        <span className="code ml-2 text-caption text-muted-soft">{child.code}</span>
                      </td>
                      <td className="w-28">
                        <ProgressBar value={child.percentComplete} />
                      </td>
                      <td className="w-24">
                        <StatusBadge status={child.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ) : null}

          {permissions.canLogProgress && task.children.length === 0 ? (
            <ProgressForm taskId={task.id} currentPercent={task.percentComplete} />
          ) : null}

          <Card title="Progress history" bodyClassName={task.progressLogs.length ? 'p-0' : undefined}>
            {task.progressLogs.length === 0 ? (
              <p className="muted">Nothing logged yet.</p>
            ) : (
              <ul className="divide-y divide-hairline">
                {task.progressLogs.map((log) => (
                  <li key={log.id} className="flex gap-3 px-4 py-3">
                    <Avatar name={log.user.fullName} color={log.user.avatarColor} size={26} />
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 text-body-sm">
                        <span className="font-medium text-ink">{log.user.fullName}</span>
                        <span className="badge bg-canvas-soft text-ink">{log.percentComplete}%</span>
                        {log.hoursSpent > 0 ? <span className="text-caption text-muted">{log.hoursSpent}h</span> : null}
                        <span className="text-caption text-muted-soft">{formatDate(log.loggedFor)}</span>
                      </p>
                      <p className="mt-0.5 whitespace-pre-wrap text-body-sm text-body">{log.note}</p>
                      {log.blocker ? (
                        <p className="mt-1 rounded border border-error/30 bg-error/[0.06] px-2 py-1 text-caption text-error">
                          Blocker: {log.blocker}
                        </p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <CommentBox taskId={task.id} comments={task.comments} />
        </div>

        <div className="space-y-4">
          <TaskControls
            task={{ id: task.id, status: task.status, projectId: task.project.id }}
            permissions={permissions}
            assignableUsers={assignableUsers}
          />

          <Card title="Who is on this">
            {activeAssignments.length === 0 ? (
              <p className="muted">Nobody is holding this task.</p>
            ) : (
              <ul className="space-y-2">
                {activeAssignments.map((assignment) => (
                  <li key={assignment.id} className="flex items-center gap-2">
                    <Avatar name={assignment.user.fullName} color={assignment.user.avatarColor} size={26} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-body-sm font-medium text-ink">{assignment.user.fullName}</p>
                      <p className="truncate text-caption text-muted">
                        {assignment.role.toLowerCase()} · {Math.round(assignment.allocatedHours)}h allocated
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {pastAssignments.length > 0 ? (
              <div className="mt-3 border-t border-hairline pt-3">
                <p className="label">Previously</p>
                <ul className="space-y-1.5">
                  {pastAssignments.map((assignment) => (
                    <li key={assignment.id} className="flex items-center gap-2 text-caption text-muted">
                      <Avatar name={assignment.user.fullName} color={assignment.user.avatarColor} size={18} />
                      <span className="flex-1 truncate">{assignment.user.fullName}</span>
                      <StatusBadge status={assignment.status} />
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Card>

          {permissions.canHandover && !pendingHandover && !['COMPLETED', 'CANCELLED'].includes(task.status) ? (
            <HandoverForm
              taskId={task.id}
              remainingPercent={100 - task.percentComplete}
              candidates={candidates.map((c) => ({
                id: c.workload.person.id,
                fullName: c.workload.person.fullName,
                designation: c.workload.person.designation,
                score: c.score,
                freeHours: c.workload.freeHours,
                status: c.workload.status,
                matchedSkills: c.matchedSkills,
              }))}
              fallbackPeers={peers.map((p) => ({ id: p.id, fullName: p.fullName, designation: p.designation }))}
            />
          ) : null}

          <DependencyPanel
            taskId={task.id}
            canManage={permissions.canManageDependencies}
            dependencies={task.dependencies}
            dependents={task.dependents}
            projectTasks={projectTasks}
          />

          {task.handovers.length > 0 ? (
            <Card title="Handover history">
              <ul className="space-y-2">
                {task.handovers.map((handover) => (
                  <li key={handover.id} className="rounded-md border border-hairline p-2">
                    <p className="flex items-center gap-1.5 text-caption">
                      <Avatar name={handover.fromUser.fullName} color={handover.fromUser.avatarColor} size={16} />
                      <span className="text-body">{handover.fromUser.fullName}</span>
                      <span className="text-muted-soft">→</span>
                      <Avatar name={handover.toUser.fullName} color={handover.toUser.avatarColor} size={16} />
                      <span className="text-body">{handover.toUser.fullName}</span>
                      <StatusBadge status={handover.status} className="ml-auto" />
                    </p>
                    <p className="mt-1 text-caption text-muted">{handover.reason}</p>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
