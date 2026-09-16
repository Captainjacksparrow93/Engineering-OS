import Link from 'next/link';
import { requirePrincipal } from '@/core/auth/session';
import { listMyTasks } from '@/modules/project-management/services/task.service';
import { Card, EmptyState, PageHeader, Stat } from '@/components/ui';
import { MyWorkTable } from './my-work-table';

export const dynamic = 'force-dynamic';

/** The engineer's queue: what they hold, what is late, and what is blocked and why. */
export default async function MyWorkPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; all?: string }>;
}) {
  const principal = await requirePrincipal();
  const params = await searchParams;
  const rows = await listMyTasks(principal, { status: params.status, includeCompleted: params.all === '1' });

  const today = new Date();
  const overdue = rows.filter((r) => r.task.plannedEnd && r.task.plannedEnd < today);
  const blocked = rows.filter((r) => r.task.status === 'BLOCKED');
  const inProgress = rows.filter((r) => r.task.status === 'IN_PROGRESS');
  const totalHours = rows.reduce((sum, r) => sum + r.assignment.allocatedHours * (1 - r.task.percentComplete / 100), 0);

  return (
    <>
      <PageHeader
        title="My work"
        subtitle="Everything currently assigned to you, across every project."
        actions={
          <Link href={params.all === '1' ? '/pm/my-work' : '/pm/my-work?all=1'} className="btn btn-secondary">
            {params.all === '1' ? 'Hide closed' : 'Show closed'}
          </Link>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Open tasks" value={rows.length} />
        <Stat label="In progress" value={inProgress.length} />
        <Stat label="Blocked" value={blocked.length} tone={blocked.length ? 'warning' : 'default'} />
        <Stat label="Remaining effort" value={`${Math.round(totalHours)}h`} tone={overdue.length ? 'danger' : 'default'} hint={`${overdue.length} overdue`} />
      </div>

      {rows.length === 0 ? (
        <EmptyState title="Nothing on your plate" hint="Tasks assigned or handed to you show up here immediately." />
      ) : (
        <Card bodyClassName="p-0">
          <MyWorkTable rows={rows} />
        </Card>
      )}
    </>
  );
}
