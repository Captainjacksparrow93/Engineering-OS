import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { formatDate } from '@/core/utils/dates';
import { getOverview, managesHr, seesDirectory } from '@/modules/hrms/services/employee.service';
import { Card, EmptyState, PageHeader, Stat } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'HR overview' };

const MONTH = new Intl.DateTimeFormat('en-IN', { month: 'long', timeZone: 'UTC' });

function PersonList({ people, detail, empty }: { people: Array<{ id: string; fullName: string; designation: string | null }>; detail: (id: string) => React.ReactNode; empty: string }) {
  if (people.length === 0) return <p className="text-body-sm text-muted">{empty}</p>;
  return (
    <ul className="divide-y divide-hairline-soft">
      {people.map((p) => (
        <li key={p.id} className="flex flex-wrap items-baseline justify-between gap-xs py-xs first:pt-0 last:pb-0">
          <Link href={`/hrms/employees/${p.id}`} className="link font-medium">{p.fullName}</Link>
          <span className="text-body-sm text-muted">{detail(p.id)}</span>
        </li>
      ))}
    </ul>
  );
}

/** HR overview for HR, Directors and department heads (their team). Everyone else goes to their own profile. */
export default async function HrOverviewPage() {
  const principal = await requirePrincipal();
  if (!seesDirectory(principal)) redirect('/hrms/me');
  const o = await getOverview(principal);
  const month = MONTH.format(o.today);
  const byId = <T extends { id: string }>(list: T[]) => new Map(list.map((p) => [p.id, p]));
  const probation = byId(o.probationEnding);
  const birthdays = byId(o.birthdays);
  const anniversaries = byId(o.anniversaries);
  const joiners = byId(o.joiners);

  return (
    <div className="space-y-lg">
      <PageHeader
        title="HR overview"
        subtitle={managesHr(principal) ? 'Everyone at ACS Engitech at a glance.' : 'Your team at a glance.'}
        actions={<Link href="/hrms/employees" className="btn btn-primary">Employee directory</Link>}
      />

      <div className="grid gap-base sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Active employees" value={o.headcount} />
        <Stat label={`Joined in ${month}`} value={o.joiners.length} />
        <Stat label="Probation ending (30 days)" value={o.probationEnding.length} tone={o.probationEnding.length ? 'warning' : 'default'} />
        <Stat label="Records missing details" value={o.incomplete.length} tone={o.incomplete.length ? 'warning' : 'default'} />
      </div>

      <div className="grid gap-lg lg:grid-cols-3">
        <Card title="Headcount by department">
          {o.byDepartment.length === 0 ? (
            <EmptyState title="No employees" />
          ) : (
            <ul className="space-y-xs">
              {o.byDepartment.map((d) => (
                <li key={d.name} className="flex items-center gap-sm text-body-sm">
                  <span className="w-36 shrink-0 truncate text-ink" title={d.name}>{d.name}</span>
                  <span className="flex-1" aria-hidden>
                    <span className="block h-2 rounded-full bg-ink/70" style={{ width: `${Math.max(4, (d.count / o.byDepartment[0]!.count) * 100)}%` }} />
                  </span>
                  <span className="tabular-nums text-muted">{d.count}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Probation ending">
          <PersonList
            people={o.probationEnding}
            empty="No probation ends in the next 30 days."
            detail={(id) => {
              const end = probation.get(id)!.hrProfile!.probationEndDate!;
              return end < o.today ? `Overdue since ${formatDate(end)}` : formatDate(end);
            }}
          />
        </Card>

        <Card title={`Joined in ${month}`}>
          <PersonList people={o.joiners} empty="Nobody joined this month." detail={(id) => formatDate(joiners.get(id)!.hrProfile!.dateOfJoining)} />
        </Card>

        <Card title={`Birthdays in ${month}`}>
          <PersonList people={o.birthdays} empty="No birthdays this month." detail={(id) => formatDate(birthdays.get(id)!.hrProfile!.dateOfBirth).replace(/ \d{4}$/, '')} />
        </Card>

        <Card title={`Work anniversaries in ${month}`}>
          <PersonList
            people={o.anniversaries}
            empty="No work anniversaries this month."
            detail={(id) => {
              const a = anniversaries.get(id)!;
              return `${a.years} year${a.years === 1 ? '' : 's'} on ${formatDate(a.hrProfile!.dateOfJoining).replace(/ \d{4}$/, '')}`;
            }}
          />
        </Card>

        <Card title="Records missing details">
          {o.incomplete.length === 0 ? (
            <p className="text-body-sm text-muted">Every record has its key details.</p>
          ) : (
            <ul className="max-h-80 divide-y divide-hairline-soft overflow-y-auto">
              {o.incomplete.map((p) => (
                <li key={p.id} className="py-xs first:pt-0 last:pb-0">
                  <Link href={`/hrms/employees/${p.id}`} className="link font-medium">{p.fullName}</Link>
                  <span className="block text-caption text-muted">Missing: {p.missing.join(', ')}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
