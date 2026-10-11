import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { formatDate } from '@/core/utils/dates';
import { listImports } from '@/modules/hrms/services/attendance.service';
import { managesTime } from '@/modules/hrms/services/leave.service';
import { importAttendanceAction } from '@/app/actions/hrms';
import { ActionForm } from '@/components/action-form';
import { SubmitButton } from '@/components/form';
import { Card, EmptyState, PageHeader } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Import attendance' };

const WHEN = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });

/** HR: import the biometric machine's CSV export. */
export default async function ImportAttendancePage() {
  const principal = await requirePrincipal();
  if (!managesTime(principal)) notFound();
  const imports = await listImports(principal);

  return (
    <div className="space-y-lg">
      <PageHeader title="Import attendance" subtitle="Upload the CSV exported from the biometric machine. Importing the same file again is safe." breadcrumb={[{ label: 'Team attendance', href: '/hrms/attendance/team' }, { label: 'Import' }]} />
      <div className="grid gap-lg lg:grid-cols-2">
        <Card title="Upload">
          <ActionForm action={importAttendanceAction} resetOnSuccess className="space-y-base">
            <div>
              <label className="label" htmlFor="att-file">CSV file</label>
              <input id="att-file" name="file" type="file" required accept=".csv,text/csv,text/plain" className="input w-full" />
              <p className="hint">Up to 2 MB, about a month at a time.</p>
            </div>
            <SubmitButton variant="primary" pendingLabel="Importing…">Import</SubmitButton>
          </ActionForm>
        </Card>
        <Card title="What the file needs">
          <ul className="list-disc space-y-xs pl-lg text-body-sm text-body">
            <li>An employee column: <em>Emp Code</em>, <em>Employee Code</em>, <em>Enroll No</em> or <em>Card No</em>. It matches the employee code, or the biometric number HR enters on the employee record.</li>
            <li>Either one row per person per day with <em>Date</em>, <em>In Time</em> and <em>Out Time</em>,</li>
            <li>or one row per punch with <em>Date</em> and <em>Time</em> (or one <em>Punch Time</em> column). The first punch is the in, the last the out.</li>
            <li>Dates are read day first (12-10-2026, 12/10/2026, 12-Oct-2026) or as 2026-10-12. Times may be 09:30, 9:30:15 or 6:10 PM.</li>
            <li>Other columns (name, department, status) are ignored. A day fixed by an approved correction is never overwritten.</li>
          </ul>
        </Card>
      </div>
      <Card title="Recent imports">
        {imports.length === 0 ? (
          <EmptyState title="No imports yet" />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>When</th><th>File</th><th>Covers</th><th>Rows</th><th>Days saved</th><th>Skipped</th></tr></thead>
              <tbody>
                {imports.map((i) => (
                  <tr key={i.id}>
                    <td className="whitespace-nowrap">{WHEN.format(i.createdAt)}<span className="block text-caption text-muted">{i.importedBy.fullName}</span></td>
                    <td>{i.fileName}</td>
                    <td className="whitespace-nowrap">{i.fromDate ? `${formatDate(i.fromDate)} to ${formatDate(i.toDate)}` : '-'}</td>
                    <td>{i.rows}</td>
                    <td>{i.days}</td>
                    <td>
                      {i.skipped}
                      {i.problems.length ? (
                        <details><summary className="cursor-pointer text-caption text-muted">Why</summary><ul className="mt-xxs space-y-xxs text-caption">{i.problems.map((p, n) => <li key={n}>{p}</li>)}</ul></details>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
