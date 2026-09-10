'use client';

import { useActionState, useState } from 'react';
import {
  assignTaskAction,
  changeTaskStatusAction,
  deleteTaskAction,
  type ActionState,
} from '@/app/actions/pm';
import { FormMessage, SubmitButton } from '@/components/form';

const NEXT_STATUS: Record<string, Array<{ value: string; label: string; variant?: 'primary' | 'secondary' }>> = {
  DRAFT: [{ value: 'TODO', label: 'Release to the queue', variant: 'primary' }],
  BLOCKED: [{ value: 'IN_PROGRESS', label: 'Start anyway', variant: 'secondary' }],
  TODO: [{ value: 'IN_PROGRESS', label: 'Start work', variant: 'primary' }],
  IN_PROGRESS: [
    { value: 'IN_REVIEW', label: 'Send for review', variant: 'primary' },
    { value: 'COMPLETED', label: 'Mark complete', variant: 'secondary' },
  ],
  IN_REVIEW: [
    { value: 'COMPLETED', label: 'Approve & complete', variant: 'primary' },
    { value: 'IN_PROGRESS', label: 'Send back', variant: 'secondary' },
  ],
  COMPLETED: [{ value: 'IN_PROGRESS', label: 'Reopen', variant: 'secondary' }],
  CANCELLED: [{ value: 'TODO', label: 'Restore', variant: 'secondary' }],
};

export function TaskControls({
  task,
  permissions,
  assignableUsers,
}: {
  task: { id: string; status: string; projectId: string };
  permissions: { canEdit: boolean; canAssign: boolean; canDelete: boolean; isHolder: boolean };
  assignableUsers: Array<{ id: string; fullName: string; designation: string | null }>;
}) {
  const [statusState, statusAction] = useActionState<ActionState, FormData>(changeTaskStatusAction, {});
  const [assignState, assignAction] = useActionState<ActionState, FormData>(assignTaskAction, {});
  const [deleteState, deleteAction] = useActionState<ActionState, FormData>(deleteTaskAction, {});
  const [reassigning, setReassigning] = useState(false);

  const transitions = NEXT_STATUS[task.status] ?? [];
  const mayTransition = permissions.canEdit || permissions.isHolder;

  return (
    <section className="card">
      <header className="card-header">
        <h2 className="card-title">Actions</h2>
      </header>
      <div className="card-body space-y-3">
        {mayTransition && transitions.length > 0 ? (
          <div className="flex flex-col gap-2">
            {transitions.map((transition) => (
              <form key={transition.value} action={statusAction}>
                <input type="hidden" name="taskId" value={task.id} />
                <input type="hidden" name="status" value={transition.value} />
                <SubmitButton variant={transition.variant ?? 'secondary'} className="w-full">
                  {transition.label}
                </SubmitButton>
              </form>
            ))}
            {task.status !== 'CANCELLED' && task.status !== 'COMPLETED' && permissions.canEdit ? (
              <form action={statusAction}>
                <input type="hidden" name="taskId" value={task.id} />
                <input type="hidden" name="status" value="CANCELLED" />
                <SubmitButton variant="danger" className="w-full" confirm="Cancel this task?">
                  Cancel task
                </SubmitButton>
              </form>
            ) : null}
          </div>
        ) : null}

        <FormMessage state={statusState} />

        {permissions.canAssign ? (
          <div className="border-t border-surface-border pt-3">
            {reassigning ? (
              <form action={assignAction}>
                <input type="hidden" name="taskId" value={task.id} />
                <div className="field">
                  <label className="label" htmlFor="assign-user">Reassign to</label>
                  <select id="assign-user" name="userId" required className="select" defaultValue="">
                    <option value="" disabled>Select</option>
                    {assignableUsers.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.fullName}{user.designation ? ` — ${user.designation}` : ''}
                      </option>
                    ))}
                  </select>
                  <p className="hint">Management reassignment takes effect immediately - it is not a peer handover.</p>
                </div>
                <div className="field">
                  <label className="label" htmlFor="assign-role">As</label>
                  <select id="assign-role" name="role" className="select" defaultValue="OWNER">
                    <option value="OWNER">Owner (replaces current)</option>
                    <option value="COLLABORATOR">Collaborator (works alongside)</option>
                    <option value="REVIEWER">Reviewer</option>
                  </select>
                </div>
                <FormMessage state={assignState} />
                <div className="mt-2 flex gap-2">
                  <SubmitButton size="sm">Confirm</SubmitButton>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setReassigning(false)}>
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <button type="button" className="btn btn-secondary w-full" onClick={() => setReassigning(true)}>
                Assign / reassign
              </button>
            )}
          </div>
        ) : null}

        {permissions.canDelete ? (
          <form action={deleteAction} className="border-t border-surface-border pt-3">
            <input type="hidden" name="taskId" value={task.id} />
            <input type="hidden" name="projectId" value={task.projectId} />
            <SubmitButton variant="danger" size="sm" className="w-full" confirm="Delete this task permanently?">
              Delete task
            </SubmitButton>
            <FormMessage state={deleteState} />
          </form>
        ) : null}
      </div>
    </section>
  );
}
