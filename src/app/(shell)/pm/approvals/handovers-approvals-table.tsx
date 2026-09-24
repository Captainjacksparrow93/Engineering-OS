import Link from 'next/link';
import { formatName } from '@/core/utils/strings';
import { formatDate } from '@/core/utils/dates';
import { Avatar, PriorityBadge } from '@/components/ui';
import { HandoverDecision, ProjectHandoverDecision } from '../handovers/handover-actions';

interface TaskHandoverItem {
  id: string;
  createdAt: Date | string;
  reason: string | null;
  remainingHours: number;
  remainingPercent: number;
  task: {
    id: string;
    code: string;
    title: string;
    priority: string;
    plannedEnd: Date | string | null;
    project: {
      id: string;
      code: string;
      name: string;
      clientName: string;
    };
  };
  fromUser: {
    id: string;
    fullName: string;
    avatarColor: string | null;
    designation: string | null;
  };
  toUser: {
    id: string;
    fullName: string;
    avatarColor: string | null;
    designation: string | null;
  };
}

interface ProjectHandoverItem {
  id: string;
  createdAt: Date | string;
  reason: string | null;
  project: {
    id: string;
    code: string;
    name: string;
    clientName: string;
    priority: string;
    targetEndDate: Date | string | null;
  };
  fromUser: {
    id: string;
    fullName: string;
    avatarColor: string | null;
    designation: string | null;
  };
  toUser: {
    id: string;
    fullName: string;
    avatarColor: string | null;
    designation: string | null;
  };
}

function getAgeString(date: Date | string): string {
  const d = new Date(date);
  const diffDays = Math.max(0, Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24)));
  if (diffDays === 0) return 'Requested today';
  if (diffDays === 1) return 'Requested yesterday';
  return `Requested ${diffDays} days ago`;
}

export function HandoversApprovalsTable({
  taskHandovers,
  projectHandovers,
}: {
  taskHandovers: TaskHandoverItem[];
  projectHandovers: ProjectHandoverItem[];
}) {
  const total = taskHandovers.length + projectHandovers.length;
  if (total === 0) return null;

  return (
    <div className="space-y-4">
      {/* Project Handovers */}
      {projectHandovers.length > 0 && (
        <div className="space-y-3">
          {projectHandovers.map((handover) => (
            <div
              key={handover.id}
              className="card p-base border-hairline-strong bg-surface space-y-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className="badge bg-primary/10 text-primary font-semibold text-xs uppercase tracking-wider">
                      Project Handover
                    </span>
                    <PriorityBadge priority={handover.project.priority} />
                    <span className="text-caption text-muted">
                      {getAgeString(handover.createdAt)} ({formatDate(handover.createdAt)})
                    </span>
                  </div>

                  <Link
                    href={`/pm/projects/${handover.project.id}`}
                    className="text-body font-bold text-ink hover:underline block"
                  >
                    {handover.project.name}
                  </Link>
                  <p className="text-caption text-muted mt-0.5">
                    Client: {handover.project.clientName}
                    {handover.project.targetEndDate
                      ? ` · Target delivery: ${formatDate(handover.project.targetEndDate)}`
                      : ''}
                  </p>

                  <div className="mt-2.5 flex flex-wrap items-center gap-2 text-body-sm text-ink">
                    <div className="flex items-center gap-1.5">
                      <Avatar
                        name={formatName(handover.fromUser.fullName)}
                        color={handover.fromUser.avatarColor}
                        size={22}
                      />
                      <span className="font-medium">{formatName(handover.fromUser.fullName)}</span>
                    </div>
                    <span className="text-muted-soft">→</span>
                    <div className="flex items-center gap-1.5">
                      <Avatar
                        name={formatName(handover.toUser.fullName)}
                        color={handover.toUser.avatarColor}
                        size={22}
                      />
                      <span className="font-medium">{formatName(handover.toUser.fullName)}</span>
                    </div>
                  </div>
                </div>

                <div className="w-full sm:w-auto sm:min-w-[220px]">
                  <ProjectHandoverDecision handoverId={handover.id} />
                </div>
              </div>

              {handover.reason && (
                <p className="rounded border border-hairline bg-surface-subtle px-3 py-2 text-body-sm text-body italic">
                  "{handover.reason}"
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Task Reassign Requests */}
      {taskHandovers.length > 0 && (
        <div className="space-y-3">
          {taskHandovers.map((handover) => (
            <div
              key={handover.id}
              className="card p-base border-hairline bg-surface space-y-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className="badge badge-neutral text-xs uppercase tracking-wider font-semibold">
                      Task Reassign
                    </span>
                    <PriorityBadge priority={handover.task.priority} />
                    <span className="text-caption text-muted">
                      {getAgeString(handover.createdAt)} ({formatDate(handover.createdAt)})
                    </span>
                  </div>

                  <Link
                    href={`/pm/tasks/${handover.task.id}`}
                    className="text-body font-bold text-ink hover:underline block"
                  >
                    {handover.task.title}
                  </Link>
                  <p className="text-caption text-muted mt-0.5">
                    Project: {handover.task.project.name} · {handover.remainingPercent}% remaining (~{handover.remainingHours}h)
                    {handover.task.plannedEnd ? ` · Due ${formatDate(handover.task.plannedEnd)}` : ''}
                  </p>

                  <div className="mt-2.5 flex flex-wrap items-center gap-2 text-body-sm text-ink">
                    <div className="flex items-center gap-1.5">
                      <Avatar
                        name={formatName(handover.fromUser.fullName)}
                        color={handover.fromUser.avatarColor}
                        size={22}
                      />
                      <span className="font-medium">{formatName(handover.fromUser.fullName)}</span>
                    </div>
                    <span className="text-muted-soft">→</span>
                    <div className="flex items-center gap-1.5">
                      <Avatar
                        name={formatName(handover.toUser.fullName)}
                        color={handover.toUser.avatarColor}
                        size={22}
                      />
                      <span className="font-medium">{formatName(handover.toUser.fullName)}</span>
                    </div>
                  </div>
                </div>

                <div className="w-full sm:w-auto sm:min-w-[220px]">
                  <HandoverDecision handoverId={handover.id} />
                </div>
              </div>

              {handover.reason && (
                <p className="rounded border border-hairline bg-surface-subtle px-3 py-2 text-body-sm text-body italic">
                  "{handover.reason}"
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
