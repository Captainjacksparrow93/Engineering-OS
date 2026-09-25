'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { formatDate } from '@/core/utils/dates';
import { useToast } from '@/components/toast';
import { createCommissioningLogAction } from '@/app/actions/pm';

interface AssignedProject {
  id: string;
  code: string;
  name: string;
  clientName: string;
  workOrderNo?: string | null;
  panelCount: number;
  status: string;
}

interface SiteLog {
  id: string;
  projectId: string;
  loggedFor: Date | string;
  workDone: string;
  blocker: string | null;
  approvedById: string | null;
  approvedAt: Date | string | null;
  rejectedAt: Date | string | null;
  decisionNote: string | null;
  createdAt: Date | string;
  project: {
    id: string;
    code: string;
    name: string;
    clientName: string;
  };
}

export function MyCommissioningClient({
  projects,
  recentLogs,
}: {
  projects: AssignedProject[];
  recentLogs: SiteLog[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();

  const todayIso = new Date().toISOString().split('T')[0];

  const [selectedProjectId, setSelectedProjectId] = useState<string>(projects[0]?.id || '');
  const [logDate, setLogDate] = useState<string>(todayIso);
  const [workDone, setWorkDone] = useState<string>('');
  const [blocker, setBlocker] = useState<string>('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProjectId) {
      toast.error('Please select an assigned project.');
      return;
    }
    if (!workDone.trim()) {
      toast.error('Please describe the work done today.');
      return;
    }

    startTransition(async () => {
      const res = await createCommissioningLogAction({
        projectId: selectedProjectId,
        loggedFor: logDate,
        workDone: workDone.trim(),
        blocker: blocker.trim() || null,
      });

      if (!res.success) {
        toast.error(res.error || 'Failed to submit site log.');
      } else {
        toast.success('Site log recorded successfully.');
        setWorkDone('');
        setBlocker('');
        router.refresh();
      }
    });
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      {/* LEFT 1 COL: DAILY LOG FORM */}
      <div className="card border-hairline bg-surface p-5 lg:col-span-1 space-y-4">
        <header className="border-b border-hairline pb-3">
          <h2 className="card-title text-ink font-semibold">Record Site Attendance</h2>
          <p className="text-caption text-muted mt-0.5">
            Log your daily activity and any blockers on site.
          </p>
        </header>

        {projects.length === 0 ? (
          <div className="py-6 text-center text-body-sm text-muted">
            You are not currently assigned to any active site commissioning projects.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label text-caption font-semibold uppercase tracking-wider text-muted">
                Project *
              </label>
              <select
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(e.target.value)}
                className="select w-full bg-surface text-body-sm mt-1"
                required
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} — {p.name} ({p.clientName})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="label text-caption font-semibold uppercase tracking-wider text-muted">
                Date On Site *
              </label>
              <input
                type="date"
                value={logDate}
                onChange={(e) => setLogDate(e.target.value)}
                className="input w-full bg-surface text-body-sm mt-1"
                required
              />
            </div>

            <div>
              <label className="label text-caption font-semibold uppercase tracking-wider text-muted">
                Work Done Today *
              </label>
              <textarea
                value={workDone}
                onChange={(e) => setWorkDone(e.target.value)}
                placeholder="Details of cabling, loop checks, testing, calibration, or plant integration conducted..."
                rows={4}
                className="textarea w-full bg-surface text-body-sm mt-1"
                required
              />
            </div>

            <div>
              <label className="label text-caption font-semibold uppercase tracking-wider text-muted">
                Blockers / Issues (Optional)
              </label>
              <input
                type="text"
                value={blocker}
                onChange={(e) => setBlocker(e.target.value)}
                placeholder="e.g. Site power supply not ready, client drawing missing"
                className="input w-full bg-surface text-body-sm mt-1"
              />
            </div>

            <button
              type="submit"
              disabled={isPending || !selectedProjectId || !workDone.trim()}
              className="btn btn-primary w-full text-body-sm font-medium"
            >
              {isPending ? 'Submitting...' : 'Submit Daily Log'}
            </button>
          </form>
        )}
      </div>

      {/* RIGHT 2 COLS: RECENT LOGS */}
      <div className="card border-hairline bg-surface p-5 lg:col-span-2 space-y-4">
        <header className="flex items-center justify-between border-b border-hairline pb-3">
          <div>
            <h2 className="card-title text-ink font-semibold">Your Site History</h2>
            <p className="text-caption text-muted mt-0.5">
              Recent daily logs and verification status
            </p>
          </div>
          <span className="text-caption text-muted">{recentLogs.length} logs recorded</span>
        </header>

        {recentLogs.length === 0 ? (
          <div className="py-8 text-center text-body-sm text-muted">
            No site logs recorded yet. Use the form on the left to submit your first daily log.
          </div>
        ) : (
          <div className="divide-y divide-hairline">
            {recentLogs.map((log) => {
              const isApproved = Boolean(log.approvedAt);
              const isRejected = Boolean(log.rejectedAt);

              return (
                <div key={log.id} className="py-3.5 space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-body-sm font-semibold text-ink">
                        {formatDate(log.loggedFor)}
                      </span>
                      <span className="text-caption text-muted">·</span>
                      <Link
                        href={`/pm/projects/${log.project.id}`}
                        className="font-mono text-body-sm text-accent hover:underline"
                      >
                        {log.project.code}
                      </Link>
                      <span className="text-body-sm text-muted">({log.project.name})</span>
                    </div>

                    <div>
                      {isApproved ? (
                        <span className="badge badge-success">Approved</span>
                      ) : isRejected ? (
                        <span className="badge badge-error">Rejected</span>
                      ) : (
                        <span className="badge badge-outline">Waiting approval</span>
                      )}
                    </div>
                  </div>

                  <p className="text-body-sm text-ink whitespace-pre-wrap">{log.workDone}</p>

                  {log.blocker && (
                    <div className="rounded bg-error/10 px-2.5 py-1 text-xs text-error font-medium">
                      Blocker: {log.blocker}
                    </div>
                  )}

                  {isRejected && log.decisionNote && (
                    <div className="rounded bg-surface-strong px-2.5 py-1 text-xs text-muted border border-hairline">
                      Head note: {log.decisionNote}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
