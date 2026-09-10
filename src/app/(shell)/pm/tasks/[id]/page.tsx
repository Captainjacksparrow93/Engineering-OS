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
            <span className="font-mono text-xs">{task.code}</span>
            <StatusBadge status={task.status} />
            <PriorityBadge priority={task.priority} />
            {task.type === 'ADHOC' ? <span className="badge bg-fuchsia-100 text-fuchsia-700">ad-hoc</span> : null}
            {task.parent ? (
              <Link href={`/pm/tasks/${task.parent.id}`} className="text-xs text-brand-600 hover:underline">
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
                <Link href={`/pm/tasks/${blocker.predecessorId}`} className="font-mono underline">
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
              <p className="mb-3 whitespace-pre-wrap text-sm text-slate-700">{task.description}</p>
            ) : (
              <p className="mb-3 text-sm italic text-slate-400">No description.</p>
            )}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <p className="label">Planned</p>
                <p className={`text-sm ${due !== null && due < 0 ? 'font-medium text-red-600' : 'text-slate-700'}`}>
                  {formatDate(task.plannedStart)} → {formatDate(task.plannedEnd)}
                </p>
              </div>
              <div>
                <p className="label">Effort</p>
                <p className="text-sm text-slate-700">
                  {Math.round(task.actualHours)}h spent of {Math.round(task.estimatedHours)}h
                </p>
              </div>
              <div>
                <p className="label">Downstream</p>
                <p className="text-sm text-slate-700">{downstreamCount} task(s) wait on this</p>
              </div>
              <div>
                <p className="label">Raised by</p>
                <p className="flex items-center gap-1.5 text-sm text-slate-700">
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
                    <span key={skill} className="badge bg-slate-100 text-slate-600">
                      {skill}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="mt-4 border-t border-surface-border pt-3">
              <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
                <span>Progress</span>
                <span className="font-medium text-slate-700">{task.percentComplete}%</span>
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
                        <Link href={`/pm/tasks/${child.id}`} className="text-sm text-slate-800 hover:text-brand-600">
                          {child.title}
                        </Link>
                        <span className="ml-2 font-mono text-[11px] text-slate-400">{child.code}</span>
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
              <ul className="divide-y divide-surface-border">
                {task.progressLogs.map((log) => (
                  <li key={log.id} className="flex gap-3 px-4 py-3">
                    <Avatar name={log.user.fullName} color={log.user.avatarColor} size={26} />
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-medium text-slate-800">{log.user.fullName}</span>
                        <span className="badge bg-brand-50 text-brand-700">{log.percentComplete}%</span>
                        {log.hoursSpent > 0 ? <span className="text-xs text-slate-500">{log.hoursSpent}h</span> : null}
                        <span className="text-xs text-slate-400">{formatDate(log.loggedFor)}</span>
                      </p>
                      <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-600">{log.note}</p>
                      {log.blocker ? (
                        <p className="mt-1 rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700">
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
                      <p className="truncate text-sm font-medium text-slate-800">{assignment.user.fullName}</p>
                      <p className="truncate text-[11px] text-slate-500">
                        {assignment.role.toLowerCase()} · {Math.round(assignment.allocatedHours)}h allocated
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {pastAssignments.length > 0 ? (
              <div className="mt-3 border-t border-surface-border pt-3">
                <p className="label">Previously</p>
                <ul className="space-y-1.5">
                  {pastAssignments.map((assignment) => (
                    <li key={assignment.id} className="flex items-center gap-2 text-xs text-slate-500">
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
                  <li key={handover.id} className="rounded-md border border-surface-border p-2">
                    <p className="flex items-center gap-1.5 text-xs">
                      <Avatar name={handover.fromUser.fullName} color={handover.fromUser.avatarColor} size={16} />
                      <span className="text-slate-600">{handover.fromUser.fullName}</span>
                      <span className="text-slate-400">→</span>
                      <Avatar name={handover.toUser.fullName} color={handover.toUser.avatarColor} size={16} />
                      <span className="text-slate-600">{handover.toUser.fullName}</span>
                      <StatusBadge status={handover.status} className="ml-auto" />
                    </p>
                    <p className="mt-1 text-xs text-slate-500">{handover.reason}</p>
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
