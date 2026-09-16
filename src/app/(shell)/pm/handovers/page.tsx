import { formatName } from '@/core/utils/strings';
import Link from 'next/link';
import { requirePrincipal } from '@/core/auth/session';
import { listHandovers } from '@/modules/project-management/services/handover.service';
import { formatDate } from '@/core/utils/dates';
import { Avatar, Card, EmptyState, PageHeader, PriorityBadge, StatusBadge } from '@/components/ui';
import {
  HandoverDecision,
  HandoverWithdraw,
  ProjectHandoverDecision,
  ProjectHandoverWithdraw,
} from './handover-actions';

export const dynamic = 'force-dynamic';

/**
 * The handover inbox. Tracks both task handovers (peer engineer transfers) and
 * project handovers (manager transfers). Nothing moves until the receiver accepts.
 */
export default async function HandoversPage() {
  const principal = await requirePrincipal();
  const {
    incoming,
    outgoing,
    oversight,
    incomingProjects = [],
    outgoingProjects = [],
    oversightProjects = [],
  } = await listHandovers(principal);

  const totalIncoming = incoming.length + incomingProjects.length;
  const totalOutgoing = outgoing.length + outgoingProjects.length;

  return (
    <>
      <PageHeader
        title="Handovers"
        subtitle="Work and projects passed between team members. Ownership only transfers upon explicit acceptance."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={`Waiting on your decision (${totalIncoming})`}>
          {totalIncoming === 0 ? (
            <EmptyState title="Nothing waiting on you" />
          ) : (
            <div className="space-y-4">
              {/* Project Handovers */}
              {incomingProjects.length > 0 ? (
                <div className="space-y-3">
                  {incomingProjects.map((handover) => (
                    <div key={handover.id} className="rounded-lg border-2 border-primary/30 bg-primary/[0.04] p-3.5 shadow-sm">
                      <div className="mb-2 flex items-start gap-2.5">
                        <Avatar name={formatName(handover.fromUser.fullName)} color={handover.fromUser.avatarColor} size={32} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="badge bg-primary text-white font-semibold text-xs uppercase tracking-wider">Project Handover</span>
                            <PriorityBadge priority={handover.project.priority} />
                          </div>
                          <p className="text-body-sm text-ink font-semibold">
                            <span>{formatName(handover.fromUser.fullName)}</span> wants to transfer project ownership of:
                          </p>
                          <Link href={`/pm/projects/${handover.project.id}`} className="text-base font-bold text-primary hover:underline block mt-0.5">
                            {handover.project.name}
                          </Link>
                          <p className="text-caption text-muted">
                            Client: {handover.project.clientName}
                            {handover.project.targetEndDate ? ` · Target delivery: ${formatDate(handover.project.targetEndDate)}` : ''}
                          </p>
                        </div>
                      </div>

                      {handover.reason ? (
                        <p className="mb-3 rounded border border-hairline bg-surface px-2.5 py-1.5 text-body-sm text-body italic">
                          "{handover.reason}"
                        </p>
                      ) : null}

                      <ProjectHandoverDecision handoverId={handover.id} />
                    </div>
                  ))}
                </div>
              ) : null}

              {/* Task Handovers */}
              {incoming.length > 0 ? (
                <ul className="space-y-3">
                  {incoming.map((handover) => (
                    <li key={handover.id} className="rounded-lg border border-hairline bg-surface p-3">
                      <div className="mb-2 flex items-start gap-2">
                        <Avatar name={formatName(handover.fromUser.fullName)} color={handover.fromUser.avatarColor} />
                        <div className="min-w-0 flex-1">
                          <p className="text-body-sm text-ink">
                            <span className="font-medium">{formatName(handover.fromUser.fullName)}</span> wants to pass you task:{' '}
                            <Link href={`/pm/tasks/${handover.task.id}`} className="font-semibold text-ink hover:underline">
                              {handover.task.title}
                            </Link>
                          </p>
                          <p className="text-caption text-muted">{handover.task.project.name}</p>
                        </div>
                        <PriorityBadge priority={handover.task.priority} />
                      </div>

                      {handover.reason ? (
                        <p className="mb-2 rounded border border-hairline bg-surface-subtle/50 px-2 py-1.5 text-body-sm text-body">
                          {handover.reason}
                        </p>
                      ) : null}

                      <div className="mb-2 flex flex-wrap gap-3 text-caption text-muted">
                        <span>
                          <strong className="text-ink">{handover.remainingPercent}%</strong> remaining
                        </span>
                        <span>
                          ~<strong className="text-ink">{handover.remainingHours}h</strong> of work
                        </span>
                        <span>Due {formatDate(handover.task.plannedEnd)}</span>
                      </div>

                      <HandoverDecision handoverId={handover.id} />
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <Card title={`Raised by you (${totalOutgoing})`}>
            {totalOutgoing === 0 ? (
              <EmptyState title="You have not handed anything over" hint="Task and project handovers you initiate appear here." />
            ) : (
              <ul className="space-y-2.5">
                {/* Outgoing Project Handovers */}
                {outgoingProjects.map((handover) => (
                  <li key={handover.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/25 bg-primary/[0.02] p-2.5">
                    <Avatar name={formatName(handover.toUser.fullName)} color={handover.toUser.avatarColor} size={26} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="badge bg-primary/10 text-primary font-medium text-xs">Project</span>
                        <Link href={`/pm/projects/${handover.project.id}`} className="font-semibold text-body-sm text-ink hover:underline truncate">
                          {handover.project.name}
                        </Link>
                      </div>
                      <p className="text-caption text-muted truncate">
                        Proposed PM: {formatName(handover.toUser.fullName)} {handover.reason ? `· "${handover.reason}"` : ''}
                      </p>
                    </div>
                    <StatusBadge status={handover.status} />
                    {handover.status === 'PENDING' ? <ProjectHandoverWithdraw handoverId={handover.id} /> : null}
                  </li>
                ))}

                {/* Outgoing Task Handovers */}
                {outgoing.map((handover) => (
                  <li key={handover.id} className="flex flex-wrap items-center gap-2 rounded border border-hairline p-2">
                    <Avatar name={formatName(handover.toUser.fullName)} color={handover.toUser.avatarColor} size={24} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-body-sm text-ink">
                        <Link href={`/pm/tasks/${handover.task.id}`} className="font-medium text-ink hover:underline">
                          {handover.task.title}
                        </Link>{' '}
                        → {formatName(handover.toUser.fullName)}
                      </p>
                      <p className="truncate text-caption text-muted">{handover.reason}</p>
                    </div>
                    <StatusBadge status={handover.status} />
                    {handover.status === 'PENDING' ? <HandoverWithdraw handoverId={handover.id} /> : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {oversight.length > 0 || oversightProjects.length > 0 ? (
            <Card title={`In flight on your projects (${oversight.length + oversightProjects.length})`}>
              <ul className="space-y-2">
                {oversightProjects.map((handover) => (
                  <li key={handover.id} className="rounded border border-hairline p-2">
                    <p className="flex flex-wrap items-center gap-1.5 text-body-sm text-ink">
                      <span className="badge bg-primary/10 text-primary text-xs">Project</span>
                      <Link href={`/pm/projects/${handover.project.id}`} className="font-semibold text-ink hover:underline">
                        {handover.project.name}
                      </Link>
                      <span className="text-muted-soft">|</span>
                      <span>{formatName(handover.fromUser.fullName)}</span>
                      <span className="text-muted-soft">→</span>
                      <span>{formatName(handover.toUser.fullName)}</span>
                    </p>
                    {handover.reason ? <p className="mt-0.5 text-caption text-muted">{handover.reason}</p> : null}
                    <div className="mt-2">
                      <ProjectHandoverDecision handoverId={handover.id} asManager />
                    </div>
                  </li>
                ))}

                {oversight.map((handover) => (
                  <li key={handover.id} className="rounded border border-hairline p-2">
                    <p className="flex flex-wrap items-center gap-1.5 text-body-sm text-ink">
                      <span className="font-medium">{formatName(handover.fromUser.fullName)}</span>
                      <span className="text-muted-soft">→</span>
                      <span className="font-medium">{formatName(handover.toUser.fullName)}</span>
                      <Link href={`/pm/tasks/${handover.task.id}`} className="text-body-sm text-ink hover:underline font-medium">
                        {handover.task.title}
                      </Link>
                    </p>
                    <p className="mt-0.5 text-caption text-muted">{handover.reason}</p>
                    <div className="mt-2">
                      <HandoverDecision handoverId={handover.id} asManager />
                    </div>
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
