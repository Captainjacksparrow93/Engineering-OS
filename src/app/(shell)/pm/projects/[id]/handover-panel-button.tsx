'use client';

import { useActionState, useState } from 'react';
import { requestPanelHandoverAction, type ActionState } from '@/app/actions/pm';
import { FormMessage, SubmitButton } from '@/components/form';
import { formatName } from '@/core/utils/strings';
import type { SquadGroup } from '@/components/assignee-cell';

export function HandoverPanelButton({
  projectId,
  phaseTaskId,
  panelTitle,
  remainingTaskCount,
  colleagues,
  squadGroups,
}: {
  projectId: string;
  phaseTaskId: string;
  panelTitle: string;
  remainingTaskCount: number;
  colleagues: Array<{ id: string; fullName: string; designation?: string | null }>;
  squadGroups?: SquadGroup<{ id: string; fullName: string; designation?: string | null }>[];
}) {
  const [show, setShow] = useState(false);
  const [state, action] = useActionState<ActionState, FormData>(requestPanelHandoverAction, {});

  // Close modal when successfully submitted
  if (state.success && show) {
    setShow(false);
  }

  if (!show) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setShow(true);
        }}
        className="btn btn-secondary btn-xs inline-flex items-center gap-1 text-caption font-semibold"
        title="Hand over remaining incomplete tasks in this panel"
      >
        <span>🔄</span>
        <span>Hand over remaining ({remainingTaskCount})</span>
      </button>
    );
  }

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 text-left font-normal"
    >
      <div className="card w-full max-w-md bg-surface border border-hairline animate-in fade-in zoom-in-95 shadow-xl">
        <header className="card-header border-b border-hairline pb-3 flex justify-between items-center">
          <div>
            <h3 className="card-title text-base font-semibold text-ink">Hand over remaining work</h3>
            <p className="text-caption text-muted">{panelTitle} · {remainingTaskCount} incomplete tasks</p>
          </div>
          <button
            type="button"
            onClick={() => setShow(false)}
            className="text-muted hover:text-ink font-bold text-lg p-1"
          >
            &times;
          </button>
        </header>

        <form action={action} className="card-body space-y-4 pt-4">
          <p className="text-body-sm text-muted">
            Request to hand over all <strong>{remainingTaskCount} remaining incomplete tasks</strong> in this panel to another engineer. Once they accept in their Handovers dashboard, task ownership will transfer to them.
          </p>

          <input type="hidden" name="phaseTaskId" value={phaseTaskId} />
          <input type="hidden" name="projectId" value={projectId} />

          <div>
            <label className="label text-caption font-semibold">Select engineer</label>
            <select name="toUserId" className="select w-full text-sm" required defaultValue="">
              <option value="" disabled>[ Choose an engineer ]</option>
              {squadGroups && squadGroups.length > 0 ? (
                squadGroups.map((group) => (
                  <optgroup key={group.leadId} label={group.label}>
                    {group.members.map((c) => (
                      <option key={c.id} value={c.id}>
                        {formatName(c.fullName)} ({c.designation || 'Engineer'})
                      </option>
                    ))}
                  </optgroup>
                ))
              ) : (
                colleagues.map((c) => (
                  <option key={c.id} value={c.id}>
                    {formatName(c.fullName)} ({c.designation || 'Engineer'})
                  </option>
                ))
              )}
            </select>
          </div>

          <div>
            <label className="label text-caption font-semibold">Handover Reason *</label>
            <textarea
              name="reason"
              rows={3}
              required
              minLength={5}
              className="input w-full text-sm"
              placeholder="e.g. Completed panel layout and BOM; handing over remaining IO and simulation work due to site visit."
            />
          </div>

          <FormMessage state={state} />

          <div className="flex justify-end gap-2 pt-2 border-t border-hairline">
            <button
              type="button"
              onClick={() => setShow(false)}
              className="btn btn-secondary text-sm"
            >
              Cancel
            </button>
            <SubmitButton variant="primary" pendingLabel="Submitting...">
              Submit Handover Request
            </SubmitButton>
          </div>
        </form>
      </div>
    </div>
  );
}
