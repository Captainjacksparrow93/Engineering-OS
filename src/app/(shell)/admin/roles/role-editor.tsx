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

  // Map of key -> human description
  const descMap = new Map<string, string>();
  Object.values(grouped).forEach((list) => {
    list.forEach((p) => descMap.set(p.key, p.description));
  });

  if (!editing) {
    return (
      <>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {selected.map((key) => (
            <span key={key} className="badge bg-surface-strong text-body">
              {descMap.get(key) ?? key}
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
          <fieldset key={module} className="rounded-md border border-hairline p-3">
            <legend className="px-1 text-caption font-semibold uppercase tracking-wide text-muted">
              {module === 'admin' ? 'Administration' : module === 'pm' ? 'Project Management' : module}
            </legend>
            <div className="space-y-2 pt-1">
              {permissions.map((permission) => (
                <label key={permission.key} className="flex items-start gap-2.5 text-body-sm cursor-pointer hover:bg-canvas-soft p-1 rounded transition-colors">
                  <input
                    type="checkbox"
                    name="permissions"
                    value={permission.key}
                    defaultChecked={selected.includes(permission.key)}
                    className="mt-0.5 rounded border-hairline-strong text-primary focus:ring-primary h-4 w-4 accent-ink"
                  />
                  <span className="text-ink text-body-sm select-none">
                    {permission.description}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
      <FormMessage state={state} />
      <div className="mt-3 flex gap-2">
        <SubmitButton variant="primary" size="sm" confirm="Apply these permissions to everyone holding this role?">
          Save role
        </SubmitButton>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
