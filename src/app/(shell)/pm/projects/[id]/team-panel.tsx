'use client';

import { useActionState } from 'react';
import { addMemberAction, removeMemberAction, type ActionState } from '@/app/actions/pm';
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

  const memberIds = new Set(members.map((m) => m.user.id));
  const available = colleagues.filter((c) => !memberIds.has(c.id));

  return (
    <section className="card">
      <header className="card-header">
        <h2 className="card-title">Team ({members.length})</h2>
      </header>

      <div className="card-body">
        <ul className="space-y-2">
          {members.map((member) => (
            <li key={member.id} className="flex items-center gap-2">
              <Avatar name={formatName(member.user.fullName)} color={member.user.avatarColor} size={26} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-body-sm font-medium text-ink">{formatName(member.user.fullName)}</p>
                <p className="truncate text-caption text-muted">
                  {member.user.designation || member.role.toLowerCase()}
                </p>
              </div>
              {canManage && member.role !== 'MANAGER' ? (
                <form action={removeAction}>
                  <input type="hidden" name="projectId" value={projectId} />
                  <input type="hidden" name="userId" value={member.user.id} />
                  <SubmitButton variant="secondary" size="sm" confirm={`Remove ${formatName(member.user.fullName)} from this project?`}>
                    ✕
                  </SubmitButton>
                </form>
              ) : null}
            </li>
          ))}
        </ul>

        <FormMessage state={removeState} />

        {canManage && available.length > 0 ? (
          <form action={addAction} className="mt-4 border-t border-hairline pt-3">
            <p className="mb-2 text-caption font-semibold uppercase tracking-wider text-muted-soft">Add Member</p>
            <input type="hidden" name="projectId" value={projectId} />
            <div className="field">
              <label className="label" htmlFor="member-user">Employee</label>
              <select id="member-user" name="userId" required className="select w-full" defaultValue="">
                <option value="" disabled>Select colleague</option>
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
