'use client';

import { useActionState, useState } from 'react';
import { setRolePermissionsAction } from '@/app/actions/admin';
import type { ActionState } from '@/app/actions/pm';
import { FormMessage, SubmitButton } from '@/components/form';

export function RolePermissionEditor({
  roleKey,
  grouped,
  selected,
}: {
  roleKey: string;
  grouped: Record<string, Array<{ key: string; description: string }>>;
  selected: string[];
}) {
  const [state, action] = useActionState<ActionState, FormData>(setRolePermissionsAction, {});
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      <>
        <div className="mb-3 flex flex-wrap gap-1">
          {selected.map((key) => (
            <span key={key} className="badge bg-slate-100 font-mono text-slate-600">
              {key}
            </span>
          ))}
        </div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing(true)}>
          Edit permissions
        </button>
      </>
    );
  }

  return (
    <form action={action}>
      <input type="hidden" name="roleKey" value={roleKey} />
      <div className="grid gap-4 sm:grid-cols-2">
        {Object.entries(grouped).map(([module, permissions]) => (
          <fieldset key={module} className="rounded-md border border-surface-border p-3">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{module}</legend>
            <div className="space-y-1.5">
              {permissions.map((permission) => (
                <label key={permission.key} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="permissions"
                    value={permission.key}
                    defaultChecked={selected.includes(permission.key)}
                    className="mt-1 accent-brand-600"
                  />
                  <span>
                    <span className="block font-mono text-[11px] text-slate-500">{permission.key}</span>
                    <span className="block text-slate-700">{permission.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
      <FormMessage state={state} />
      <div className="mt-3 flex gap-2">
        <SubmitButton size="sm" confirm="Apply these permissions to everyone holding this role?">Save role</SubmitButton>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
