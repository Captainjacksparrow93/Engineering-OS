import Link from 'next/link';
import { requirePrincipal } from '@/core/auth/session';
import { listMyTasks } from '@/modules/project-management/services/task.service';
import { Card, EmptyState, PageHeader, Stat } from '@/components/ui';
import { MyWorkTable } from './my-work-table';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'My work',
};

/** The engineer's queue: active work vs completed deliverables. */
export default async function MyWorkPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; view?: string; all?: string }>;
}) {
  const principal = await requirePrincipal();
  const params = await searchParams;
  const isCompletedView = params.view === 'completed' || params.status === 'COMPLETED';

  const rows = await listMyTasks(principal, {
    status: isCompletedView ? 'COMPLETED' : params.status,
    onlyCompleted: isCompletedView,
  });

  const today = new Date();
  const overdue = rows.filter((r) => r.task.plannedEnd && new Date(r.task.plannedEnd) < today && r.task.status !== 'COMPLETED');
  const blocked = rows.filter((r) => r.task.status === 'BLOCKED');
  const inProgress = rows.filter((r) => r.task.status === 'IN_PROGRESS');
  const inReview = rows.filter((r) => r.task.status === 'IN_REVIEW');

  return (
    <>
      <PageHeader
        title="My work"
        subtitle={
          isCompletedView
            ? 'Your completed steps and past deliverables across all projects.'
            : 'Everything currently assigned to you, across every project.'
        }
        actions={
          <Link
            href={isCompletedView ? '/pm/my-work' : '/pm/my-work?view=completed'}
            className="btn btn-secondary font-medium text-xs"
          >
            {isCompletedView ? 'Show active tasks' : 'Show completed'}
          </Link>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {isCompletedView ? (
          <>
            <Stat label="Completed steps" value={rows.length} tone="success" />
          </>
        ) : (
          <>
            <Stat label="Open steps" value={rows.length} />
            <Stat label="In progress" value={inProgress.length} />
            <Stat label="Waiting / Review" value={blocked.length + inReview.length} tone={blocked.length ? 'danger' : 'default'} hint={blocked.length ? `${blocked.length} blocked` : undefined} />
            <Stat
              label="Overdue"
              value={overdue.length}
              tone={overdue.length ? 'danger' : 'default'}
              hint={overdue.length ? 'Needs attention' : 'All on track'}
            />
          </>
        )}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title={isCompletedView ? 'No completed tasks yet' : 'Nothing on your plate'}
          hint={
            isCompletedView
              ? 'Tasks you complete will appear here.'
              : 'Tasks assigned or handed to you show up here immediately.'
          }
        />
      ) : (
        <Card bodyClassName="p-0">
          <MyWorkTable rows={rows} />
        </Card>
      )}
    </>
  );
}
