import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { hasPermissionAnywhere } from '@/core/rbac/engine';
import { prisma } from '@/core/db/prisma';
import { getWorkloads, defaultWindow } from '@/modules/project-management/services/availability.service';
import { formatDate, addDays, todayInIndia } from '@/core/utils/dates';
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

  const today = todayInIndia();
  const tomorrow = addDays(today, 1);
  const dayOfWeek = today.getUTCDay(); // 0 is Sunday
  // This week: today to Saturday. Past days are excluded deliberately - they still add
  // capacity but their finished work no longer counts, which makes people look freer
  // than they are. On a Sunday this runs to the end of the week ahead.
  const thisWeekStart = today;
  const thisWeekEnd = addDays(today, dayOfWeek === 0 ? 6 : 6 - dayOfWeek);
  const next2WeeksEnd = addDays(today, 13);

  const toIsoDate = (d: Date) => d.toISOString().slice(0, 10);
  const isSingleDay = toIsoDate(from) === toIsoDate(to);

  const buildPresetUrl = (f: Date, t: Date) => {
    const q = new URLSearchParams();
    q.set('from', toIsoDate(f));
    q.set('to', toIsoDate(t));
    if (params.departmentId) q.set('departmentId', params.departmentId);
    if (params.projectId) q.set('projectId', params.projectId);
    if (params.skills) q.set('skills', params.skills);
    return `/pm/resources?${q.toString()}`;
  };

  const presets = [
    { label: 'Today', from: today, to: today },
    { label: 'Tomorrow', from: tomorrow, to: tomorrow },
    { label: 'This week', from: thisWeekStart, to: thisWeekEnd },
    { label: 'Next 2 weeks', from: today, to: next2WeeksEnd },
  ];

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

      {/* Date Presets & Filter Form */}
      <div className="mb-4 space-y-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-caption font-semibold text-muted uppercase mr-1">Presets:</span>
          {presets.map((preset) => {
            const isActive = toIsoDate(from) === toIsoDate(preset.from) && toIsoDate(to) === toIsoDate(preset.to);
            return (
              <Link
                key={preset.label}
                href={buildPresetUrl(preset.from, preset.to)}
                className={`rounded-pill px-3 py-1 text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-ink text-canvas font-semibold'
                    : 'bg-surface-strong text-muted hover:text-ink'
                }`}
              >
                {preset.label}
              </Link>
            );
          })}
        </div>

        {/* The `key`s matter: these inputs are uncontrolled, so `defaultValue` only applies
            on mount. Without a key that changes with the window, clicking a preset navigates
            and re-renders but leaves the old dates sitting in the boxes, contradicting the
            data on screen. */}
        <form className="flex flex-wrap items-end gap-2" action="/pm/resources">
          <div>
            <label className="label" htmlFor="from">From</label>
            <input key={`from-${toIsoDate(from)}`} id="from" name="from" type="date" defaultValue={toIsoDate(from)} className="input w-40" />
          </div>
          <div>
            <label className="label" htmlFor="to">To</label>
            <input key={`to-${toIsoDate(to)}`} id="to" name="to" type="date" defaultValue={toIsoDate(to)} className="input w-40" />
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

        {isSingleDay && (
          <p className="text-caption text-muted bg-surface-strong/40 border border-hairline px-3 py-1.5 rounded-md">
            <span className="font-semibold text-ink">Single-day view notice:</span> Overdue steps allocate their entire remaining estimate into this day rather than prorating. Load figures are strictly accurate for on-schedule work.
          </p>
        )}
      </div>

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
