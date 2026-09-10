'use server';

import { revalidatePath } from 'next/cache';
import { requirePrincipal } from '@/core/auth/session';
import { assignRole, createUser, revokeRole, setRolePermissions, setUserStatus } from '@/modules/admin/services/admin.service';
import type { ActionState } from './pm';
import type { ScopeType } from '@prisma/client';

const value = (form: FormData, key: string) => {
  const raw = form.get(key);
  if (raw === null) return undefined;
  const text = String(raw).trim();
  return text === '' ? undefined : text;
};

async function run(fn: () => Promise<unknown>, paths: string[]): Promise<ActionState> {
  try {
    await fn();
    for (const path of paths) revalidatePath(path);
    return { success: 'Saved.' };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Something went wrong.' };
  }
}

export async function createUserAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  return run(
    () =>
      createUser(principal, {
        fullName: String(form.get('fullName') ?? '').trim(),
        email: String(form.get('email') ?? '').trim(),
        employeeCode: String(form.get('employeeCode') ?? '').trim(),
        password: String(form.get('password') ?? ''),
        designation: value(form, 'designation'),
        grade: String(form.get('grade') ?? 'JUNIOR_ENGINEER'),
        departmentId: value(form, 'departmentId'),
        managerId: value(form, 'managerId'),
        dailyCapacityHours: Number(value(form, 'dailyCapacityHours') ?? 8),
        skills: String(form.get('skills') ?? '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        roleKey: String(form.get('roleKey') ?? 'JUNIOR_ENGINEER'),
      }),
    ['/admin/users'],
  );
}

export async function assignRoleAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  return run(
    () =>
      assignRole(principal, {
        userId: String(form.get('userId')),
        roleKey: String(form.get('roleKey')),
        scopeType: String(form.get('scopeType')) as ScopeType,
        scopeId: value(form, 'scopeId') ?? null,
      }),
    ['/admin/users'],
  );
}

export async function revokeRoleAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  return run(() => revokeRole(principal, String(form.get('assignmentId'))), ['/admin/users']);
}

export async function setUserStatusAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  return run(
    () => setUserStatus(principal, String(form.get('userId')), String(form.get('status')) as 'ACTIVE' | 'SUSPENDED' | 'EXITED'),
    ['/admin/users'],
  );
}

export async function setRolePermissionsAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  return run(
    () => setRolePermissions(principal, String(form.get('roleKey')), form.getAll('permissions').map(String)),
    ['/admin/roles'],
  );
}
