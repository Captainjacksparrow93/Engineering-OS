'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { drainOutbox } from '@/core/events/bus';
import {
  assignTaskSchema,
  autoAssignTeamSchema,
  changeTaskStatusSchema,
  createTaskSchema,
  handoverDecisionSchema,
  handoverRequestSchema,
  progressSchema,
} from '@/modules/project-management/validation/schemas';
import {
  addProjectMember,
  cancelProject,
  completeAutomationProject,
  deleteProject,
  getProjectTimeline,
  holdProject,
  quickFind,
  reassignAllMemberTasks,
  removeProjectMember,
  restoreProject,
  resumeProject,
} from '@/modules/project-management/services/project.service';
import {
  addComment,
  approveTaskReview,
  assignTask,
  changeTaskStatus,
  createTask,
  deleteTask,
  disapproveTaskReview,
  flagRoadblock,
} from '@/modules/project-management/services/task.service';
import { addDependency, removeDependency } from '@/modules/project-management/services/dependency.service';
import { logProgress } from '@/modules/project-management/services/progress.service';
import {
  cancelHandover,
  cancelProjectHandover,
  decideHandover,
  decideProjectHandover,
  requestHandover,
  requestProjectHandover,
  requestPanelHandover,
  decidePanelHandover,
} from '@/modules/project-management/services/handover.service';
import { createClient, listClients } from '@/modules/project-management/services/client.service';
import { autoAssignAutomationTeam } from '@/modules/project-management/services/automation-project.service';
import { markAllRead, markRead } from '@/core/notifications/notify';
import { toState, value, list, type ActionState } from '@/core/utils/actions';

export type { ActionState };

/**
 * Server actions are the write path for the UI. Each one authenticates, validates,
 * delegates to a service (where authorisation and business rules live) and then
 * drains the event outbox. No business logic lives in this file on purpose - the API
 * routes call the same services.
 */

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


// ------------------------------------------------------------------- projects

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
  const projectId = form.get('projectId') ? String(form.get('projectId')) : undefined;
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
  if (projectId) revalidatePath(`/pm/projects/${projectId}`);
  revalidatePath('/dashboard');
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

export async function addDependencyAction(input: {
  predecessorId: string;
  successorId: string;
  type?: 'FINISH_TO_START' | 'START_TO_START' | 'FINISH_TO_FINISH' | 'START_TO_FINISH';
  lagDays?: number;
}) {
  const principal = await requirePrincipal();
  try {
    const dep = await addDependency(principal, input);
    await drainOutbox();
    revalidatePath(`/pm/tasks/${input.successorId}`);
    revalidatePath('/pm/projects/[id]', 'page');
    revalidatePath('/pm/my-work');
    revalidatePath('/dashboard');
    return { success: true, data: dep };
  } catch (error) {
    return { success: false, error: toState(error).error ?? 'Failed to add dependency.' };
  }
}

export async function removeDependencyAction(dependencyId: string, taskId?: string) {
  const principal = await requirePrincipal();
  try {
    await removeDependency(principal, dependencyId);
    await drainOutbox();
    if (taskId) revalidatePath(`/pm/tasks/${taskId}`);
    revalidatePath('/pm/tasks/[id]', 'page');
    revalidatePath('/pm/projects/[id]', 'page');
    revalidatePath('/pm/my-work');
    revalidatePath('/dashboard');
    return { success: true };
  } catch (error) {
    return { success: false, error: toState(error).error ?? 'Failed to remove dependency.' };
  }
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
  revalidatePath('/pm/approvals');
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

export async function requestPanelHandoverAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  const phaseTaskId = String(form.get('phaseTaskId'));
  const projectId = form.get('projectId') ? String(form.get('projectId')) : undefined;
  const toUserId = String(form.get('toUserId') || '');
  const reason = String(form.get('reason') || '');

  if (!toUserId) return { error: 'Please choose an engineer to take over remaining tasks.' };
  if (!reason.trim() || reason.trim().length < 5) return { error: 'Please provide a reason of at least 5 characters.' };

  const state = await run(async () => {
    return requestPanelHandover(principal, {
      phaseTaskId,
      toUserId,
      reason,
    });
  });

  if (projectId) revalidatePath(`/pm/projects/${projectId}`);
  revalidatePath('/pm/handovers');
  return state.error ? state : { success: 'Panel handover requested.' };
}

