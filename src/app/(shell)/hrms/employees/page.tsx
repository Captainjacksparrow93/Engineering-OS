import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { formatDate } from '@/core/utils/dates';
import { EMPLOYMENT_TYPE_LABEL, USER_STATUS_LABEL } from '@/modules/hrms/domain/labels';
import { listDirectoryDepartments, listEmployees, managesHr, seesDirectory } from '@/modules/hrms/services/employee.service';
import { Avatar, EmptyState, PageHeader } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Employees' };

const STATUSES = ['ACTIVE', 'SUSPENDED', 'EXITED', 'ALL'] as const;

/** The employee directory: HR and Directors see everyone, department heads their department. */
export default async function EmployeesPage({ searchParams }: { searchParams: Promise<{ q?: string; dept?: string; status?: string }> }) {
  const principal = await requirePrincipal();
  if (!seesDirectory(principal)) notFound();
  const sp = await searchParams;
  const status = STATUSES.find((s) => s === sp.status) ?? 'ACTIVE';
  const q = sp.q?.trim().slice(0, 80) || null;
  const [people, departments] = await Promise.all([
    listEmployees(principal, { q, departmentId: sp.dept || null, status }),
    listDirectoryDepartments(principal),
  ]);

  return (
    <div className="space-y-lg">
      <PageHeader
        title="Employees"
        subtitle={`${people.length} ${people.length === 1 ? 'person' : 'people'}${managesHr(principal) ? '. To add someone, create their account in People first.' : '.'}`}
        breadcrumb={[{ label: 'HR', href: '/hrms' }, { label: 'Employees' }]}
        actions={managesHr(principal) ? <Link href="/admin/users" className="btn btn-secondary">Add in People</Link> : undefined}
      />

      <form method="get" className="flex flex-wrap items-end gap-base">
        <div className="min-w-[14rem] flex-1">
          <label className="label" htmlFor="q">Search</label>
          <input id="q" name="q" defaultValue={q ?? ''} placeholder="Name, code, email or designation" className="input w-full" />
        </div>
        {departments.length > 1 ? (
          <div>
            <label className="label" htmlFor="dept">Department</label>
            <select id="dept" name="dept" defaultValue={sp.dept ?? ''} className="select">
              <option value="">All departments</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
        ) : null}
        <div>
          <label className="label" htmlFor="status">Status</label>
          <select id="status" name="status" defaultValue={status} className="select">
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s === 'ALL' ? 'Everyone' : USER_STATUS_LABEL[s]}</option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn btn-secondary">Show</button>
      </form>

      {people.length === 0 ? (
        <EmptyState title="Nobody matches" hint="Try another name or clear the filters." />
      ) : (
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr><th>Employee</th><th>Department</th><th>Reports to</th><th>Joined</th><th>Type</th><th>Record</th></tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.id}>
                  <td>
                    <div className="flex items-center gap-sm">
                      <Avatar name={p.fullName} color={p.avatarColor} />
                      <div>
                        <Link href={`/hrms/employees/${p.id}`} className="link font-medium">{p.fullName}</Link>
                        <span className="block text-caption text-muted">{p.employeeCode} · {p.designation ?? 'No designation'}</span>
                      </div>
                    </div>
                  </td>
                  <td>{p.department?.name ?? '-'}</td>
                  <td>{p.manager?.fullName ?? '-'}</td>
                  <td className="whitespace-nowrap">{formatDate(p.dateOfJoining, { forceYear: true })}</td>
                  <td>{p.employmentType ? EMPLOYMENT_TYPE_LABEL[p.employmentType] : '-'}</td>
                  <td>
                    {p.status !== 'ACTIVE' ? <span className="badge badge-neutral">{USER_STATUS_LABEL[p.status]}</span> : p.missing.length ? <span className="badge badge-outline" title={`Missing: ${p.missing.join(', ')}`}>{p.missing.length} missing</span> : <span className="badge badge-success">Complete</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
