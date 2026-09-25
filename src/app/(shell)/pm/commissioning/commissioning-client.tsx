'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Avatar, StatusBadge } from '@/components/ui';
import { formatName } from '@/core/utils/strings';
import { formatDate } from '@/core/utils/dates';
import { useToast } from '@/components/toast';
import {
  assignEngineerToCommissioningAction,
  releaseEngineerFromCommissioningAction,
  closeCommissioningAction,
} from '@/app/actions/pm';

interface EngineerOption {
  id: string;
  fullName: string;
  employeeCode: string;
  designation: string | null;
  grade: string;
  avatarColor: string;
  department: { name: string } | null;
}

interface CommissioningProject {
  id: string;
  code: string;
  name: string;
  clientName: string;
  workOrderNo?: string | null;
  status: string;
  panelCount: number;
  startDate: Date | string | null;
  targetEndDate: Date | string | null;
  actualEndDate: Date | string | null;
  manager: {
    id: string;
    fullName: string;
    avatarColor: string;
  };
  commissioningAssignments: Array<{
    id: string;
    userId: string;
    user: {
      id: string;
      fullName: string;
      employeeCode: string;
      designation: string | null;
      avatarColor: string;
      grade: string;
    };
  }>;
  commissioningLogs: Array<{
    id: string;
    loggedFor: Date | string;
    workDone: string;
    user: {
      id: string;
      fullName: string;
    };
  }>;
  _count: {
    commissioningLogs: number;
    tasks: number;
  };
}