export async function decidePanelHandoverAction(
  phaseTaskId: string,
  decision: 'ACCEPTED' | 'DECLINED' | 'REJECTED',
  note?: string,
) {
  const principal = await requirePrincipal();
  try {
    const result = await decidePanelHandover(principal, { phaseTaskId, decision, note });
    revalidatePath('/pm/handovers');
    revalidatePath('/pm/my-work');
    revalidatePath('/dashboard');
    return { success: true, count: result.count };
  } catch (error) {
    return { success: false, error: toState(error).error ?? 'Failed to decide panel handover.' };
  }
}

export async function createClientAction(name: string, refNumber: string) {
  const principal = await requirePrincipal();
  try {
    const client = await createClient(principal, { name, refNumber });
    return { success: true, client };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to create client.' };
  }
}

export async function getClientsAction() {
  const principal = await requirePrincipal();
  try {
    const clients = await listClients(principal.companyId);
    return { success: true, clients };
  } catch (err: unknown) {
    return { success: false, error: 'Failed to list clients.' };
  }
}

// -------------------------------------------------------------- notifications

export async function markNotificationReadAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  const state = await run(() => markRead(principal.userId, String(form.get('notificationId'))));
  revalidatePath('/notifications');
  return state;
}

export async function markAllNotificationsReadAction(_prev: ActionState, _form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  const state = await run(() => markAllRead(principal.userId));
  revalidatePath('/notifications');
  return state;
}

// -------------------------------------------------------------- PM quality gate & review


export async function flagRoadblockAction(taskId: string, comment: string) {
  const principal = await requirePrincipal();
  try {
    await flagRoadblock(principal, taskId, comment);
    revalidatePath(`/pm/tasks/${taskId}`);
    revalidatePath('/pm/my-work');
    revalidatePath('/dashboard');
    return { success: true };
  } catch (error) {
    return { success: false, error: toState(error).error ?? 'Failed to flag roadblock.' };
  }
}

export async function completeAutomationProjectAction(projectId: string) {
  const principal = await requirePrincipal();
  try {
    await completeAutomationProject(principal, projectId);
    revalidatePath(`/pm/projects/${projectId}`);
    revalidatePath('/pm/projects');
    revalidatePath('/dashboard');
    return { success: true };
  } catch (error) {
    return { success: false, error: toState(error).error ?? 'Failed to complete project.' };
  }
}

export async function holdProjectAction(projectId: string, reason: string) {
  const principal = await requirePrincipal();
  try {
    await holdProject(principal, projectId, reason);
    await drainOutbox().catch(() => undefined);
    revalidatePath(`/pm/projects/${projectId}`);
    revalidatePath('/pm/projects');
    revalidatePath('/pm/my-work');
    revalidatePath('/pm/resources');
    revalidatePath('/dashboard');
    return { success: true };
  } catch (error) {
    return { success: false, error: toState(error).error ?? 'Failed to place project on hold.' };
  }
}

export async function resumeProjectAction(projectId: string) {
  const principal = await requirePrincipal();
  try {
    await resumeProject(principal, projectId);
    await drainOutbox().catch(() => undefined);
    revalidatePath(`/pm/projects/${projectId}`);
    revalidatePath('/pm/projects');
    revalidatePath('/pm/my-work');
    revalidatePath('/pm/resources');
    revalidatePath('/dashboard');
    return { success: true };
  } catch (error) {
    return { success: false, error: toState(error).error ?? 'Failed to resume project.' };
  }
}

export async function cancelProjectAction(projectId: string) {
  const principal = await requirePrincipal();
  try {
    await cancelProject(principal, projectId);
    await drainOutbox().catch(() => undefined);
    revalidatePath(`/pm/projects/${projectId}`);
    revalidatePath('/pm/projects');
    revalidatePath('/pm/my-work');
    revalidatePath('/pm/resources');
    revalidatePath('/dashboard');
    return { success: true };
  } catch (error) {
    return { success: false, error: toState(error).error ?? 'Failed to cancel project.' };
  }
}

export async function restoreProjectAction(projectId: string) {
  const principal = await requirePrincipal();
  try {
    await restoreProject(principal, projectId);
    await drainOutbox().catch(() => undefined);
    revalidatePath(`/pm/projects/${projectId}`);
    revalidatePath('/pm/projects');
    revalidatePath('/pm/my-work');
    revalidatePath('/pm/resources');
    revalidatePath('/dashboard');
    return { success: true };
  } catch (error) {
    return { success: false, error: toState(error).error ?? 'Failed to restore project.' };
  }
}

