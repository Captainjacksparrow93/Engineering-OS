import Link from 'next/link';
import { requirePrincipal } from '@/core/auth/session';
import { listHandovers } from '@/modules/project-management/services/handover.service';
import { formatDate } from '@/core/utils/dates';
import { Avatar, Card, EmptyState, PageHeader, PriorityBadge, StatusBadge } from '@/components/ui';
import { HandoverDecision, HandoverWithdraw } from './handover-actions';

export const dynamic = 'force-dynamic';

/**
 * The handover inbox. Three lists, because three different people care: what is
 * waiting on me, what I have passed on, and - for managers - what is in flight on
 * projects I own.
 */
export default async function HandoversPage() {
  const principal = await requirePrincipal();
  const { incoming, outgoing, oversight } = await listHandovers(principal);

  return (
    <>
      <PageHeader
        title="Handovers"
        subtitle="Work passed between peers. Nothing moves until the receiving engineer accepts."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={`Waiting on your decision (${incoming.length})`}>
          {incoming.length === 0 ? (
            <EmptyState title="Nothing waiting on you" />
          ) : (
            <ul className="space-y-3">
              {incoming.map((handover) => (
                <li key={handover.id} className="rounded-lg border border-amber-200 bg-amber-50/60 p-3">
                  <div className="mb-2 flex items-start gap-2">
                    <Avatar name={handover.fromUser.fullName} color={handover.fromUser.avatarColor} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-slate-800">
                        <span className="font-medium">{handover.fromUser.fullName}</span> wants to pass you{' '}
                        <Link href={`/pm/tasks/${handover.task.id}`} className="font-mono text-brand-600 hover:underline">
                          {handover.task.code}
                        </Link>
                      </p>
                      <p className="text-sm text-slate-600">{handover.task.title}</p>
                    </div>
                    <PriorityBadge priority={handover.task.priority} />
                  </div>

                  <p className="mb-2 rounded border border-surface-border bg-white px-2 py-1.5 text-sm text-slate-600">
                    {handover.reason}
                  </p>

                  <div className="mb-2 flex flex-wrap gap-3 text-xs text-slate-500">
                    <span>
                      <strong className="text-slate-700">{handover.remainingPercent}%</strong> remaining
                    </span>
                    <span>
                      ~<strong className="text-slate-700">{handover.remainingHours}h</strong> of work
                    </span>
                    <span>Due {formatDate(handover.task.plannedEnd)}</span>
                    <span>{handover.task.project.code}</span>
                  </div>

                  <HandoverDecision handoverId={handover.id} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-4">
          <Card title={`Raised by you (${outgoing.length})`}>
            {outgoing.length === 0 ? (
              <EmptyState title="You have not handed anything over" hint="Open a task you hold and choose 'Hand remaining work to a peer'." />
            ) : (
              <ul className="space-y-2">
                {outgoing.map((handover) => (
                  <li key={handover.id} className="flex flex-wrap items-center gap-2 rounded border border-surface-border p-2">
                    <Avatar name={handover.toUser.fullName} color={handover.toUser.avatarColor} size={24} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-slate-800">
                        <Link href={`/pm/tasks/${handover.task.id}`} className="font-mono text-xs text-brand-600 hover:underline">
                          {handover.task.code}
                        </Link>{' '}
                        → {handover.toUser.fullName}
                      </p>
                      <p className="truncate text-[11px] text-slate-500">{handover.reason}</p>
                    </div>
                    <StatusBadge status={handover.status} />
                    {handover.status === 'PENDING' ? <HandoverWithdraw handoverId={handover.id} /> : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {oversight.length > 0 ? (
            <Card title={`In flight on your projects (${oversight.length})`}>
              <ul className="space-y-2">
                {oversight.map((handover) => (
                  <li key={handover.id} className="rounded border border-surface-border p-2">
                    <p className="flex flex-wrap items-center gap-1.5 text-sm text-slate-700">
                      <span className="font-medium">{handover.fromUser.fullName}</span>
                      <span className="text-slate-400">→</span>
                      <span className="font-medium">{handover.toUser.fullName}</span>
                      <Link href={`/pm/tasks/${handover.task.id}`} className="font-mono text-xs text-brand-600 hover:underline">
                        {handover.task.code}
                      </Link>
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">{handover.reason}</p>
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
