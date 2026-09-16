'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Avatar } from '@/components/ui';
import { formatName } from '@/core/utils/strings';
import { approveTaskReviewAction, disapproveTaskReviewAction } from '@/app/actions/pm';

interface ApprovalItem {
  id: string;
  code: string;
  title: string;
  percentComplete: number;
  updatedAt: Date | string;
  project: {
    id: string;
    code: string;
    name: string;
    clientName: string;
  };
  assignments: Array<{
    user: {
      id: string;
      fullName: string;
      avatarColor: string | null;
      designation: string | null;
      grade: string;
    };
  }>;
  progressLogs: Array<{
    note: string | null;
    createdAt: Date | string;
    user: { fullName: string } | null;
  }>;
}

import { useToast } from '@/components/toast';

export function ApprovalsTable({ items }: { items: ApprovalItem[] }) {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  const [rejectingTaskId, setRejectingTaskId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');

  const handleApprove = (taskId: string, taskTitle: string) => {
    startTransition(async () => {
      const res = await approveTaskReviewAction(taskId);
      if (!res.success) {
        toast.error(res.error || 'Failed to approve step.');
      } else {
        toast.success(`Approved "${taskTitle}" — next step unlocked`);
        router.refresh();
      }
    });
  };

  const handleReject = (taskId: string, taskTitle: string) => {
    if (!feedback.trim()) {
      toast.error('Please provide feedback before sending back.');
      return;
    }
    startTransition(async () => {
      const res = await disapproveTaskReviewAction(taskId, feedback.trim());
      if (!res.success) {
        toast.error(res.error || 'Failed to send back step.');
      } else {
        toast.success(`Sent back "${taskTitle}" for rework`);
        setRejectingTaskId(null);
        setFeedback('');
        router.refresh();
      }
    });
  };

  if (items.length === 0) {
    return (
      <div className="card p-xl text-center">
        <p className="text-body text-muted">No items awaiting your approval.</p>
        <p className="text-caption text-muted-soft mt-xs">
          When engineers submit steps for review, they will appear here for sign-off.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-base">
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-body-sm">
            <thead className="border-b border-hairline bg-surface-strong/40 text-caption-uppercase text-muted-soft">
              <tr>
                <th className="px-base py-sm font-medium">Step</th>
                <th className="px-base py-sm font-medium">Project</th>
                <th className="px-base py-sm font-medium">Assignee</th>
                <th className="px-base py-sm font-medium">Latest Note</th>
                <th className="px-base py-sm font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {items.map((task) => {
                const assignee = task.assignments[0]?.user;
                const latestLog = task.progressLogs[0];
                const isRejectingThis = rejectingTaskId === task.id;

                return (
                  <tr key={task.id} className="hover:bg-surface-strong/20 transition-colors">
                    <td className="px-base py-md align-top">
                      <div className="space-y-xxs">
                        <Link
                          href={`/pm/tasks/${task.id}`}
                          className="font-medium text-ink hover:underline line-clamp-1"
                        >
                          {task.title}
                        </Link>
                        <span className="code-chip text-caption">{task.code}</span>
                      </div>
                    </td>
                    <td className="px-base py-md align-top">
                      <div className="space-y-xxs">
                        <Link
                          href={`/pm/projects/${task.project.id}`}
                          className="font-medium text-ink hover:underline line-clamp-1"
                        >
                          {task.project.name}
                        </Link>
                        <p className="text-caption text-muted-soft">{task.project.clientName}</p>
                      </div>
                    </td>
                    <td className="px-base py-md align-top">
                      {assignee ? (
                        <div className="flex items-center gap-xs">
                          <Avatar
                            name={formatName(assignee.fullName)}
                            color={assignee.avatarColor}
                            size={24}
                          />
                          <div>
                            <p className="font-medium text-ink">{formatName(assignee.fullName)}</p>
                            <p className="text-caption text-muted-soft">{assignee.grade}</p>
                          </div>
                        </div>
                      ) : (
                        <span className="text-muted text-caption">Unassigned</span>
                      )}
                    </td>
                    <td className="px-base py-md align-top max-w-xs">
                      {latestLog?.note ? (
                        <p className="text-caption text-body line-clamp-2 italic">
                          &ldquo;{latestLog.note}&rdquo;
                        </p>
                      ) : (
                        <span className="text-caption text-muted-soft">Submitted for review</span>
                      )}
                    </td>
                    <td className="px-base py-md align-top text-right">
                      {isRejectingThis ? (
                        <div className="flex flex-col items-end gap-xs w-64 ml-auto">
                          <textarea
                            value={feedback}
                            onChange={(e) => setFeedback(e.target.value)}
                            placeholder="Reason for sending back..."
                            rows={2}
                            className="input w-full text-caption"
                            autoFocus
                          />
                          <div className="flex items-center gap-xs">
                            <button
                              type="button"
                              onClick={() => {
                                setRejectingTaskId(null);
                                setFeedback('');
                              }}
                              disabled={isPending}
                              className="btn btn-secondary btn-sm"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => handleReject(task.id, task.title)}
                              disabled={isPending || !feedback.trim()}
                              className="btn btn-danger btn-sm"
                            >
                              Send back
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-end gap-xs">
                          <button
                            type="button"
                            onClick={() => {
                              setRejectingTaskId(task.id);
                              setFeedback('');
                            }}
                            disabled={isPending}
                            className="btn btn-secondary btn-sm"
                          >
                            Send back
                          </button>
                          <button
                            type="button"
                            onClick={() => handleApprove(task.id, task.title)}
                            disabled={isPending}
                            className="btn btn-primary btn-sm"
                          >
                            Approve
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