export async function deleteProjectAction(projectId: string, confirmationCode: string) {
  const principal = await requirePrincipal();
  try {
    await deleteProject(principal, projectId, confirmationCode);
    await drainOutbox().catch(() => undefined);
    revalidatePath('/pm/projects');
    revalidatePath('/dashboard');
    return { success: true };
  } catch (error) {
    return { success: false, error: toState(error).error ?? 'Failed to delete project.' };
  }
}

export async function handoverProjectAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  const projectId = String(form.get('projectId'));
  const newManagerId = String(form.get('newManagerId'));
  const reason = form.get('reason') ? String(form.get('reason')) : undefined;

  if (!projectId || !newManagerId) {
    return { error: 'Missing required fields' };
  }

  const state = await run(async () => {
    await requestProjectHandover(principal, { projectId, toUserId: newManagerId, reason });
    return 'Project handover request sent for acceptance.';
  });

  if (!state.error) {
    revalidatePath('/pm/projects/' + projectId);
    revalidatePath('/pm/handovers');
    revalidatePath('/dashboard');
  }
  return state;
}

export async function decideProjectHandoverAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  const handoverId = String(form.get('handoverId'));
  const decision = String(form.get('decision')) as 'ACCEPTED' | 'DECLINED' | 'REJECTED';
  const note = form.get('note') ? String(form.get('note')) : undefined;

  if (!handoverId || !['ACCEPTED', 'DECLINED', 'REJECTED'].includes(decision)) {
    return { error: 'Invalid handover decision.' };
  }

  const state = await run(async () => {
    await decideProjectHandover(principal, handoverId, decision, note);
    return decision === 'ACCEPTED' ? 'Project handover accepted.' : 'Project handover declined.';
  });

  revalidatePath('/pm/handovers');
  revalidatePath('/pm/approvals');
  revalidatePath('/pm/projects');
  revalidatePath('/dashboard');
  return state;
}

export async function cancelProjectHandoverAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  const handoverId = String(form.get('handoverId'));
  if (!handoverId) return { error: 'Missing handover ID' };

  const state = await run(async () => {
    await cancelProjectHandover(principal, handoverId);
    return 'Project handover request cancelled.';
  });

  revalidatePath('/pm/handovers');
  revalidatePath('/dashboard');
  return state;
}

export async function reassignMemberTasksAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  const projectId = String(form.get('projectId'));
  const fromUserId = String(form.get('fromUserId'));
  const toUserId = String(form.get('toUserId'));

  const state = await run(async () => {
    return reassignAllMemberTasks(principal, projectId, fromUserId, toUserId);
  });

  revalidatePath(`/pm/projects/${projectId}`);
  revalidatePath(`/pm/resources`);
  revalidatePath(`/dashboard`);
  return state;
}

export async function autoAssignAutomationTeamAction(rawInput: unknown) {
  const principal = await requirePrincipal();
  try {
    const input = autoAssignTeamSchema.parse(rawInput);
    const result = await autoAssignAutomationTeam(principal, input);
    return { success: true, assignments: result.assignments };
  } catch (error) {
    return { success: false, error: toState(error).error ?? 'Auto-assignment failed.' };
  }
}

export async function approveTaskReviewAction(taskId: string, feedback?: string) {
  const principal = await requirePrincipal();
  try {
    const result = await approveTaskReview(principal, taskId, feedback);
    revalidatePath(`/pm/tasks/${taskId}`);
    revalidatePath('/pm/approvals');
    revalidatePath('/pm/my-work');
    revalidatePath('/dashboard');
    if (result.projectId) revalidatePath(`/pm/projects/${result.projectId}`);
    return { success: true, allTasksCompleted: result.allTasksCompleted };
  } catch (error) {
    return { success: false, error: toState(error).error ?? 'Failed to approve task.' };
  }
}

export async function disapproveTaskReviewAction(taskId: string, feedback: string) {
  const principal = await requirePrincipal();
  try {
    await disapproveTaskReview(principal, taskId, feedback);
    revalidatePath(`/pm/tasks/${taskId}`);
    revalidatePath('/pm/approvals');
    revalidatePath('/pm/my-work');
    revalidatePath('/dashboard');
    return { success: true };
  } catch (error) {
    return { success: false, error: toState(error).error ?? 'Failed to send back task.' };
  }
}

