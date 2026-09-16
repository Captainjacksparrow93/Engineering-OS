'use client';

import { useActionState, useState } from 'react';
import { logProgressAction, type ActionState } from '@/app/actions/pm';
import { FormMessage, SubmitButton } from '@/components/form';

const PRESETS = [25, 50, 75, 100];

export function ProgressForm({ taskId, currentPercent }: { taskId: string; currentPercent: number }) {
  const [state, action] = useActionState<ActionState, FormData>(logProgressAction, {});
  const [percent, setPercent] = useState(Math.max(currentPercent, 25));
  const [showDatePicker, setShowDatePicker] = useState(false);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <section className="card border-hairline">
      <header className="card-header bg-canvas-soft flex items-center justify-between">
        <h2 className="card-title">Update progress</h2>
        <span className="text-caption text-muted">Currently {currentPercent}%</span>
      </header>
      <form action={action} className="card-body space-y-4">
        <input type="hidden" name="taskId" value={taskId} />
        <input type="hidden" name="percentComplete" value={percent} />

        <div className="field">
          <label className="label">
            New completion: <span className="font-semibold text-ink">{percent}%</span>
          </label>
          <div className="grid grid-cols-4 gap-2 mt-1">
            {PRESETS.map((val) => {
              const isDisabled = val < currentPercent;
              const isSelected = percent === val;
              return (
                <button
                  key={val}
                  type="button"
                  disabled={isDisabled}
                  onClick={() => setPercent(val)}
                  className={`btn btn-sm py-2 transition-colors ${
                    isSelected
                      ? 'bg-ink text-canvas font-semibold'
                      : isDisabled
                        ? 'opacity-40 cursor-not-allowed bg-canvas-soft text-muted'
                        : 'bg-surface hover:bg-canvas-soft border border-hairline text-ink'
                  }`}
                >
                  {val}%
                </button>
              );
            })}
          </div>
          <div className="mt-2.5 flex items-center gap-2">
            <span className="text-caption text-muted">Custom %:</span>
            <input
              type="number"
              min={currentPercent}
              max={100}
              step={1}
              value={percent}
              onChange={(e) => setPercent(Math.min(100, Math.max(currentPercent, Number(e.target.value) || currentPercent)))}
              className="input text-xs w-24 py-1"
            />
          </div>
          <p className="hint mt-1 text-caption text-muted">Progress cannot be reduced. If 100% is submitted, task moves to review.</p>
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

        <div>
          {!showDatePicker ? (
            <button
              type="button"
              onClick={() => setShowDatePicker(true)}
              className="text-caption text-muted hover:text-ink underline"
            >
              Log for a different day?
            </button>
          ) : (
            <div className="field">
              <label className="label" htmlFor="loggedFor">Date</label>
              <input id="loggedFor" name="loggedFor" type="date" max={today} defaultValue={today} className="input text-xs" />
            </div>
          )}
        </div>

        <FormMessage state={state} />

        <div className="pt-1">
          <SubmitButton pendingLabel="Recording…">Update progress</SubmitButton>
        </div>
      </form>
    </section>
  );
}
