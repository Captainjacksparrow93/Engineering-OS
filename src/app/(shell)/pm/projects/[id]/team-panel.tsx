'use client';

import { useState, useActionState } from 'react';
import { addMemberAction, removeMemberAction, reassignMemberTasksAction, type ActionState } from '@/app/actions/pm';
import { FormMessage, SubmitButton } from '@/components/form';
import { Avatar } from '@/components/ui';
import { formatName } from '@/core/utils/strings';

interface Member {
  id: string;
  role: string;
  allocationPercent: number;
  user: { id: string; fullName: string; avatarColor: string; designation: string | null; grade: string };
}

export function TeamPanel({
  projectId,
  members,
  canManage,
  colleagues,
}: {
  projectId: string;
  members: Member[];
  canManage: boolean;
  colleagues: Array<{ id: string; fullName: string; designation?: string | null }>;
}) {
  const [addState, addAction] = useActionState<ActionState, FormData>(addMemberAction, {});
  const [removeState, removeAction] = useActionState<ActionState, FormData>(removeMemberAction, {});
  const [reassignState, reassignAction] = useActionState<ActionState, FormData>(reassignMemberTasksAction, {});
  const [reassigningMemberId, setReassigningMemberId] = useState<string | null>(null);

  const memberIds = new Set(members.map((m) => m.user.id));
  const available = colleagues.filter((c) => !memberIds.has(c.id));

  return (
    <section className="card">
      <header className="card-header">
        <h2 className="card-title">Team ({members.length})</h2>
      </header>

      <div className="card-body">
        <ul className="space-y-3">
          {members.map((member) => {
            const isOwner = member.role === 'MANAGER';
            const isReassigning = reassigningMemberId === member.user.id;

            return (
              <li key={member.id} className="space-y-2 border-b border-hairline/50 pb-2.5 last:border-b-0 last:pb-0">
                <div className="flex items-center gap-2">
                  <Avatar name={formatName(member.user.fullName)} color={member.user.avatarColor} size={26} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body-sm font-medium text-ink">
                      {formatName(member.user.fullName)}
                    </p>
                    <p className="truncate text-caption text-muted">
                      {isOwner ? (
                        <span className="font-semibold text-primary">Project Owner (PM)</span>
                      ) : (
                        member.user.designation || member.role.toLowerCase()
                      )}
                    </p>
                  </div>

                  {canManage ? (
                    <div className="flex items-center gap-1">
                      {/* Bulk Task Reassign / Handover Button */}
                      <button
                        type="button"
                        onClick={() => setReassigningMemberId(isReassigning ? null : member.user.id)}
                        className={`btn btn-secondary btn-sm h-7 w-7 p-0 flex items-center justify-center text-xs ${
                          isReassigning ? 'bg-surface-strong border-ink text-ink' : ''
                        }`}
                        title={`Reassign all tasks of ${formatName(member.user.fullName)} to another member`}
                      >
                        ⇄
                      </button>

                      {/* Remove Member Button (non-owner only) */}
                      {!isOwner ? (
                        <form action={removeAction}>
                          <input type="hidden" name="projectId" value={projectId} />
                          <input type="hidden" name="userId" value={member.user.id} />
                          <SubmitButton
                            variant="secondary"
                            size="sm"
                            className="h-7 w-7 p-0 flex items-center justify-center text-xs"
                            confirm={`Remove ${formatName(member.user.fullName)} from this project?`}
                          >
                            ✕
                          </SubmitButton>
                        </form>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                {/* Inline Bulk Reassign Drawer */}
                {isReassigning ? (
                  <form action={reassignAction} className="rounded-lg border border-hairline bg-canvas-soft p-2.5 space-y-2">
                    <p className="text-caption font-semibold text-ink">
                      Reassign all tasks to:
                    </p>
                    <input type="hidden" name="projectId" value={projectId} />
                    <input type="hidden" name="fromUserId" value={member.user.id} />
                    <select name="toUserId" required className="select select-sm w-full" defaultValue="">
                      <option value="" disabled>Select target colleague</option>
                      {colleagues
                        .filter((c) => c.id !== member.user.id)
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {formatName(c.fullName)} ({c.designation || 'Engineer'})
                          </option>
                        ))}
                    </select>
                    <div className="flex justify-end gap-1.5 pt-1">
                      <button
                        type="button"
                        onClick={() => setReassigningMemberId(null)}
                        className="btn btn-secondary btn-sm"
                      >
                        Cancel
                      </button>
                      <SubmitButton size="sm" variant="primary">
                        Transfer all tasks
                      </SubmitButton>
                    </div>
                  </form>
                ) : null}
              </li>
            );
          })}
        </ul>

        <FormMessage state={removeState} />
        <FormMessage state={reassignState} />

        {canManage && available.length > 0 ? (
          <form action={addAction} className="mt-4 border-t border-hairline pt-3">
            <p className="mb-2 text-caption font-semibold uppercase tracking-wider text-muted-soft">Add Member</p>
            <input type="hidden" name="projectId" value={projectId} />
            <div className="field">
              <label className="label" htmlFor="member-user">Employee</label>
              <select id="member-user" name="userId" required className="select w-full" defaultValue="">
                <option value="" disabled>Select technical colleague</option>
                {available.map((person) => (
                  <option key={person.id} value={person.id}>
                    {formatName(person.fullName)} - {person.designation || 'Engineer'}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="label" htmlFor="member-role">Role on this project</label>
              <select id="member-role" name="role" className="select w-full" defaultValue="ENGINEER">
                {['LEAD', 'ENGINEER', 'REVIEWER', 'OBSERVER'].map((role) => (
                  <option key={role} value={role}>{role.toLowerCase()}</option>
                ))}
              </select>
            </div>
            <FormMessage state={addState} />
            <div className="mt-2">
              <SubmitButton size="sm" className="w-full">Add to project</SubmitButton>
            </div>
          </form>
        ) : null}
      </div>
    </section>
  );
}