export function CommissioningClient({
  pendingProjects,
  inCommissioningProjects,
  engineers,
}: {
  pendingProjects: CommissioningProject[];
  inCommissioningProjects: CommissioningProject[];
  engineers: EngineerOption[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();

  // Selected project for adding engineer modal/inline select
  const [assigningProjectId, setAssigningProjectId] = useState<string | null>(null);
  const [selectedEngineerId, setSelectedEngineerId] = useState<string>('');

  // Close commissioning confirmation modal
  const [closingProject, setClosingProject] = useState<CommissioningProject | null>(null);

  const handleAssign = (projectId: string, engineerId: string) => {
    if (!engineerId) return;
    startTransition(async () => {
      const res = await assignEngineerToCommissioningAction(projectId, engineerId);
      if (!res.success) {
        toast.error(res.error || 'Failed to assign engineer.');
      } else {
        toast.success('Engineer assigned to site commissioning.');
        setAssigningProjectId(null);
        setSelectedEngineerId('');
        router.refresh();
      }
    });
  };

  const handleRelease = (projectId: string, userId: string, engineerName: string) => {
    if (!confirm(`Release ${engineerName} from site commissioning?`)) return;
    startTransition(async () => {
      const res = await releaseEngineerFromCommissioningAction(projectId, userId);
      if (!res.success) {
        toast.error(res.error || 'Failed to release engineer.');
      } else {
        toast.success(`${engineerName} released from commissioning.`);
        router.refresh();
      }
    });
  };

  const handleCloseCommissioning = () => {
    if (!closingProject) return;
    startTransition(async () => {
      const res = await closeCommissioningAction(closingProject.id);
      if (!res.success) {
        toast.error(res.error || 'Failed to close commissioning.');
      } else {
        toast.success(`Commissioning completed for ${closingProject.name}. Project marked CLOSED.`);
        setClosingProject(null);
        router.refresh();
      }
    });
  };

  return (
    <div className="space-y-8">
      {/* SECTION 1: IN COMMISSIONING */}
      <section className="space-y-4">
        <div className="flex items-center justify-between border-b border-hairline pb-2">
          <div>
            <h2 className="text-title-sm font-semibold text-ink">In Commissioning</h2>
            <p className="text-body-sm text-muted">
              Projects with engineers deployed on site ({inCommissioningProjects.length})
            </p>
          </div>
        </div>

        {inCommissioningProjects.length === 0 ? (
          <div className="card p-6 text-center text-body-sm text-muted">
            No projects currently in site commissioning.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {inCommissioningProjects.map((p) => {
              const assignedUserIds = new Set(p.commissioningAssignments.map((a) => a.userId));
              const availableEngineers = engineers.filter((e) => !assignedUserIds.has(e.id));

              return (
                <div key={p.id} className="card border-hairline bg-surface p-5 space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/pm/projects/${p.id}`}
                          className="font-mono text-body-sm font-semibold text-accent hover:underline"
                        >
                          {p.code}
                        </Link>
                        <StatusBadge status={p.status} />
                        {p.workOrderNo ? (
                          <span className="text-caption text-muted">WO: {p.workOrderNo}</span>
                        ) : (
                          <span className="badge bg-amber-500/10 text-amber-700 dark:text-amber-300 text-[10px] font-bold">
                            SERVICE CALL
                          </span>
                        )}
                      </div>
                      <h3 className="text-base font-semibold text-ink mt-1">
                        <Link href={`/pm/projects/${p.id}`} className="hover:underline">
                          {p.name}
                        </Link>
                      </h3>
                      <p className="text-body-sm text-muted">
                        Client: <span className="text-ink font-medium">{p.clientName}</span> · Manager:{' '}
                        {formatName(p.manager.fullName)}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setClosingProject(p)}
                        className="btn btn-secondary btn-sm text-success font-medium hover:border-success"
                      >
                        Commissioning complete
                      </button>
                    </div>
                  </div>

                  {/* Assigned Engineers */}
                  <div className="border-t border-hairline pt-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-caption font-semibold uppercase tracking-wider text-muted">
                        Site Engineers ({p.commissioningAssignments.length})
                      </span>
                      {assigningProjectId !== p.id && (
                        <button
                          type="button"
                          onClick={() => {
                            setAssigningProjectId(p.id);
                            setSelectedEngineerId('');
                          }}
                          className="text-xs text-accent hover:underline font-medium"
                        >
                          + Add engineer
                        </button>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      {p.commissioningAssignments.map((assignment) => (
                        <div
                          key={assignment.id}
                          className="flex items-center gap-2 rounded-md bg-surface-strong px-3 py-1.5 border border-hairline"
                        >
                          <Avatar
                            name={assignment.user.fullName}
                            color={assignment.user.avatarColor}
                            size={24}
                          />
                          <div className="text-xs">
                            <span className="font-medium text-ink">
                              {formatName(assignment.user.fullName)}
                            </span>
                            <span className="text-muted ml-1 font-mono text-[10px]">
                              ({assignment.user.employeeCode})
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRelease(p.id, assignment.userId, assignment.user.fullName)}
                            title="Release engineer"
                            className="text-muted hover:text-error ml-1 text-sm font-bold"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>

                    {/* Inline Add Engineer Form */}
                    {assigningProjectId === p.id && (
                      <div className="mt-3 flex items-center gap-2 bg-surface-strong/50 p-2 rounded-md border border-hairline">
                        <select
                          value={selectedEngineerId}
                          onChange={(e) => setSelectedEngineerId(e.target.value)}
                          className="select select-sm text-body-sm flex-1 bg-surface"
                        >
                          <option value="">Select an engineer from any team...</option>
                          {availableEngineers.map((eng) => (
                            <option key={eng.id} value={eng.id}>
                              {formatName(eng.fullName)} ({eng.employeeCode}) — {eng.designation || eng.grade}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          disabled={!selectedEngineerId || isPending}
                          onClick={() => handleAssign(p.id, selectedEngineerId)}
                          className="btn btn-primary btn-sm"
                        >
                          {isPending ? 'Assigning...' : 'Assign'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setAssigningProjectId(null)}
                          className="btn btn-secondary btn-sm"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Site Logs Summary */}
                  <div className="border-t border-hairline pt-3 flex items-center justify-between text-caption text-muted">
                    <span>
                      {p._count.commissioningLogs} site log{p._count.commissioningLogs === 1 ? '' : 's'} recorded
                    </span>
                    <Link href={`/pm/projects/${p.id}`} className="hover:text-ink hover:underline">
                      View project details →
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* SECTION 2: PENDING COMMISSIONING */}
      <section className="space-y-4">
        <div className="flex items-center justify-between border-b border-hairline pb-2">
          <div>
            <h2 className="text-title-sm font-semibold text-ink">Pending Commissioning</h2>
            <p className="text-body-sm text-muted">
              Completed projects waiting for site engineer assignment ({pendingProjects.length})
            </p>
          </div>
        </div>

        {pendingProjects.length === 0 ? (
          <div className="card p-6 text-center text-body-sm text-muted">
            No completed projects waiting for commissioning.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {pendingProjects.map((p) => (
              <div key={p.id} className="card border-hairline bg-surface p-5 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/pm/projects/${p.id}`}
                        className="font-mono text-body-sm font-semibold text-accent hover:underline"
                      >
                        {p.code}
                      </Link>
                      <StatusBadge status="PENDING" />
                      {p.workOrderNo ? (
                        <span className="text-caption text-muted">WO: {p.workOrderNo}</span>
                      ) : (
                        <span className="badge bg-amber-500/10 text-amber-700 dark:text-amber-300 text-[10px] font-bold">
                          SERVICE CALL
                        </span>
                      )}
                    </div>
                    <h3 className="text-base font-semibold text-ink mt-1">
                      <Link href={`/pm/projects/${p.id}`} className="hover:underline">
                        {p.name}
                      </Link>
                    </h3>
                    <p className="text-body-sm text-muted">
                      Client: <span className="text-ink font-medium">{p.clientName}</span> · Completed:{' '}
                      {p.actualEndDate ? formatDate(p.actualEndDate) : 'Recently'}
                    </p>
                  </div>

                  <div>
                    {assigningProjectId !== p.id ? (
                      <button
                        type="button"
                        onClick={() => {
                          setAssigningProjectId(p.id);
                          setSelectedEngineerId('');
                        }}
                        className="btn btn-primary btn-sm font-medium"
                      >
                        Assign commissioning engineer
                      </button>
                    ) : (
                      <div className="flex items-center gap-2">
                        <select
                          value={selectedEngineerId}
                          onChange={(e) => setSelectedEngineerId(e.target.value)}
                          className="select select-sm text-body-sm min-w-[260px] bg-surface"
                        >
                          <option value="">Select an engineer from any team...</option>
                          {engineers.map((eng) => (
                            <option key={eng.id} value={eng.id}>
                              {formatName(eng.fullName)} ({eng.employeeCode}) — {eng.designation || eng.grade}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          disabled={!selectedEngineerId || isPending}
                          onClick={() => handleAssign(p.id, selectedEngineerId)}
                          className="btn btn-primary btn-sm"
                        >
                          {isPending ? 'Assigning...' : 'Deploy'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setAssigningProjectId(null)}
                          className="btn btn-secondary btn-sm"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* CONFIRM CLOSE MODAL */}
      {closingProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="card w-full max-w-md border-hairline bg-surface p-6 shadow-xl space-y-4">
            <h3 className="text-title-sm font-semibold text-ink">Mark Commissioning Complete?</h3>
            <p className="text-body-sm text-muted">
              Are you sure you want to mark site commissioning complete for{' '}
              <strong className="text-ink">{closingProject.name}</strong>?
            </p>
            <p className="text-caption text-muted">
              This will release all deployed site engineers and transition the project status to{' '}
              <span className="font-semibold text-ink">CLOSED</span>.
            </p>
            <div className="flex justify-end gap-2 pt-2 border-t border-hairline">
              <button
                type="button"
                disabled={isPending}
                onClick={() => setClosingProject(null)}
                className="btn btn-secondary btn-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={handleCloseCommissioning}
                className="btn btn-primary btn-sm bg-success text-on-primary hover:bg-success/90"
              >
                {isPending ? 'Closing...' : 'Yes, Commissioning Complete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
