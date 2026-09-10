'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { drainOutbox } from '@/core/events/bus';
import {
  assignTaskSchema,
  changeTaskStatusSchema,
  createProjectSchema,
  createTaskSchema,
  dependencySchema,
  handoverDecisionSchema,
  handoverRequestSchema,
  progressSchema,
  updateProjectSchema,
} from '@/modules/project-management/validation/schemas';
import { addProjectMember, createProject, removeProjectMember, updateProject } from '@/modules/project-management/services/project.service';
import { addComment, assignTask, changeTaskStatus, createTask, deleteTask } from '@/modules/project-management/services/task.service';
import { addDependency, removeDependency } from '@/modules/project-management/services/dependency.service';
import { logProgress } from '@/modules/project-management/services/progress.service';
import { cancelHandover, decideHandover, requestHandover } from '@/modules/project-management/services/handover.service';
import { markRead } from '@/core/notifications/notify';

/**
 * Server actions are the write path for the UI. Each one authenticates, validates,
 * delegates to a service (where authorisation and business rules live) and then
 * drains the event outbox. No business logic lives in this file on purpose - the API
 * routes call the same services.
 */

export interface ActionState {
  error?: string;
  success?: string;
  fieldErrors?: Record<string, string[]>;
}

async function run<T>(fn: () => Promise<T>, onSuccess?: (result: T) => void): Promise<ActionState> {
  try {
    const result = await fn();
    await drainOutbox().catch(() => undefined);
    onSuccess?.(result);
    return { success: 'Saved.' };
  } catch (error) {
    if (isRedirectError(error)) throw error;
    return toState(error);
  }
}

function isRedirectError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'digest' in error &&
    typeof (error as { digest?: unknown }).digest === 'string' &&
    (error as { digest: string }).digest.startsWith('NEXT_REDIRECT');
}

function toState(error: unknown): ActionState {
  if (error && typeof error === 'object' && 'issues' in error && Array.isArray((error as { issues: unknown[] }).issues)) {
    const zodError = error as { issues: Array<{ path: (string | number)[]; message: string }> };
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of zodError.issues) {
      const key = issue.path.join('.') || 'form';
      fieldErrors[key] = [...(fieldErrors[key] ?? []), issue.message];
    }
    return { error: zodError.issues[0]?.message ?? 'Please check the form.', fieldErrors };
  }
  return { error: error instanceof Error ? error.message : 'Something went wrong.' };
}

const value = (form: FormData, key: string) => {
  const raw = form.get(key);
  if (raw === null) return undefined;
  const text = String(raw).trim();
  return text === '' ? undefined : text;
};

const list = (form: FormData, key: string) =>
  String(form.get(key) ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

// ------------------------------------------------------------------- projects

export async function createProjectAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  let projectId: string | null = null;

  const state = await run(async () => {
    const input = createProjectSchema.parse({
      name: value(form, 'name'),
      code: value(form, 'code'),
      description: value(form, 'description'),
      clientName: value(form, 'clientName'),
      poNumber: value(form, 'poNumber'),
      orderValue: value(form, 'orderValue'),
      panelType: value(form, 'panelType'),
      panelCount: value(form, 'panelCount') ?? 0,
      priority: value(form, 'priority') ?? 'MEDIUM',
      status: value(form, 'status') ?? 'PLANNING',
      startDate: value(form, 'startDate') ?? '',
      targetEndDate: value(form, 'targetEndDate') ?? '',
      managerId: value(form, 'managerId'),
      sponsorId: value(form, 'sponsorId'),
      departmentId: value(form, 'departmentId'),
    });
    const project = await createProject(principal, input);
    projectId = project.id;
    return project;
  });

  if (state.error) return state;
  revalidatePath('/pm/projects');
  if (projectId) redirect(`/pm/projects/${projectId}`);
  return state;
}

export async function updateProjectAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  const projectId = String(form.get('projectId'));

  const state = await run(async () => {
    const input = updateProjectSchema.parse({
      name: value(form, 'name'),
      description: value(form, 'description'),
      clientName: value(form, 'clientName'),
      poNumber: value(form, 'poNumber'),
      orderValue: value(form, 'orderValue'),
      panelType: value(form, 'panelType'),
      panelCount: value(form, 'panelCount'),
      priority: value(form, 'priority'),
      status: value(form, 'status'),
      startDate: value(form, 'startDate') ?? '',
      targetEndDate: value(form, 'targetEndDate') ?? '',
      managerId: value(form, 'managerId'),
    });
    return updateProject(principal, projectId, input);
  });

  revalidatePath(`/pm/projects/${projectId}`);
  return state;
}

export async function addMemberAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  const projectId = String(form.get('projectId'));
  const state = await run(() =>
    addProjectMember(
      principal,
      projectId,
      String(form.get('userId')),
      (value(form, 'role') ?? 'ENGINEER') as 'MANAGER' | 'LEAD' | 'ENGINEER' | 'REVIEWER' | 'OBSERVER',
      Number(value(form, 'allocationPercent') ?? 100),
    ),
  );
  revalidatePath(`/pm/projects/${projectId}`);
  return state;
}

export async function removeMemberAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  const projectId = String(form.get('projectId'));
  const state = await run(() => removeProjectMember(principal, projectId, String(form.get('userId'))));
  revalidatePath(`/pm/projects/${projectId}`);
  return state;
}

// ---------------------------------------------------------------------- tasks

