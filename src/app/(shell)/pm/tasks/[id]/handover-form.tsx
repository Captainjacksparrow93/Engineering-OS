'use client';

import { useActionState, useState } from 'react';
import { requestHandoverAction, type ActionState } from '@/app/actions/pm';
import { FormMessage, SubmitButton } from '@/components/form';
import { StatusBadge } from '@/components/ui';

interface Candidate {
  id: string;
  fullName: string;
  designation: string | null;
  score: number;
  freeHours: number;
  status: string;
  matchedSkills: string[];
}

/**
 * Peer handover.
 *
 * The candidate list is ranked by current load and skill fit, so the engineer passing
 * work on does not simply hand it to whoever they sit next to - the peer who can
 * actually absorb it comes first.
 */
export function HandoverForm({
  taskId,
  remainingPercent,
  candidates,
  fallbackPeers,
}: {
  taskId: string;
  remainingPercent: number;
  candidates: Candidate[];
  fallbackPeers: Array<{ id: string; fullName: string; designation: string | null }>;
}) {
  const [state, action] = useActionState<ActionState, FormData>(requestHandoverAction, {});
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState('');

  if (!open) {
    return (
      <button type="button" className="btn btn-secondary w-full" onClick={() => setOpen(true)}>
        Hand remaining work to a peer
      </button>
    );
  }

  const ranked = candidates.slice(0, 6);

  return (
    <section className="card border-violet-200">
      <header className="card-header bg-violet-50/60">
        <h2 className="card-title">Hand over {remainingPercent}% remaining</h2>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </header>
      <form action={action} className="card-body">
        <input type="hidden" name="taskId" value={taskId} />

        {ranked.length > 0 ? (
          <>
            <p className="label">Suggested peers</p>
            <ul className="mb-3 space-y-1.5">
              {ranked.map((candidate) => (
                <li key={candidate.id}>
                  <label
                    className={`flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 transition ${
                      selected === candidate.id ? 'border-brand-500 bg-brand-50' : 'border-surface-border hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="toUserId"
                      value={candidate.id}
                      checked={selected === candidate.id}
                      onChange={() => setSelected(candidate.id)}
                      className="accent-brand-600"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-800">{candidate.fullName}</span>
                      <span className="block truncate text-[11px] text-slate-500">
                        {candidate.designation ?? ''} · {candidate.freeHours}h free
                        {candidate.matchedSkills.length ? ` · ${candidate.matchedSkills.join(', ')}` : ''}
                      </span>
                    </span>
                    <StatusBadge status={candidate.status} />
                    <span className="text-xs font-semibold text-brand-600">{candidate.score}</span>
                  </label>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <div className="field">
            <label className="label" htmlFor="toUserId">Hand over to</label>
            <select id="toUserId" name="toUserId" required className="select" defaultValue="">
              <option value="" disabled>Select a peer</option>
              {fallbackPeers.map((peer) => (
                <option key={peer.id} value={peer.id}>
                  {peer.fullName}{peer.designation ? ` — ${peer.designation}` : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="field">
          <label className="label" htmlFor="reason">Why are you passing this on? *</label>
          <textarea
            id="reason"
            name="reason"
            rows={3}
            required
            className="textarea"
            placeholder="e.g. Called to site for three days. Schematics done up to feeder 6; feeder 7-9 and the cable schedule are open."
          />
          <p className="hint">They must accept before the task moves. Your manager is notified either way.</p>
        </div>

        <FormMessage state={state} />
        <div className="mt-2">
          <SubmitButton className="w-full" pendingLabel="Sending…">Send handover request</SubmitButton>
        </div>
      </form>
    </section>
  );
}
