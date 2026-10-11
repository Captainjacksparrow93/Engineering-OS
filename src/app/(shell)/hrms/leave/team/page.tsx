import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { addDays, formatDate, todayInIndia } from '@/core/utils/dates';
import { LEAVE_STATUS_BADGE, LEAVE_STATUS_LABEL } from '@/modules/hrms/domain/labels';
import { seesDirectory } from '@/modules/hrms/services/employee.service';
import { teamLeave } from '@/modules/hrms/services/leave.service';
import { Card, EmptyState, PageHeader, Stat } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Team leave' };

/** Who is off today and in the next 30 days, across the people the principal may see. */
export default async function TeamLeavePage() {
  const principal = await requirePrincipal();
  if (!seesDirectory(principal)) notFound();
  const today = todayInIndia();
  const to = addDays(today, 30);
  const rows = await teamLeave(principal, today, to);
  const approved = rows.filter((r) => r.status === 'APPROVED');
  const offToday = approved.filter((r) => r.startDate <= today && r.endDate >= today);
  const pending = rows.filter((r) => r.status !== 'APPROVED');

  const table = (list: typeof rows, withStatus: boolean) => (
    <div className="overflow-x-auto">
      <table className="table">
        <thead><tr><th>Employee</th><th>Dates</th><th>Type</th><th>Days</th>{withStatus ? <th>Status</th> : null}</tr></thead>
        <tbody>
          {list.map((r) => (
            <tr key={r.id}>
              <td><Link href={`/hrms/employees/${r.user.id}`} className="link font-medium">{r.user.fullName}</Link><span className="block text-caption text-muted">{r.user.department?.name ?? 'No department'}</span></td>
              <td className="whitespace-nowrap">{formatDate(r.startDate)}{r.endDate.getTime() !== r.startDate.getTime() ? ` to ${formatDate(r.endDate)}` : ''}</td>
              <td>{r.leaveType.name}{r.halfDay ? ' (half)' : ''}</td>
              <td>{Number(r.days)}</td>
              {withStatus ? <td><span className={`badge ${LEAVE_STATUS_BADGE[r.status]}`}>{LEAVE_STATUS_LABEL[r.status]}</span></td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-lg">
      <PageHeader title="Team leave" subtitle="Who is off today and over the next 30 days." breadcrumb={[{ label: 'HR', href: '/hrms' }, { label: 'Team leave' }]} />
      <div className="grid grid-cols-2 gap-base sm:grid-cols-3">
        <Stat label="Off today" value={offToday.length} />
        <Stat label="Approved, next 30 days" value={approved.length} />
        <Stat label="Waiting for approval" value={pending.length} tone={pending.length ? 'warning' : 'default'} />
      </div>
      <Card title="Approved leave">{approved.length ? table(approved, false) : <EmptyState title="Nobody is off in the next 30 days" />}</Card>
      <Card title="Waiting for approval">{pending.length ? table(pending, true) : <EmptyState title="Nothing waiting" />}</Card>
    </div>
  );
}
