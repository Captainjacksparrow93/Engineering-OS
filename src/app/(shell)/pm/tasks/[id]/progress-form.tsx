'use client';

import { useActionState, useState } from 'react';
import { logProgressAction, type ActionState } from '@/app/actions/pm';
import { FormMessage, SubmitButton } from '@/components/form';

/**
 * The punch-in. Deliberately short: percent, hours, what moved, and an optional
 * blocker. Anything longer and engineers stop filling it in, which is how progress
 * reporting dies in practice.
 */
export function ProgressForm({ taskId, currentPercent }: { taskId: string; currentPercent: number }) {
  const [state, action] = useActionState<ActionState, FormData>(logProgressAction, {});
  const [percent, setPercent] = useState(currentPercent);
  const [showBlocker, setShowBlocker] = useState(false);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <section className="card border-hairline">
      <header className="card-header bg-canvas-soft">
        <h2 className="card-title">Punch in progress</h2>
        <span className="text-caption text-muted">Currently {currentPercent}%</span>
      </header>
      <form action={action} className="card-body">
        <input type="hidden" name="taskId" value={taskId} />

        <div className="field">
          <label className="label" htmlFor="percentComplete">
            Completion: <span className="text-ink">{percent}%</span>
          </label>
          <input
            id="percentComplete"
            name="percentComplete"
            type="range"
            min={currentPercent}
            max={100}
            step={5}
            value={percent}
            onChange={(event) => setPercent(Number(event.target.value))}
            className="w-full accent-ink"
          />
          <p className="hint">Progress cannot be reduced. If work was undone, say so in the note and raise a blocker.</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="field">
            <label className="label" htmlFor="hoursSpent">Hours since last update</label>
            <input id="hoursSpent" name="hoursSpent" type="number" min="0" max="24" step="0.5" defaultValue={0} className="input" />
          </div>
          <div className="field">
            <label className="label" htmlFor="loggedFor">For date</label>
            <input id="loggedFor" name="loggedFor" type="date" max={today} defaultValue={today} className="input" />
          </div>
        </div>

        <div className="field">
          <label className="label" htmlFor="note">What moved forward? *</label>
          <textarea id="note" name="note" rows={2} required className="textarea" placeholder="e.g. Completed schematics for feeders 1-6; feeder 7 pending client input." />
        </div>

        {showBlocker ? (
          <div className="field rounded-md border border-error/30 bg-error/[0.04] p-3">
            <label className="label text-xs font-semibold text-error" htmlFor="blocker">
              Roadblock Explanation *
            </label>
            <textarea
              id="blocker"
              name="blocker"
              rows={2}
              required
              className="textarea text-sm w-full border-error/40 focus:border-error"
              placeholder="Describe exactly what is holding you up (e.g. Waiting for client approved P&ID revision 3, missing vendor GSD file for Danfoss VFD, etc.)"
            />
            <p className="hint text-error/80 mt-1">
              This handwritten explanation will immediately alert the Project Manager and Department Head on the Roadblock Radar.
            </p>
          </div>
        ) : null}

        <FormMessage state={state} />

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <SubmitButton pendingLabel="Recording…">Record progress</SubmitButton>
          <button type="button" className="btn btn-secondary" onClick={() => setShowBlocker((v) => !v)}>
            {showBlocker ? 'Remove blocker' : 'Raise a blocker'}
          </button>
        </div>
      </form>
    </section>
  );
}
