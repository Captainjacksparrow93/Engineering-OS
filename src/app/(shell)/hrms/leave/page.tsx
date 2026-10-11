import Link from 'next/link';
import { requirePrincipal } from '@/core/auth/session';
import { formatDate, todayInIndia } from '@/core/utils/dates';
import { LEAVE_STATUS_BADGE, LEAVE_STATUS_LABEL } from '@/modules/hrms/domain/labels';
import { dayKey } from '@/modules/hrms/domain/time';
import { listHolidays, myLeave } from '@/modules/hrms/services/leave.service';
import { applyLeaveAction, cancelLeaveAction } from '@/app/actions/hrms';
import { ActionForm } from '@/components/action-form';
import { SubmitButton } from '@/components/form';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { RowButton } from '../_components/row-button';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'My leave' };

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** Every employee: balances, apply, and the state of each request. */
export default async function MyLeavePage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const principal = await requirePrincipal();
  const today = todayInIndia();
  const thisYear = today.getUTCFullYear();
  const sp = await searchParams;
  const year = Number(sp.year) >= 2000 && Number(sp.year) <= 2100 ? Number(sp.year) : thisYear;
  const [{ balances, requests }, holidays] = await Promise.all([myLeave(principal, year), listHolidays(principal, year)]);
  const upcomingHolidays = holidays.filter((h) => h.date >= today).slice(0, 6);

  return (
    <div className="space-y-lg">
      <PageHeader
        title="My leave"
        subtitle="Apply for leave. Your reporting manager approves it first, then your department head."
        actions={
          <div className="flex gap-xs">
            <Link href={`/hrms/leave?year=${year - 1}`} className="btn btn-secondary btn-sm">{year - 1}</Link>
            {year !== thisYear ? <Link href="/hrms/leave" className="btn btn-secondary btn-sm">This year</Link> : null}
            <Link href={`/hrms/leave?year=${year + 1}`} className="btn btn-secondary btn-sm">{year + 1}</Link>
          </div>
        }
      />

      <div className="grid gap-base sm:grid-cols-2 lg:grid-cols-4">
        {balances.map((b) => (
          <div key={b.type.id} className="stat">
            <p className="stat-label">{b.type.name} {year}</p>
            <p className="stat-value">{b.left === null ? 'No limit' : fmt(b.left)}<span className="text-body-sm text-muted">{b.left === null ? '' : ' left'}</span></p>
            <p className="mt-xxs text-caption text-muted">
              {b.entitled === null ? 'Unpaid' : `${fmt(b.entitled)} a year`} · {fmt(b.used)} taken{b.pending ? ` · ${fmt(b.pending)} waiting` : ''}
            </p>
          </div>
        ))}
      </div>

      <div className="grid gap-lg lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className="space-y-lg">
          <Card title="Apply for leave">
            <ActionForm action={applyLeaveAction} resetOnSuccess className="space-y-base">
              <div>
                <label className="label" htmlFor="lv-type">Leave type</label>
                <select id="lv-type" name="leaveTypeId" required defaultValue="" className="select w-full">
                  <option value="" disabled>Pick a type</option>
                  {balances.map((b) => (
                    <option key={b.type.id} value={b.type.id}>{b.type.name}{b.left === null ? '' : ` (${fmt(b.left)} left)`}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-base">
                <div>
                  <label className="label" htmlFor="lv-start">First day</label>
                  <input id="lv-start" name="startDate" type="date" required defaultValue={dayKey(today)} className="input w-full" />
                </div>
                <div>
                  <label className="label" htmlFor="lv-end">Last day</label>
                  <input id="lv-end" name="endDate" type="date" className="input w-full" />
                </div>
              </div>
              <label className="flex items-center gap-xs text-body-sm">
                <input type="checkbox" name="halfDay" /> Half day (one day only)
              </label>
              <div>
                <label className="label" htmlFor="lv-reason">Reason</label>
                <input id="lv-reason" name="reason" required minLength={3} maxLength={300} className="input w-full" placeholder="e.g. Family function" />
              </div>
              <p className="hint">Leave the last day empty for a single day. Sundays and holidays are not counted.</p>
              <SubmitButton variant="primary" pendingLabel="Applying…">Apply</SubmitButton>
            </ActionForm>
          </Card>

          <Card title="Coming holidays">
            {upcomingHolidays.length === 0 ? (
              <p className="text-body-sm text-muted">No more holidays listed for {year}.</p>
            ) : (
              <ul className="space-y-xs text-body-sm">
                {upcomingHolidays.map((h) => (
                  <li key={h.id} className="flex justify-between gap-base"><span className="text-ink">{h.name}</span><span className="text-muted">{formatDate(h.date, { forceYear: true })}</span></li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <Card title={`My requests in ${year}`}>
          {requests.length === 0 ? (
            <EmptyState title="No leave yet" hint="Requests you make show here with where they are in approval." />
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead><tr><th>Dates</th><th>Type</th><th>Days</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {requests.map((r) => {
                    const cancellable = r.status === 'PENDING_MANAGER' || r.status === 'PENDING_HEAD' || (r.status === 'APPROVED' && r.startDate > today);
                    const note = r.headNote ?? r.managerNote;
                    return (
                      <tr key={r.id}>
                        <td className="whitespace-nowrap">
                          {formatDate(r.startDate)}{r.endDate.getTime() !== r.startDate.getTime() ? ` to ${formatDate(r.endDate)}` : ''}
                          <span className="block max-w-[16rem] truncate text-caption text-muted" title={r.reason}>{r.reason}</span>
                        </td>
                        <td>{r.leaveType.name}{r.halfDay ? ' (half)' : ''}</td>
                        <td>{fmt(Number(r.days))}</td>
                        <td>
                          <span className={`badge ${LEAVE_STATUS_BADGE[r.status]}`}>{LEAVE_STATUS_LABEL[r.status]}</span>
                          {note ? <span className="block text-caption text-muted">“{note}”</span> : null}
                        </td>
                        <td className="text-right">{cancellable ? <RowButton action={cancelLeaveAction} name="id" value={r.id} label="Cancel" confirm="Cancel this leave?" /> : null}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
