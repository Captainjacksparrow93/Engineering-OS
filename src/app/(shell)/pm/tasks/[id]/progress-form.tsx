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
    <section className="card border-brand-100">
      <header className="card-header bg-brand-50/50">
        <h2 className="card-title">Punch in progress</h2>
        <span className="text-xs text-slate-500">Currently {currentPercent}%</span>
      </header>
      <form action={action} className="card-body">
        <input type="hidden" name="taskId" value={taskId} />

        <div className="field">
          <label className="label" htmlFor="percentComplete">
            Completion: <span className="text-brand-600">{percent}%</span>
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
            className="w-full accent-brand-600"
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
          <div className="field">
            <label className="label" htmlFor="blocker">Blocker</label>
            <textarea id="blocker" name="blocker" rows={2} className="textarea" placeholder="What is stopping you, and who needs to act?" />
            <p className="hint">Raising a blocker notifies the project manager and the sponsor immediately.</p>
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
