'use client';
import { formatName } from '@/core/utils/strings';

import { useActionState, useState } from 'react';
import clsx from 'clsx';
import { assignRoleAction, createUserAction, setUserStatusAction } from '@/app/actions/admin';
import type { ActionState } from '@/app/actions/pm';
import { FormMessage, SubmitButton } from '@/components/form';

const GRADES = [
  'TRAINEE',
  'JUNIOR_ENGINEER',
  'ENGINEER',
  'SENIOR_ENGINEER',
  'LEAD_ENGINEER',
  'MANAGER',
  'HEAD',
  'DIRECTOR',
];

interface UserAdminPanelProps {
  canCreate: boolean;
  canAssign: boolean;
  roles: Array<{ key: string; name: string }>;
  departments: Array<{ id: string; name: string }>;
  projects: Array<{ id: string; code: string; name: string }>;
  users: Array<{ id: string; fullName: string; employeeCode: string }>;
  searchQuery?: string;
  onSearchChange?: (q: string) => void;
  columnsButton?: React.ReactNode;
}

export function UserAdminPanel({
  canCreate,
  canAssign,
  roles,
  departments,
  projects,
  users,
  searchQuery = '',
  onSearchChange,
  columnsButton,
}: UserAdminPanelProps) {
  const [tab, setTab] = useState<'none' | 'create' | 'grant' | 'status'>('none');
  const [createState, createAction] = useActionState<ActionState, FormData>(createUserAction, {});
  const [grantState, grantAction] = useActionState<ActionState, FormData>(assignRoleAction, {});
  const [statusState, statusAction] = useActionState<ActionState, FormData>(setUserStatusAction, {});
  const [scopeType, setScopeType] = useState<'GLOBAL' | 'DEPARTMENT' | 'PROJECT'>('DEPARTMENT');

  return (
    <section className="card">
      <header className="card-header flex flex-wrap items-center justify-between gap-3">
        {/* Instant Live Search Bar */}
        <div className="relative flex items-center">
          <div className="absolute left-2.5 text-muted pointer-events-none">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
          </div>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange && onSearchChange(e.target.value)}
            className="input !h-8 w-64 pl-8 pr-7 text-body-sm"
            placeholder="Search name, department, role..."
          />
          {searchQuery ? (
            <button
              type="button"
              onClick={() => onSearchChange && onSearchChange('')}
              className="absolute right-2 text-muted hover:text-ink text-xs"
              title="Clear search"
            >
              ✕
            </button>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {columnsButton}
          {canCreate ? (
            <button
              type="button"
              className={clsx(
                'btn btn-sm transition-all',
                tab === 'create' ? 'border-ink bg-ink text-canvas font-semibold shadow-xs' : 'btn-secondary'
              )}
              onClick={() => setTab(tab === 'create' ? 'none' : 'create')}
            >
              Add employee
            </button>
          ) : null}
          {canAssign ? (
            <button
              type="button"
              className={clsx(
                'btn btn-sm transition-all',
                tab === 'grant' ? 'border-ink bg-ink text-canvas font-semibold shadow-xs' : 'btn-secondary'
              )}
              onClick={() => setTab(tab === 'grant' ? 'none' : 'grant')}
            >
              Grant role
            </button>
          ) : null}
          {canCreate ? (
            <button
              type="button"
              className={clsx(
                'btn btn-sm transition-all',
                tab === 'status' ? 'border-ink bg-ink text-canvas font-semibold shadow-xs' : 'btn-secondary'
              )}
              onClick={() => setTab(tab === 'status' ? 'none' : 'status')}
            >
              Change status
            </button>
          ) : null}
        </div>
      </header>

      {tab === 'create' ? (
        <form action={createAction} className="card-body grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="field">
            <label className="label" htmlFor="fullName">Full name *</label>
            <input id="fullName" name="fullName" required className="input" placeholder="e.g. Rahul Sharma" />
          </div>
          <div className="field">
            <label className="label" htmlFor="employeeCode">Employee code *</label>
            <input id="employeeCode" name="employeeCode" required className="input" placeholder="ACS-0016" />
          </div>
          <div className="field">
            <label className="label" htmlFor="email">Work email *</label>
            <input id="email" name="email" type="email" required className="input" placeholder="name@acsengitech.com" />
          </div>
          <div className="field">
            <label className="label" htmlFor="password">Initial password *</label>
            <input id="password" name="password" type="text" required className="input" />
            <p className="hint">10+ chars, upper, lower and a digit.</p>
          </div>
          <div className="field">
            <label className="label" htmlFor="designation">Designation</label>
            <input id="designation" name="designation" className="input" placeholder="e.g. Electrical Design Engineer" />
          </div>
          <div className="field">
            <label className="label" htmlFor="grade">Grade</label>
            <select id="grade" name="grade" className="select" defaultValue="JUNIOR_ENGINEER">
              {GRADES.map((grade) => (
                <option key={grade} value={grade}>{grade.replaceAll('_', ' ').toLowerCase()}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="label" htmlFor="departmentId">Department</label>
            <select id="departmentId" name="departmentId" className="select" defaultValue="">
              <option value="">None</option>
              {departments.map((dept) => (
                <option key={dept.id} value={dept.id}>{dept.name}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="label" htmlFor="managerId">Reports to</label>
            <select id="managerId" name="managerId" className="select" defaultValue="">
              <option value="">None</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>{formatName(user.fullName)}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="label" htmlFor="dailyCapacityHours">Daily capacity (h)</label>
            <input id="dailyCapacityHours" name="dailyCapacityHours" type="number" min="1" max="16" step="0.5" defaultValue={8} className="input" />
          </div>
          <div className="field">
            <label className="label" htmlFor="roleKey">Base role</label>
            <select id="roleKey" name="roleKey" className="select" defaultValue="JUNIOR_ENGINEER">
              {roles.map((role) => (
                <option key={role.key} value={role.key}>{role.name}</option>
              ))}
            </select>
            <p className="hint">Scoped to their department automatically.</p>
          </div>
          <div className="flex items-end">
            <SubmitButton variant="primary" className="w-full font-semibold shadow-sm">
              Create account
            </SubmitButton>
          </div>
          <div className="sm:col-span-2 lg:col-span-4">
            <FormMessage state={createState} />
          </div>
        </form>
      ) : null}

      {tab === 'grant' ? (
        <form action={grantAction} className="card-body grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="field">
            <label className="label" htmlFor="grant-user">Employee</label>
            <select id="grant-user" name="userId" required className="select" defaultValue="">
              <option value="" disabled>Select</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>{formatName(user.fullName)}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="label" htmlFor="grant-role">Role</label>
            <select id="grant-role" name="roleKey" required className="select" defaultValue="">
              <option value="" disabled>Select</option>
              {roles.map((role) => (
                <option key={role.key} value={role.key}>{role.name}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="label" htmlFor="grant-scope">Scope</label>
            <select
              id="grant-scope"
              name="scopeType"
              className="select"
              value={scopeType}
              onChange={(event) => setScopeType(event.target.value as typeof scopeType)}
            >
              <option value="GLOBAL">Company-wide</option>
              <option value="DEPARTMENT">A department (and everything under it)</option>
              <option value="PROJECT">A single project</option>
            </select>
          </div>
          <div className="field">
            <label className="label" htmlFor="grant-scope-id">Applies to</label>
            <select id="grant-scope-id" name="scopeId" className="select" disabled={scopeType === 'GLOBAL'} defaultValue="">
              <option value="">{scopeType === 'GLOBAL' ? 'Whole company' : 'Select'}</option>
              {scopeType === 'DEPARTMENT'
                ? departments.map((dept) => (
                    <option key={dept.id} value={dept.id}>{dept.name}</option>
                  ))
                : null}
              {scopeType === 'PROJECT'
                ? projects.map((project) => (
                    <option key={project.id} value={project.id}>{project.name}</option>
                  ))
                : null}
            </select>
          </div>
          <div className="flex items-end">
            <SubmitButton variant="primary" className="w-full font-semibold shadow-sm">
              Grant
            </SubmitButton>
          </div>
          <div className="sm:col-span-2 lg:col-span-4">
            <FormMessage state={grantState} />
          </div>
        </form>
      ) : null}

      {tab === 'status' ? (
        <form action={statusAction} className="card-body grid gap-3 sm:grid-cols-3">
          <div className="field">
            <label className="label" htmlFor="status-user">Employee</label>
            <select id="status-user" name="userId" required className="select" defaultValue="">
              <option value="" disabled>Select</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>{formatName(user.fullName)}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="label" htmlFor="status-value">Status</label>
            <select id="status-value" name="status" className="select" defaultValue="ACTIVE">
              <option value="ACTIVE">Active</option>
              <option value="SUSPENDED">Suspended</option>
              <option value="EXITED">Exited</option>
            </select>
            <p className="hint">Suspending or exiting revokes every live session immediately.</p>
          </div>
          <div className="flex items-end">
            <SubmitButton variant="primary" className="w-full font-semibold shadow-sm" confirm="Change this account's status?">
              Apply
            </SubmitButton>
          </div>
          <div className="sm:col-span-3">
            <FormMessage state={statusState} />
          </div>
        </form>
      ) : null}
    </section>
  );
}
