import { requirePrincipal } from '@/core/auth/session';
import { formatDate } from '@/core/utils/dates';
import { formatMinutes, istMinutes } from '@/modules/hrms/domain/time';
import { leaveBalances, leaveToDecide } from '@/modules/hrms/services/leave.service';
import { regularisationsToDecide } from '@/modules/hrms/services/attendance.service';
import { decideLeaveAction, decideRegularisationAction } from '@/app/actions/hrms';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { DecisionForm } from '../_components/decision-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'HR approvals' };

/** Leave and attendance corrections waiting on the principal: as reporting manager, department head or HR. */
export default async function ApprovalsPage() {
  const principal = await requirePrincipal();
  const [leave, corrections] = await Promise.all([leaveToDecide(principal), regularisationsToDecide(principal)]);
  const balances = new Map(
    await Promise.all(leave.map(async (r) => [r.id, (await leaveBalances(principal.companyId, r.userId, r.startDate.getUTCFullYear())).find((b) => b.type.id === r.leaveType.id)] as const)),
  );

  return (
    <div className="space-y-lg">
      <PageHeader title="HR approvals" subtitle="Leave and attendance corrections waiting for you. The employee is told your answer and any note." />

      <Card title={`Leave (${leave.length})`}>
        {leave.length === 0 ? (
          <EmptyState title="No leave waiting for you" />
        ) : (
          <ul className="divide-y divide-hairline-soft">
            {leave.map((r) => {
              const b = balances.get(r.id);
              return (
                <li key={r.id} className="space-y-sm py-base first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-xs">
                    <p className="text-body-md text-ink">
                      <strong>{r.user.fullName}</strong> <span className="text-muted">· {r.user.department?.name ?? 'No department'}</span>
                    </p>
                    <span className="badge badge-outline">{r.status === 'PENDING_MANAGER' ? 'As reporting manager' : 'As department head'}</span>
                  </div>
                  <p className="text-body-sm">
                    {r.leaveType.name}{r.halfDay ? ' (half day)' : ''}: {formatDate(r.startDate, { forceYear: true })}
                    {r.endDate.getTime() !== r.startDate.getTime() ? ` to ${formatDate(r.endDate, { forceYear: true })}` : ''}, {Number(r.days)} day{Number(r.days) === 1 ? '' : 's'}
                    {b?.left != null ? <span className="text-muted"> · {b.left + Number(r.days)} left before this</span> : null}
                  </p>
                  <p className="text-body-sm text-muted">“{r.reason}”{r.managerBy ? ` · Manager ${r.managerBy.fullName} approved${r.managerNote ? `: “${r.managerNote}”` : ''}` : ''}</p>
                  <DecisionForm action={decideLeaveAction} id={r.id} />
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card title={`Attendance corrections (${corrections.length})`}>
        {corrections.length === 0 ? (
          <EmptyState title="No corrections waiting for you" />
        ) : (
          <ul className="divide-y divide-hairline-soft">
            {corrections.map((c) => (
              <li key={c.id} className="space-y-sm py-base first:pt-0 last:pb-0">
                <p className="text-body-md text-ink"><strong>{c.user.fullName}</strong> <span className="text-muted">· {formatDate(c.date, { forceYear: true })}: in {formatMinutes(istMinutes(c.firstIn))}, out {formatMinutes(istMinutes(c.lastOut))}</span></p>
                <p className="text-body-sm text-muted">“{c.reason}”</p>
                <DecisionForm action={decideRegularisationAction} id={c.id} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
