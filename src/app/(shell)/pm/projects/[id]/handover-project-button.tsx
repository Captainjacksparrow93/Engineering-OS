'use client';

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
            This will transfer primary ownership of the project and reassign all of your open tasks in this project to the new manager.
          </p>
          <input type="hidden" name="projectId" value={projectId} />
          <div>
            <label className="label">Select new Project Manager</label>
            <select name="newManagerId" className="select w-full" required>
              <option value="">[ Choose a colleague ]</option>
              {colleagues.map((c) => (
                <option key={c.id} value={c.id}>{c.fullName} ({c.designation || 'Engineer'})</option>
              ))}
            </select>
          </div>
          <FormMessage state={state} />
          <footer className="pt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setShow(false)} className="btn btn-secondary btn-sm">Cancel</button>
            <SubmitButton className="btn btn-primary btn-sm">Confirm Handover</SubmitButton>
          </footer>
        </form>
      </div>
    </div>
  );
}


