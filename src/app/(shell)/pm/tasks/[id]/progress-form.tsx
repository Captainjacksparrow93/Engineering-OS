'use client';

import { useActionState, useState } from 'react';
import { logProgressAction, type ActionState } from '@/app/actions/pm';
import { FormMessage, SubmitButton } from '@/components/form';

const TICKS = [0, 25, 50, 75, 100];

export function ProgressForm({ taskId, currentPercent }: { taskId: string; currentPercent: number }) {
  const [state, action] = useActionState<ActionState, FormData>(logProgressAction, {});
  const [percent, setPercent] = useState(Math.min(100, Math.max(currentPercent, 25)));

  return (
    <section className="card border-hairline">
      <header className="card-header bg-canvas-soft flex items-center justify-between">
        <h2 className="card-title">Update progress</h2>
        <span className="text-caption text-muted">Currently {currentPercent}%</span>
      </header>
      <form action={action} className="card-body space-y-4">
        <input type="hidden" name="taskId" value={taskId} />

        <div className="field">
          <label htmlFor="percentComplete" className="label flex items-baseline justify-between mb-xs cursor-pointer">
            <span>New completion</span>
            <span className="text-display-sm font-semibold text-ink normal-case tracking-normal">{percent}%</span>
          </label>

          <input
            id="percentComplete"
            type="range"
            name="percentComplete"
            min={currentPercent}
            max={100}
            step={5}
            value={percent}
            onChange={(e) => setPercent(Number(e.target.value))}
            className="w-full accent-ink cursor-pointer"
            aria-label="New completion"
            aria-valuetext={`${percent}%`}
          />

          <div className="relative mt-1 h-4 text-caption text-muted select-none" aria-hidden="true">
            {TICKS.map((val) => (
              <span
                key={val}
                style={{ left: `${val}%` }}
                className={`absolute ${
                  val === 0 ? 'translate-x-0' : val === 100 ? '-translate-x-full' : '-translate-x-1/2'
                }`}
              >
                {val}
              </span>
            ))}
          </div>

          <p className="hint mt-2 text-caption text-muted">Progress cannot be reduced. If 100% is submitted, task moves to waiting for approval.</p>
        </div>

        <div className="field">
          <label className="label" htmlFor="note">What moved forward? *</label>
          <textarea
            id="note"
            name="note"
            rows={2}
            required
            className="textarea w-full"
            placeholder="e.g. Completed wiring and verified I/O mapping."
          />
        </div>

        <FormMessage state={state} />

        <div className="pt-1">
          <SubmitButton pendingLabel="Recording…">Update progress</SubmitButton>
        </div>
      </form>
    </section>
  );
}
