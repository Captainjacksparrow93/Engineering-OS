'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Avatar } from '@/components/ui';
import { formatName } from '@/core/utils/strings';
import { formatDate } from '@/core/utils/dates';
import { useToast } from '@/components/toast';
import {
  approveCommissioningLogAction,
  rejectCommissioningLogAction,
} from '@/app/actions/pm';

export interface CommissioningApprovalItem {
  id: string;
  loggedFor: Date | string;
  workDone: string;
  blocker: string | null;
  project: {
    id: string;
    code: string;
    name: string;
    clientName: string;
  };
  user: {
    id: string;
    fullName: string;
    employeeCode: string;
    designation: string | null;
    avatarColor: string;
  };
}

export function CommissioningApprovalsTable({
  items,
}: {
  items: CommissioningApprovalItem[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  const [rejectingLogId, setRejectingLogId] = useState<string | null>(null);
  const [rejectionNote, setRejectionNote] = useState('');

  const handleApprove = (logId: string, engineerName: string) => {
    startTransition(async () => {
      const res = await approveCommissioningLogAction(logId);
      if (!res.success) {
        toast.error(res.error || 'Failed to approve commissioning log.');
      } else {
        toast.success(`Approved site log for ${engineerName}`);
        router.refresh();
      }
    });
  };

  const handleReject = (logId: string, engineerName: string) => {
    startTransition(async () => {
      const res = await rejectCommissioningLogAction(logId, rejectionNote.trim() || undefined);
      if (!res.success) {
        toast.error(res.error || 'Failed to reject commissioning log.');
      } else {
        toast.success(`Rejected site log for ${engineerName}`);
        setRejectingLogId(null);
        setRejectionNote('');
        router.refresh();
      }
    });
  };

  if (items.length === 0) {
    return (
      <div className="card p-6 text-center text-body-sm text-muted">
        No daily site logs awaiting commissioning sign-off.
      </div>
    );
  }

  return (
    <div className="card overflow-hidden border-hairline bg-surface">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-body-sm">
          <thead className="border-b border-hairline bg-surface-strong/40 text-caption-uppercase text-muted-soft">
            <tr>
              <th className="px-base py-sm font-medium">Date & Project</th>
              <th className="px-base py-sm font-medium">Engineer</th>
              <th className="px-base py-sm font-medium">Site Work Done</th>
              <th className="px-base py-sm font-medium">Blocker</th>
              <th className="px-base py-sm font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {items.map((item) => (
              <tr key={item.id} className="hover:bg-surface-strong/20">
                <td className="px-base py-sm align-top">
                  <span className="font-mono font-semibold text-ink">
                    {formatDate(item.loggedFor)}
                  </span>
                  <div className="mt-0.5">
                    <Link
                      href={`/pm/projects/${item.project.id}`}
                      className="font-mono text-caption text-accent hover:underline"
                    >
                      {item.project.code}
                    </Link>
                    <span className="text-caption text-muted ml-1 truncate max-w-[180px] inline-block align-bottom">
                      · {item.project.name}
                    </span>
                  </div>
                </td>

                <td className="px-base py-sm align-top">
                  <div className="flex items-center gap-2">
                    <Avatar
                      name={item.user.fullName}
                      color={item.user.avatarColor}
                      size={24}
                    />
                    <div>
                      <p className="font-medium text-ink leading-tight">
                        {formatName(item.user.fullName)}
                      </p>
                      <p className="font-mono text-[11px] text-muted">
                        {item.user.employeeCode}
                      </p>
                    </div>
                  </div>
                </td>

                <td className="px-base py-sm align-top">
                  <p className="text-body-sm text-ink max-w-md whitespace-pre-wrap">
                    {item.workDone}
                  </p>
                </td>

                <td className="px-base py-sm align-top">
                  {item.blocker ? (
                    <span className="rounded bg-error/10 px-2 py-0.5 text-xs text-error font-medium inline-block">
                      {item.blocker}
                    </span>
                  ) : (
                    <span className="text-caption text-muted">None</span>
                  )}
                </td>

                <td className="px-base py-sm align-top text-right whitespace-nowrap">
                  {rejectingLogId === item.id ? (
                    <div className="space-y-2 min-w-[200px]">
                      <input
                        type="text"
                        value={rejectionNote}
                        onChange={(e) => setRejectionNote(e.target.value)}
                        placeholder="Rejection reason..."
                        className="input input-sm w-full bg-surface text-xs"
                      />
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => setRejectingLogId(null)}
                          className="btn btn-secondary btn-xs"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() => handleReject(item.id, item.user.fullName)}
                          className="btn btn-primary btn-xs bg-error text-white hover:bg-error/90"
                        >
                          Confirm
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => handleApprove(item.id, item.user.fullName)}
                        className="btn btn-primary btn-xs bg-success text-on-primary hover:bg-success/90"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => {
                          setRejectingLogId(item.id);
                          setRejectionNote('');
                        }}
                        className="btn btn-secondary btn-xs text-error hover:border-error"
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