export async function quickFindAction(query: string) {
  const principal = await requirePrincipal();
  try {
    const results = await quickFind(principal, query);
    return { success: true, data: results };
  } catch (error) {
    return { success: false, error: toState(error).error ?? 'Search failed.' };
  }
}

export async function getProjectTimelineAction(projectId: string) {
  const principal = await requirePrincipal();
  try {
    const timeline = await getProjectTimeline(principal, projectId);
    return timeline;
  } catch (error) {
    console.error('getProjectTimelineAction error:', error);
    return null;
  }
}

// -----------------------------------------------------------------------------
// Site Commissioning Actions
// -----------------------------------------------------------------------------

export async function assignEngineerToCommissioningAction(projectId: string, userId: string) {
  const principal = await requirePrincipal();
  try {
    const { assignEngineerToCommissioning } = await import('@/modules/project-management/services/commissioning.service');
    const result = await assignEngineerToCommissioning(principal, projectId, userId);
    revalidatePath('/pm/commissioning');
    revalidatePath(`/pm/projects/${projectId}`);
    revalidatePath('/dashboard');
    return { success: true, data: result };
  } catch (error) {
    return { success: false, error: toState(error).error ?? 'Failed to assign commissioning engineer.' };
  }
}

export async function releaseEngineerFromCommissioningAction(projectId: string, userId: string) {
  const principal = await requirePrincipal();
  try {
    const { releaseEngineerFromCommissioning } = await import('@/modules/project-management/services/commissioning.service');
    await releaseEngineerFromCommissioning(principal, projectId, userId);
    revalidatePath('/pm/commissioning');
    revalidatePath(`/pm/projects/${projectId}`);
    revalidatePath('/dashboard');
    return { success: true };
  } catch (error) {
    return { success: false, error: toState(error).error ?? 'Failed to release engineer.' };
  }
}

export async function closeCommissioningAction(projectId: string) {
  const principal = await requirePrincipal();
  try {
    const { closeCommissioning } = await import('@/modules/project-management/services/commissioning.service');
    await closeCommissioning(principal, projectId);
    revalidatePath('/pm/commissioning');
    revalidatePath(`/pm/projects/${projectId}`);
    revalidatePath('/pm/projects');
    revalidatePath('/dashboard');
    return { success: true };
  } catch (error) {
    return { success: false, error: toState(error).error ?? 'Failed to close commissioning.' };
  }
}

export async function createCommissioningLogAction(input: {
  projectId: string;
  loggedFor: string;
  workDone: string;
  blocker?: string | null;
}) {
  const principal = await requirePrincipal();
  try {
    const { createCommissioningLog } = await import('@/modules/project-management/services/commissioning.service');
    const log = await createCommissioningLog(principal, input);
    revalidatePath('/pm/commissioning/my');
    revalidatePath('/pm/approvals');
    revalidatePath('/dashboard');
    return { success: true, data: log };
  } catch (error) {
    return { success: false, error: toState(error).error ?? 'Failed to create site log.' };
  }
}

export async function approveCommissioningLogAction(logId: string) {
  const principal = await requirePrincipal();
  try {
    const { approveCommissioningLog } = await import('@/modules/project-management/services/commissioning.service');
    await approveCommissioningLog(principal, logId);
    revalidatePath('/pm/approvals');
    revalidatePath('/pm/commissioning/my');
    revalidatePath('/dashboard');
    return { success: true };
  } catch (error) {
    return { success: false, error: toState(error).error ?? 'Failed to approve commissioning log.' };
  }
}

export async function rejectCommissioningLogAction(logId: string, decisionNote?: string) {
  const principal = await requirePrincipal();
  try {
    const { rejectCommissioningLog } = await import('@/modules/project-management/services/commissioning.service');
    await rejectCommissioningLog(principal, logId, decisionNote);
    revalidatePath('/pm/approvals');
    revalidatePath('/pm/commissioning/my');
    revalidatePath('/dashboard');
    return { success: true };
  } catch (error) {
    return { success: false, error: toState(error).error ?? 'Failed to reject commissioning log.' };
  }
}