export async function createTaskAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  const projectId = String(form.get('projectId'));
  let createdId: string | null = null;
  const redirectTo = value(form, 'redirectTo');

  const state = await run(async () => {
    const input = createTaskSchema.parse({
      projectId,
      parentId: value(form, 'parentId'),
      title: value(form, 'title'),
      description: value(form, 'description'),
      type: value(form, 'type') ?? 'PROJECT',
      priority: value(form, 'priority') ?? 'MEDIUM',
      estimatedHours: value(form, 'estimatedHours') ?? 8,
      plannedStart: value(form, 'plannedStart') ?? '',
      plannedEnd: value(form, 'plannedEnd') ?? '',
      requiredSkills: list(form, 'requiredSkills'),
      assigneeId: value(form, 'assigneeId'),
      dependsOn: form.getAll('dependsOn').map(String).filter(Boolean),
    });
    const task = await createTask(principal, input);
    createdId = task.id;
    return task;
  });

  if (state.error) return state;
  revalidatePath(`/pm/projects/${projectId}`);
  if (redirectTo === 'task' && createdId) redirect(`/pm/tasks/${createdId}`);
  return { success: 'Task created.' };
}

export async function changeTaskStatusAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  const taskId = String(form.get('taskId'));
  const state = await run(async () => {
    const input = changeTaskStatusSchema.parse({ status: value(form, 'status'), note: value(form, 'note') });
    return changeTaskStatus(principal, taskId, input.status, input.note);
  });
  revalidatePath(`/pm/tasks/${taskId}`);
  revalidatePath('/pm/my-work');
  return state;
}

export async function assignTaskAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  const taskId = String(form.get('taskId'));
  const state = await run(async () => {
    const input = assignTaskSchema.parse({
      userId: value(form, 'userId'),
      role: value(form, 'role') ?? 'OWNER',
      allocatedHours: value(form, 'allocatedHours'),
      note: value(form, 'note'),
    });
    return assignTask(principal, taskId, input);
  });
  revalidatePath(`/pm/tasks/${taskId}`);
  return state;
}

export async function deleteTaskAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  const taskId = String(form.get('taskId'));
  const projectId = String(form.get('projectId'));
  const state = await run(() => deleteTask(principal, taskId));
  if (state.error) return state;
  revalidatePath(`/pm/projects/${projectId}`);
  redirect(`/pm/projects/${projectId}`);
}

export async function addCommentAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  const taskId = String(form.get('taskId'));
  const state = await run(() => addComment(principal, taskId, String(form.get('body') ?? '')));
  revalidatePath(`/pm/tasks/${taskId}`);
  return state;
}

// --------------------------------------------------------------- dependencies

export async function addDependencyAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  const successorId = String(form.get('successorId'));
  const state = await run(async () => {
    const input = dependencySchema.parse({
      predecessorId: value(form, 'predecessorId'),
      successorId,
      type: value(form, 'type') ?? 'FINISH_TO_START',
      lagDays: value(form, 'lagDays') ?? 0,
    });
    return addDependency(principal, input);
  });
  revalidatePath(`/pm/tasks/${successorId}`);
  return state;
}

export async function removeDependencyAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  const state = await run(() => removeDependency(principal, String(form.get('dependencyId'))));
  revalidatePath(`/pm/tasks/${String(form.get('taskId'))}`);
  return state;
}

// ------------------------------------------------------------------- progress

export async function logProgressAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  const taskId = String(form.get('taskId'));
  const state = await run(async () => {
    const input = progressSchema.parse({
      taskId,
      percentComplete: value(form, 'percentComplete') ?? 0,
      hoursSpent: value(form, 'hoursSpent') ?? 0,
      note: value(form, 'note'),
      blocker: value(form, 'blocker'),
      loggedFor: value(form, 'loggedFor') ?? '',
    });
    return logProgress(principal, input);
  });
  revalidatePath(`/pm/tasks/${taskId}`);
  revalidatePath('/pm/my-work');
  revalidatePath('/dashboard');
  return state.error ? state : { success: 'Progress recorded.' };
}

// ------------------------------------------------------------------ handovers

export async function requestHandoverAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  const taskId = String(form.get('taskId'));
  const state = await run(async () => {
    const input = handoverRequestSchema.parse({
      taskId,
      toUserId: value(form, 'toUserId'),
      reason: value(form, 'reason'),
    });
    return requestHandover(principal, input);
  });
  revalidatePath(`/pm/tasks/${taskId}`);
  revalidatePath('/pm/handovers');
  return state.error ? state : { success: 'Handover sent for acceptance.' };
}

export async function decideHandoverAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  const handoverId = String(form.get('handoverId'));
  const state = await run(async () => {
    const input = handoverDecisionSchema.parse({ decision: value(form, 'decision'), note: value(form, 'note') });
    return decideHandover(principal, handoverId, input.decision, input.note);
  });
  revalidatePath('/pm/handovers');
  revalidatePath('/pm/my-work');
  revalidatePath('/dashboard');
  return state;
}

export async function cancelHandoverAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  const state = await run(() => cancelHandover(principal, String(form.get('handoverId'))));
  revalidatePath('/pm/handovers');
  return state;
}

// -------------------------------------------------------------- notifications

export async function markNotificationReadAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  const state = await run(() => markRead(principal.userId, String(form.get('notificationId'))));
  revalidatePath('/notifications');
  return state;
}
