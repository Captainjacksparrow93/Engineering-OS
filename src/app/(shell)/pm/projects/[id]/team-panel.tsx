'use client';

import { useActionState, useState } from 'react';
import { addMemberAction, removeMemberAction, type ActionState } from '@/app/actions/pm';
import { FormMessage, SubmitButton } from '@/components/form';
import { Avatar } from '@/components/ui';

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
  const [adding, setAdding] = useState(false);

  const memberIds = new Set(members.map((m) => m.user.id));
  const available = colleagues.filter((c) => !memberIds.has(c.id));

  return (
    <section className="card">
      <header className="card-header">
        <h2 className="card-title">Team ({members.length})</h2>
        {canManage ? (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAdding((v) => !v)}>
            {adding ? 'Cancel' : 'Add'}
          </button>
        ) : null}
      </header>

      <div className="card-body">
        <ul className="space-y-2">
          {members.map((member) => (
            <li key={member.id} className="flex items-center gap-2">
              <Avatar name={member.user.fullName} color={member.user.avatarColor} size={26} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-800">{member.user.fullName}</p>
                <p className="truncate text-[11px] text-slate-500">
                  {member.role.toLowerCase()}
                  {member.user.designation ? ` · ${member.user.designation}` : ''}
                </p>
              </div>
              {canManage && member.role !== 'MANAGER' ? (
                <form action={removeAction}>
                  <input type="hidden" name="projectId" value={projectId} />
                  <input type="hidden" name="userId" value={member.user.id} />
                  <SubmitButton variant="secondary" size="sm" confirm={`Remove ${member.user.fullName} from this project?`}>
                    ✕
                  </SubmitButton>
                </form>
              ) : null}
            </li>
          ))}
        </ul>

        <FormMessage state={removeState} />

        {adding ? (
          <form action={addAction} className="mt-3 border-t border-surface-border pt-3">
            <input type="hidden" name="projectId" value={projectId} />
            <div className="field">
              <label className="label" htmlFor="member-user">Employee</label>
              <select id="member-user" name="userId" required className="select" defaultValue="">
                <option value="" disabled>Select</option>
                {available.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.fullName}{person.designation ? ` — ${person.designation}` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="label" htmlFor="member-role">Role on this project</label>
              <select id="member-role" name="role" className="select" defaultValue="ENGINEER">
                {['LEAD', 'ENGINEER', 'REVIEWER', 'OBSERVER'].map((role) => (
                  <option key={role} value={role}>{role.toLowerCase()}</option>
                ))}
              </select>
              <p className="hint">Grants matching rights on this project only.</p>
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
