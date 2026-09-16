'use client';

import { useActionState } from 'react';
import {
  assignTaskAction,
  changeTaskStatusAction,
  deleteTaskAction,
  type ActionState,
} from '@/app/actions/pm';
import { FormMessage, SubmitButton } from '@/components/form';
import { formatName } from '@/core/utils/strings';

const NEXT_STATUS: Record<string, Array<{ value: string; label: string; variant?: 'primary' | 'secondary' }>> = {
  DRAFT: [{ value: 'TODO', label: 'Release to the queue', variant: 'primary' }],
  BLOCKED: [{ value: 'IN_PROGRESS', label: 'Resolve Roadblock & Resume', variant: 'primary' }],
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
            {transitions.map((transition, index) => (
              <form key={transition.value} action={statusAction}>
                <input type="hidden" name="taskId" value={task.id} />
                <input type="hidden" name="status" value={transition.value} />
                <SubmitButton variant={index === 0 ? (transition.variant ?? 'secondary') : 'secondary'} className="w-full">
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

        {mayTransition && task.status !== 'COMPLETED' && task.status !== 'CANCELLED' ? (
          <form
            action={async (formData: FormData) => {
              const comment = String(formData.get('comment') || '').trim();
              if (comment) {
                const { flagRoadblockAction } = await import('@/app/actions/pm');
                await flagRoadblockAction(task.id, comment);
              }
            }}
            className="rounded-lg border border-error/20 bg-error/[0.04] p-3 space-y-2"
          >
            <p className="text-caption font-semibold uppercase tracking-wider text-error">Raise a Roadblock</p>
            <textarea
              name="comment"
              required
              rows={2}
              className="textarea text-xs w-full bg-surface border-error/30 focus:border-error"
              placeholder="What is blocking this task? (e.g. Awaiting client drawing signoff)"
            />
            <button type="submit" className="btn btn-sm w-full bg-error text-white hover:opacity-90">
              Flag Roadblock
            </button>
          </form>
        ) : null}

        <FormMessage state={statusState} />

        {permissions.canAssign ? (
          <form action={assignAction} className="border-t border-hairline pt-3">
            <p className="mb-2 text-caption font-semibold uppercase tracking-wider text-muted-soft">Reassign Task</p>
            <input type="hidden" name="taskId" value={task.id} />
            <div className="field">
              <label className="label" htmlFor="assign-user">Reassign to</label>
              <select id="assign-user" name="userId" required className="select w-full" defaultValue="">
                <option value="" disabled>Select colleague</option>
                {assignableUsers.map((user) => (
                  <option key={user.id} value={user.id}>
                    {formatName(user.fullName)} {user.designation ? `(${user.designation})` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="label" htmlFor="assign-role">As</label>
              <select id="assign-role" name="role" className="select w-full" defaultValue="OWNER">
                <option value="OWNER">Owner (replaces current)</option>
                <option value="COLLABORATOR">Collaborator (works alongside)</option>
                <option value="REVIEWER">Reviewer</option>
              </select>
            </div>
            <FormMessage state={assignState} />
            <div className="mt-2">
              <SubmitButton size="sm" className="w-full">Reassign</SubmitButton>
            </div>
          </form>
        ) : null}

        {permissions.canDelete ? (
          <form action={deleteAction} className="border-t border-hairline pt-3">
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
