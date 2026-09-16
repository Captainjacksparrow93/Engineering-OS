import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { hasPermissionAnywhere } from '@/core/rbac/engine';
import { prisma } from '@/core/db/prisma';
import { getWorkloads, defaultWindow } from '@/modules/project-management/services/availability.service';
import { formatDate } from '@/core/utils/dates';
import { PageHeader, Stat } from '@/components/ui';
import { TeamLoadTable } from './team-load-table';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Team load',
};

/**
 * The resource board - the answer to "who is free?".
 *
 * Utilisation is computed over a window (default two weeks) from open assignments and
 * approved leave, so the numbers reflect committed work rather than a headcount list.
 */
export default async function ResourcesPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; departmentId?: string; projectId?: string; skills?: string }>;
}) {
  const principal = await requirePrincipal();
  if (!hasPermissionAnywhere(principal, 'pm.resource.read')) redirect('/dashboard');

  const params = await searchParams;
  const fallback = defaultWindow();
  const from = params.from ? new Date(`${params.from}T00:00:00.000Z`) : fallback.from;
  const to = params.to ? new Date(`${params.to}T00:00:00.000Z`) : fallback.to;

  const [workloads, departments] = await Promise.all([
    getWorkloads(principal, {
      from,
      to,
      departmentId: params.departmentId,
      projectId: params.projectId,
      skills: params.skills ? params.skills.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
    }),
    prisma.department.findMany({
      where: { companyId: principal.companyId },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  const free = workloads.filter((w) => w.status === 'FREE' || w.status === 'AVAILABLE');
  const overloaded = workloads.filter((w) => w.status === 'OVERLOADED');
  const onLeave = workloads.filter((w) => w.status === 'ON_LEAVE' || w.leaveDays > 0);
  const totalFreeDays = Math.round((workloads.reduce((sum, w) => sum + Math.max(0, w.freeHours), 0) / 8) * 10) / 10;

  return (
    <>
      <PageHeader
        title="Team load"
        subtitle={`Capacity between ${formatDate(from)} and ${formatDate(to)} (Sundays excluded).`}
        actions={
          <Link href="/pm/adhoc" className="btn btn-primary">
            Add urgent task
          </Link>
        }
      />

      <form className="mb-4 flex flex-wrap items-end gap-2" action="/pm/resources">
        <div>
          <label className="label" htmlFor="from">From</label>
          <input id="from" name="from" type="date" defaultValue={from.toISOString().slice(0, 10)} className="input w-40" />
        </div>
        <div>
          <label className="label" htmlFor="to">To</label>
          <input id="to" name="to" type="date" defaultValue={to.toISOString().slice(0, 10)} className="input w-40" />
        </div>
        <div>
          <label className="label" htmlFor="departmentId">Department</label>
          <select id="departmentId" name="departmentId" defaultValue={params.departmentId ?? ''} className="select w-52">
            <option value="">All I can see</option>
            {departments.map((dept) => (
              <option key={dept.id} value={dept.id}>{dept.name}</option>
            ))}
          </select>
        </div>
        {params.projectId ? <input type="hidden" name="projectId" value={params.projectId} /> : null}
        <button type="submit" className="btn btn-secondary mb-0.5">Apply</button>
      </form>

      <div className="mb-5 grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Stat label="People in view" value={workloads.length} />
        <Stat label="With spare capacity" value={free.length} tone="success" />
        <Stat label="Overloaded" value={overloaded.length} tone={overloaded.length ? 'danger' : 'default'} />
        <Stat label="Spare capacity" value={`${totalFreeDays} days`} hint={onLeave.length ? `${onLeave.length} on leave` : undefined} />
      </div>

      <TeamLoadTable workloads={workloads} />
    </>
  );
}
