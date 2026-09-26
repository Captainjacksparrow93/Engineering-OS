'use client';

import { useActionState, useState } from 'react';
import { requestHandoverAction, type ActionState } from '@/app/actions/pm';
import { FormMessage, SubmitButton } from '@/components/form';
import { StatusBadge } from '@/components/ui';
import { formatName } from '@/core/utils/strings';

interface Candidate {
  id: string;
  fullName: string;
  designation: string | null;
  score: number;
  freeHours: number;
  status: string;
  matchedSkills: string[];
  needsApproval?: boolean;
}

export function HandoverForm({
  taskId,
  remainingPercent,
  candidates,
  fallbackPeers,
}: {
  taskId: string;
  remainingPercent: number;
  candidates: Candidate[];
  fallbackPeers: Array<{ id: string; fullName: string; designation: string | null; needsApproval?: boolean }>;
}) {
  const [state, action] = useActionState<ActionState, FormData>(requestHandoverAction, {});
  const [selected, setSelected] = useState('');

  const ranked = candidates.slice(0, 8);

  return (
    <section className="card border-hairline">
      <header className="card-header bg-canvas-soft">
        <h2 className="card-title">Request reassign ({remainingPercent}% remaining)</h2>
      </header>
      <form action={action} className="card-body">
        <input type="hidden" name="taskId" value={taskId} />

        {ranked.length > 0 ? (
          <>
            <p className="label">Available engineers (lowest load first)</p>
            <ul className="mb-3 space-y-1.5">
              {ranked.map((candidate) => {
                const freeDays = Math.max(0, Math.floor(candidate.freeHours / 8));
                return (
                  <li key={candidate.id}>
                    <label
                      className={`flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 transition ${
                        selected === candidate.id ? 'border-ink bg-canvas-soft' : 'border-hairline hover:bg-canvas-soft'
                      }`}
                    >
                      <input
                        type="radio"
                        name="toUserId"
                        value={candidate.id}
                        checked={selected === candidate.id}
                        onChange={() => setSelected(candidate.id)}
                        className="accent-ink"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5 truncate text-body-sm font-medium text-ink">
                          <span className="truncate">{formatName(candidate.fullName)}</span>
                          {candidate.needsApproval ? (
                            <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                              Needs Head approval
                            </span>
                          ) : null}
                        </span>
                        <span className="block truncate text-caption text-muted">
                          {candidate.designation ?? 'Engineer'} · {freeDays} {freeDays === 1 ? 'day' : 'days'} free ({candidate.freeHours}h)
                          {candidate.matchedSkills.length ? ` · ${candidate.matchedSkills.join(', ')}` : ''}
                        </span>
                      </span>
                      <StatusBadge status={candidate.status} />
                    </label>
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <div className="field">
            <label className="label" htmlFor="toUserId">Reassign to</label>
            <select id="toUserId" name="toUserId" required className="select w-full" defaultValue="">
              <option value="" disabled>Select an engineer</option>
              {fallbackPeers.map((peer) => (
                <option key={peer.id} value={peer.id}>
                  {formatName(peer.fullName)}{peer.designation ? ` - ${peer.designation}` : ''}{peer.needsApproval ? ' (Needs Head approval)' : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="field">
          <label className="label" htmlFor="reason">Why is this work moving? *</label>
          <textarea
            id="reason"
            name="reason"
            rows={2}
            required
            className="textarea w-full text-xs"
            placeholder="e.g. Needs field wiring experience; reassigning to Sahil for commissioning."
          />
          <p className="hint text-caption text-muted mt-1">They must accept before ownership moves. Everyone involved will be notified.</p>
        </div>

        <FormMessage state={state} />
        <div className="mt-2">
          <SubmitButton variant="ink" className="w-full" pendingLabel="Submitting…">Request reassign</SubmitButton>
        </div>
      </form>
    </section>
  );
}
