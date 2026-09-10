import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { hasPermissionAnywhere } from '@/core/rbac/engine';
import { prisma } from '@/core/db/prisma';
import { getWorkloads, defaultWindow } from '@/modules/project-management/services/availability.service';
import { formatDate } from '@/core/utils/dates';
import { Avatar, Card, EmptyState, PageHeader, ProgressBar, Stat, StatusBadge } from '@/components/ui';

export const dynamic = 'force-dynamic';

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
  const onLeave = workloads.filter((w) => w.status === 'ON_LEAVE');
  const totalFree = Math.round(workloads.reduce((sum, w) => sum + Math.max(0, w.freeHours), 0));

  return (
    <>
      <PageHeader
        title="Resource board"
        subtitle={`Capacity between ${formatDate(from)} and ${formatDate(to)} (Sundays excluded).`}
        actions={
          <Link href="/pm/adhoc" className="btn btn-primary">
            Assign ad-hoc work
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
        <div>
          <label className="label" htmlFor="skills">Skills</label>
          <input id="skills" name="skills" defaultValue={params.skills ?? ''} className="input w-52" placeholder="EPLAN, wiring" />
        </div>
        {params.projectId ? <input type="hidden" name="projectId" value={params.projectId} /> : null}
        <button type="submit" className="btn btn-secondary mb-0.5">Apply</button>
      </form>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="People in view" value={workloads.length} />
        <Stat label="With spare capacity" value={free.length} tone="success" />
        <Stat label="Overloaded" value={overloaded.length} tone={overloaded.length ? 'danger' : 'default'} />
        <Stat label="Spare hours in window" value={`${totalFree}h`} hint={onLeave.length ? `${onLeave.length} on leave` : undefined} />
      </div>

      {workloads.length === 0 ? (
        <EmptyState title="No people in scope" hint="Widen the department filter or ask an administrator for wider resource visibility." />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {workloads
            .slice()
            .sort((a, b) => a.utilizationPercent - b.utilizationPercent)
            .map((workload) => (
              <Card key={workload.person.id} bodyClassName="p-4">
                <div className="mb-3 flex items-start gap-3">
                  <Avatar name={workload.person.fullName} color={workload.person.avatarColor} size={38} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-900">{workload.person.fullName}</p>
                    <p className="truncate text-xs text-slate-500">
                      {workload.person.designation ?? workload.person.grade.replaceAll('_', ' ').toLowerCase()}
                      {workload.person.departmentName ? ` · ${workload.person.departmentName}` : ''}
                    </p>
                  </div>
                  <StatusBadge status={workload.status} />
                </div>

                <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
                  <span>
                    {workload.committedHours}h committed of {workload.capacityHours}h
                  </span>
                  <span className={workload.utilizationPercent > 100 ? 'font-semibold text-red-600' : 'font-medium text-slate-700'}>
                    {workload.utilizationPercent}%
                  </span>
                </div>
                <ProgressBar
                  value={Math.min(100, workload.utilizationPercent)}
                  tone={workload.utilizationPercent > 100 ? 'danger' : workload.utilizationPercent < 60 ? 'success' : 'default'}
                />

                <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-600">
                  <span><strong className="text-slate-800">{workload.freeHours}h</strong> free</span>
                  <span><strong className="text-slate-800">{workload.openTaskCount}</strong> open tasks</span>
                  {workload.overdueTaskCount > 0 ? (
                    <span className="text-red-600"><strong>{workload.overdueTaskCount}</strong> overdue</span>
                  ) : null}
                  {workload.leaveDays > 0 ? (
                    <span className="text-amber-600"><strong>{workload.leaveDays}</strong> leave day(s)</span>
                  ) : null}
                </div>

                {workload.person.skills.length ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {workload.person.skills.map((skill) => (
                      <span key={skill} className="badge bg-slate-100 text-slate-600">{skill}</span>
                    ))}
                  </div>
                ) : null}

                {workload.assignments.length ? (
                  <ul className="mt-3 space-y-1 border-t border-surface-border pt-2">
                    {workload.assignments.slice(0, 4).map((assignment) => (
                      <li key={assignment.taskId} className="flex items-center gap-2 text-xs">
                        <Link href={`/pm/tasks/${assignment.taskId}`} className="min-w-0 flex-1 truncate text-slate-600 hover:text-brand-600">
                          {assignment.taskTitle}
                        </Link>
                        <span className="font-mono text-[10px] text-slate-400">{assignment.projectCode}</span>
                        <StatusBadge status={assignment.status} />
                      </li>
                    ))}
                    {workload.assignments.length > 4 ? (
                      <li className="text-[11px] text-slate-400">+{workload.assignments.length - 4} more</li>
                    ) : null}
                  </ul>
                ) : (
                  <p className="mt-3 border-t border-surface-border pt-2 text-xs text-emerald-600">
                    No open tasks — available immediately.
                  </p>
                )}
              </Card>
            ))}
        </div>
      )}
    </>
  );
}
