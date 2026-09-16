'use client';
import { formatName } from '@/core/utils/strings';

import { useActionState, useState } from 'react';
import { handoverProjectAction, type ActionState } from '@/app/actions/pm';
import { FormMessage, SubmitButton } from '@/components/form';


export function HandoverProjectButton({
  projectId,
  colleagues,
}: {
  projectId: string;
  colleagues: Array<{ id: string; fullName: string; designation?: string | null }>;
}) {
  const [show, setShow] = useState(false);
  const [state, action] = useActionState<ActionState, FormData>(handoverProjectAction, {});

  // Close modal on success
  if (state.success && show) {
    setShow(false);
  }

  if (!show) {
    return (
      <button onClick={() => setShow(true)} className="btn btn-secondary btn-sm">
        Handover Project
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="card w-full max-w-md bg-surface shadow-2xl animate-in fade-in zoom-in-95">
        <header className="card-header border-b border-hairline pb-3 flex justify-between">
          <h3 className="card-title text-base">Handover Project</h3>
          <button onClick={() => setShow(false)} className="text-muted hover:text-ink font-bold">&times;</button>
        </header>
        <form action={action} className="card-body space-y-4 pt-4">
          <p className="text-sm text-muted">
            Send a handover request to any employee or colleague. Once they review and accept the request in their Handovers dashboard, project ownership will transfer to them.
          </p>
          <input type="hidden" name="projectId" value={projectId} />
          <div>
            <label className="label">Select colleague / employee</label>
            <select name="newManagerId" className="select w-full" required>
              <option value="">[ Choose an employee ]</option>
              {colleagues.map((c) => (
                <option key={c.id} value={c.id}>{formatName(c.fullName)} ({c.designation || 'Team Member'})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Handover Note (Optional)</label>
            <textarea
              name="reason"
              rows={2}
              className="input w-full text-sm"
              placeholder="Context, current status, or instructions for the incoming manager..."
            />
          </div>
          <FormMessage state={state} />
          <footer className="pt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setShow(false)} className="btn btn-secondary btn-sm">Cancel</button>
            <SubmitButton className="btn btn-primary btn-sm">Send Handover Request</SubmitButton>
          </footer>
        </form>
      </div>
    </div>
  );
}


