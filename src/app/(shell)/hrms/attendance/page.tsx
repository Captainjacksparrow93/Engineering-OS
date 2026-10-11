import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { NotFoundError } from '@/core/rbac/errors';
import { addDays, formatDate, todayInIndia } from '@/core/utils/dates';
import { DAY_STATUS_BADGE, DAY_STATUS_LABEL, monthLabel } from '@/modules/hrms/domain/labels';
import { dayKey, formatDuration, formatMinutes, istMinutes } from '@/modules/hrms/domain/time';
import { monthAttendance, monthRange } from '@/modules/hrms/services/attendance.service';
import { requestRegularisationAction } from '@/app/actions/hrms';
import { ActionForm } from '@/components/action-form';
import { SubmitButton } from '@/components/form';
import { Card, PageHeader, Stat } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Attendance' };

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const WEEKDAY = new Intl.DateTimeFormat('en-IN', { weekday: 'short', timeZone: 'UTC' });
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const shift = (month: string, by: number) => {
  const d = new Date(`${month}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + by);
  return d.toISOString().slice(0, 7);
};

/** One month of attendance: your own, or (HR, Directors, department heads) a team member's. */
export default async function AttendancePage({ searchParams }: { searchParams: Promise<{ month?: string; user?: string }> }) {
  const principal = await requirePrincipal();
  const sp = await searchParams;
  const today = todayInIndia();
  const month = sp.month && MONTH.test(sp.month) ? sp.month : dayKey(today).slice(0, 7);
  const userId = sp.user || principal.userId;
  const view = await monthAttendance(principal, userId, month).catch((error) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const { summary } = view;
  const link = (m: string) => `/hrms/attendance?month=${m}${view.isSelf ? '' : `&user=${userId}`}`;
  const { end } = monthRange(month);
  const correctionMin = dayKey(addDays(today, -31));
  const pending = view.regularisations.filter((r) => r.status === 'PENDING');

  return (
    <div className="space-y-lg">
      <PageHeader
        title={view.isSelf ? 'My attendance' : `${view.person.fullName}: attendance`}
        subtitle={`${monthLabel(month)} · Shift ${formatMinutes(view.settings.shiftStartMinutes)} with ${view.settings.graceMinutes} minutes' grace; a full day is ${formatDuration(view.settings.fullDayMinutes)}.`}
        breadcrumb={view.isSelf ? undefined : [{ label: 'Team attendance', href: `/hrms/attendance/team?month=${month}` }, { label: view.person.fullName }]}
        actions={
          <div className="flex gap-xs">
            <Link href={link(shift(month, -1))} className="btn btn-secondary btn-sm">Previous month</Link>
            {end < today ? <Link href={link(shift(month, 1))} className="btn btn-secondary btn-sm">Next month</Link> : null}
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-base sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Days present" value={fmt(summary.present)} />
        <Stat label="Absent" value={fmt(summary.absent)} tone={summary.absent ? 'warning' : 'default'} />
        <Stat label="On leave" value={fmt(summary.leave)} />
        <Stat label="Late" value={summary.late} tone={summary.late ? 'warning' : 'default'} />
        <Stat label="Missed punch" value={summary.missedPunch} tone={summary.missedPunch ? 'warning' : 'default'} />
        <Stat label="Overtime" value={formatDuration(summary.overtimeMinutes) === '-' ? '0' : formatDuration(summary.overtimeMinutes)} />
      </div>

      <div className="grid gap-lg lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card title="Day by day">
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Day</th><th>In</th><th>Out</th><th>Worked</th><th>Status</th></tr></thead>
              <tbody>
                {view.rows.map((r) => (
                  <tr key={dayKey(r.date)} className={r.status === 'WEEKLY_OFF' || r.status === 'HOLIDAY' ? 'text-muted' : undefined}>
                    <td className="whitespace-nowrap">{WEEKDAY.format(r.date)} {r.date.getUTCDate()}</td>
                    <td className="whitespace-nowrap">{formatMinutes(r.inMinutes)}{r.late ? <span className="ml-xxs text-caption text-error">late {r.lateMinutes}m</span> : null}</td>
                    <td className="whitespace-nowrap">{formatMinutes(r.outMinutes)}</td>
                    <td className="whitespace-nowrap">{formatDuration(r.workedMinutes)}{r.overtimeMinutes ? <span className="ml-xxs text-caption text-muted">+{formatDuration(r.overtimeMinutes)}</span> : null}</td>
                    <td>
                      {DAY_STATUS_LABEL[r.status] ? <span className={`badge ${DAY_STATUS_BADGE[r.status]}`}>{DAY_STATUS_LABEL[r.status]}</span> : null}
                      {r.holidayName ? <span className="ml-xs text-caption text-muted">{r.holidayName}</span> : null}
                      {r.leaveType && (r.status === 'LEAVE' || r.status === 'HALF_LEAVE') ? <span className="ml-xs text-caption text-muted">{r.leaveType}</span> : null}
                      {r.corrected ? <span className="ml-xs text-caption text-muted">corrected</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="space-y-lg">
          {view.isSelf ? (
            <Card title="Correct a day">
              <ActionForm action={requestRegularisationAction} resetOnSuccess className="space-y-base">
                <div>
                  <label className="label" htmlFor="rg-date">Day</label>
                  <input id="rg-date" name="date" type="date" required min={correctionMin} max={dayKey(today)} className="input w-full" />
                </div>
                <div className="grid grid-cols-2 gap-base">
                  <div>
                    <label className="label" htmlFor="rg-in">Came in</label>
                    <input id="rg-in" name="inTime" type="time" required className="input w-full" />
                  </div>
                  <div>
                    <label className="label" htmlFor="rg-out">Left</label>
                    <input id="rg-out" name="outTime" type="time" required className="input w-full" />
                  </div>
                </div>
                <div>
                  <label className="label" htmlFor="rg-reason">What happened</label>
                  <input id="rg-reason" name="reason" required minLength={3} maxLength={300} className="input w-full" placeholder="e.g. Forgot to punch out, site visit" />
                </div>
                <p className="hint">For a missed punch or a day at a client site, in the last 31 days. Your manager approves it.</p>
                <SubmitButton pendingLabel="Sending…">Send for approval</SubmitButton>
              </ActionForm>
            </Card>
          ) : null}

          <Card title="Corrections this month">
            {view.regularisations.length === 0 ? (
              <p className="text-body-sm text-muted">No corrections asked for in {monthLabel(month)}.</p>
            ) : (
              <ul className="space-y-sm text-body-sm">
                {view.regularisations.map((r) => (
                  <li key={r.id}>
                    <span className="text-ink">{formatDate(r.date)}: {formatMinutes(istMinutes(r.firstIn))} to {formatMinutes(istMinutes(r.lastOut))}</span>{' '}
                    <span className={`badge ${r.status === 'APPROVED' ? 'badge-success' : r.status === 'REJECTED' ? 'badge-error' : 'badge-outline'}`}>{r.status === 'PENDING' ? 'Waiting' : r.status === 'APPROVED' ? 'Approved' : 'Not approved'}</span>
                    <span className="block text-caption text-muted">“{r.reason}”{r.note ? ` · Reply: “${r.note}”` : ''}</span>
                  </li>
                ))}
              </ul>
            )}
            {pending.length ? <p className="mt-sm text-caption text-muted">{pending.length} waiting for approval.</p> : null}
          </Card>
        </div>
      </div>
    </div>
  );
}
