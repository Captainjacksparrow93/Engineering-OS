import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { todayInIndia } from '@/core/utils/dates';
import { monthLabel } from '@/modules/hrms/domain/labels';
import { dayKey, formatDuration } from '@/modules/hrms/domain/time';
import { teamAttendance } from '@/modules/hrms/services/attendance.service';
import { listDirectoryDepartments, seesDirectory } from '@/modules/hrms/services/employee.service';
import { managesTime } from '@/modules/hrms/services/leave.service';
import { EmptyState, PageHeader } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Team attendance' };

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** Month totals per person: HR and Directors everyone, department heads their department. */
export default async function TeamAttendancePage({ searchParams }: { searchParams: Promise<{ month?: string; dept?: string }> }) {
  const principal = await requirePrincipal();
  if (!seesDirectory(principal)) notFound();
  const sp = await searchParams;
  const month = sp.month && MONTH.test(sp.month) ? sp.month : dayKey(todayInIndia()).slice(0, 7);
  const [rows, departments] = await Promise.all([teamAttendance(principal, month, sp.dept || null), listDirectoryDepartments(principal)]);

  return (
    <div className="space-y-lg">
      <PageHeader
        title="Team attendance"
        subtitle={`${monthLabel(month)}. Open a name for the day-by-day view.`}
        breadcrumb={[{ label: 'HR', href: '/hrms' }, { label: 'Team attendance' }]}
        actions={managesTime(principal) ? <Link href="/hrms/attendance/import" className="btn btn-primary">Import attendance</Link> : undefined}
      />
      <form method="get" className="flex flex-wrap items-end gap-base">
        <div>
          <label className="label" htmlFor="month">Month</label>
          <input id="month" name="month" type="month" defaultValue={month} className="input" />
        </div>
        {departments.length > 1 ? (
          <div>
            <label className="label" htmlFor="dept">Department</label>
            <select id="dept" name="dept" defaultValue={sp.dept ?? ''} className="select">
              <option value="">All departments</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
        ) : null}
        <button type="submit" className="btn btn-secondary">Show</button>
      </form>
      {rows.length === 0 ? (
        <EmptyState title="Nobody to show" />
      ) : (
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th>Employee</th><th>Present</th><th>Absent</th><th>Leave</th><th>Late</th><th>Missed punch</th><th>Worked</th><th>Overtime</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><Link href={`/hrms/attendance?month=${month}&user=${r.id}`} className="link font-medium">{r.fullName}</Link><span className="block text-caption text-muted">{r.employeeCode} · {r.department?.name ?? 'No department'}</span></td>
                  <td>{fmt(r.summary.present)}</td>
                  <td className={r.summary.absent ? 'text-error' : undefined}>{fmt(r.summary.absent)}</td>
                  <td>{fmt(r.summary.leave)}</td>
                  <td className={r.summary.late ? 'text-error' : undefined}>{r.summary.late}</td>
                  <td className={r.summary.missedPunch ? 'text-error' : undefined}>{r.summary.missedPunch}</td>
                  <td className="whitespace-nowrap">{formatDuration(r.summary.workedMinutes)}</td>
                  <td className="whitespace-nowrap">{formatDuration(r.summary.overtimeMinutes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
