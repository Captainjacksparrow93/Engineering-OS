import type { TaskStatus as PrismaTaskStatus } from '@prisma/client';
import { prisma, type Tx } from '@/core/db/prisma';
import { DomainError, NotFoundError } from '@/core/rbac/errors';
import { can } from '@/core/rbac/engine';
import type { Principal } from '@/core/rbac/types';
import { audit, diffOf } from '@/core/audit/audit';
import { publish } from '@/core/events/bus';
import { EVENTS } from '@/core/events/catalog';
import { notify } from '@/core/notifications/notify';
import { assertProjectPermission, assertTaskPermission, assertTaskVisible, loadTaskContext } from './access';
import { addDependency } from './dependency.service';
import type { CreateTaskInput } from '../validation/schemas';
import { blockingReasons, completionBlockers, downstreamTaskIds, rollUpProgress, type Graph } from '../domain/scheduling';

/**
 * Task lifecycle: creation inside the WBS, assignment, status transitions and the
 * bookkeeping that keeps derived fields (blocked state, rolled-up progress) true.
 */

const ALLOWED_TRANSITIONS: Record<PrismaTaskStatus, PrismaTaskStatus[]> = {
  DRAFT: ['TODO', 'CANCELLED'],
  BLOCKED: ['TODO', 'IN_PROGRESS', 'CANCELLED'],
  TODO: ['IN_PROGRESS', 'BLOCKED', 'CANCELLED'],
  IN_PROGRESS: ['IN_REVIEW', 'COMPLETED', 'BLOCKED', 'TODO', 'CANCELLED'],
  IN_REVIEW: ['COMPLETED', 'IN_PROGRESS', 'CANCELLED'],
  COMPLETED: ['IN_PROGRESS'],
  CANCELLED: ['TODO'],
};

export async function createTask(principal: Principal, input: CreateTaskInput) {
  const permission = input.type === 'ADHOC' ? 'pm.task.adhoc.create' : 'pm.task.create';
  const project = await assertProjectPermission(principal, input.projectId, permission);

  if (input.parentId) {
    const parent = await prisma.task.findFirst({
      where: { id: input.parentId, projectId: input.projectId },
      select: { id: true, type: true },
    });
    if (!parent) throw new DomainError('The parent task does not belong to this project.');
  }

  const code = await nextTaskCode(input.projectId, project.code);

  const task = await prisma.$transaction(async (tx) => {
    const created = await tx.task.create({
      data: {
        projectId: input.projectId,
        parentId: input.parentId || null,
        milestoneId: input.milestoneId || null,
        code,
        title: input.title,
        description: input.description,
        type: input.type,
        priority: input.priority,
        estimatedHours: input.estimatedHours,
        plannedStart: input.plannedStart ?? null,
        plannedEnd: input.plannedEnd ?? null,
        requiredSkills: input.requiredSkills,
        createdById: principal.userId,
        status: 'TODO',
      },
    });

    await audit(
      {
        actorId: principal.userId,
        module: 'pm',
        action: 'task.created',
        entityType: 'Task',
        entityId: created.id,
        diff: { code: created.code, title: created.title, type: created.type, projectId: created.projectId },
      },
      tx,
    );

    await publish(
      {
        name: EVENTS.TASK_CREATED,
        module: 'pm',
        entityType: 'Task',
        entityId: created.id,
        actorId: principal.userId,
        payload: { code: created.code, title: created.title, type: created.type, projectId: created.projectId },
      },
      tx,
    );

    return created;
  });

  // Dependencies and assignment go through their own services so cycle detection and
  // capacity checks apply exactly as they would on a later edit.
  for (const predecessorId of input.dependsOn) {
    await addDependency(principal, { predecessorId, successorId: task.id, type: 'FINISH_TO_START', lagDays: 0 });
  }

  if (input.assigneeId) {
    await assignTask(principal, task.id, { userId: input.assigneeId, role: 'OWNER', allocatedHours: input.estimatedHours });
  }

  await recomputeTaskDerivedState(task.projectId);
  return prisma.task.findUniqueOrThrow({ where: { id: task.id } });
}

/** Sequential per-project WBS code, e.g. PRJ-2026-004-T012. */
async function nextTaskCode(projectId: string, projectCode: string): Promise<string> {
  const count = await prisma.task.count({ where: { projectId } });
  return `${projectCode}-T${String(count + 1).padStart(3, '0')}`;
}

export async function updateTask(principal: Principal, taskId: string, input: Record<string, unknown>) {
  const task = await assertTaskPermission(principal, taskId, 'pm.task.update');
  const before = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.task.update({ where: { id: taskId }, data: input as never });
    await audit(
      {
        actorId: principal.userId,
        module: 'pm',
        action: 'task.updated',
        entityType: 'Task',
        entityId: taskId,
        diff: diffOf(before as unknown as Record<string, unknown>, input),
      },
      tx,
    );
    return result;
  });

  await recomputeTaskDerivedState(task.projectId);
  return updated;
}

/**
 * Status transitions.
 *
 * Two rules are enforced here rather than in the UI, because the UI is not the only
 * caller: the transition must be legal, and a task cannot be completed while a
 * finish-to-* dependency is still open. Otherwise "done" would mean nothing.
 */
export async function changeTaskStatus(
  principal: Principal,
  taskId: string,
  status: PrismaTaskStatus,
  note?: string,
) {
  const context = await assertTaskPermission(principal, taskId, 'pm.task.update');
  const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });

  if (task.status === status) return task;
  if (!ALLOWED_TRANSITIONS[task.status].includes(status)) {
    throw new DomainError(`A task cannot move from ${task.status} to ${status}.`);
  }

  const graph = await loadProjectGraph(task.projectId);

  if (status === 'IN_PROGRESS') {
    const blockers = blockingReasons(taskId, graph);
    if (blockers.length > 0) {
      throw new DomainError(
        `Blocked by ${blockers.map((b) => `${b.predecessorCode} (${b.reason})`).join('; ')}.`,
      );
    }
  }

  if (status === 'COMPLETED') {
    const blockers = completionBlockers(taskId, graph);
    if (blockers.length > 0) {
      throw new DomainError(
        `Cannot complete: ${blockers.map((b) => `${b.predecessorCode} ${b.reason}`).join('; ')}.`,
      );
    }
    const openChildren = await prisma.task.count({
      where: { parentId: taskId, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
    });
    if (openChildren > 0) throw new DomainError(`${openChildren} subtask(s) are still open.`);
  }

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.task.update({
      where: { id: taskId },
      data: {
        status,
        percentComplete: status === 'COMPLETED' ? 100 : task.percentComplete,
        actualStart: status === 'IN_PROGRESS' && !task.actualStart ? new Date() : task.actualStart,
        actualEnd: status === 'COMPLETED' ? new Date() : status === 'IN_PROGRESS' ? null : task.actualEnd,
      },
    });

    if (status === 'COMPLETED') {
      await tx.taskAssignment.updateMany({
        where: { taskId, status: 'ACTIVE' },
        data: { status: 'COMPLETED', releasedAt: new Date() },
      });
    }

    await audit(
      {
        actorId: principal.userId,
        module: 'pm',
        action: 'task.status_changed',
        entityType: 'Task',
        entityId: taskId,
        diff: { status: { from: task.status, to: status }, note: note ?? null },
      },
      tx,
    );

    await publish(
      {
        name: status === 'COMPLETED' ? EVENTS.TASK_COMPLETED : EVENTS.TASK_STATUS_CHANGED,
        module: 'pm',
        entityType: 'Task',
        entityId: taskId,
        actorId: principal.userId,
        payload: { from: task.status, to: status, projectId: task.projectId, code: task.code },
      },
      tx,
    );

    if (status === 'COMPLETED') {
      // Whoever was waiting on this can now move; tell them without being asked.
      const unblocked = downstreamTaskIds(taskId, graph.edges);
      if (unblocked.length) {
        const holders = await tx.taskAssignment.findMany({
          where: { taskId: { in: unblocked }, status: 'ACTIVE' },
          select: { userId: true, taskId: true },
        });
        await notify(
          {
            userIds: holders.map((h) => h.userId),
            title: `${context.code} is done`,
            body: `A task you are waiting on ("${task.title}") has been completed.`,
            link: `/pm/projects/${task.projectId}`,
          },
          tx,
        );
      }
    }

    return result;
  });

  await recomputeTaskDerivedState(task.projectId);
  return updated;
}

/**
 * Assigns (or reassigns) ownership.
 *
 * Reassignment by management is distinct from a peer handover: this is top-down, takes
 * effect immediately, and releases the previous owner rather than asking them.
 */
export async function assignTask(
  principal: Principal,
  taskId: string,
  input: { userId: string; role?: 'OWNER' | 'COLLABORATOR' | 'REVIEWER'; allocatedHours?: number; note?: string },
) {
  const context = await assertTaskPermission(principal, taskId, 'pm.task.assign');
  const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
  const role = input.role ?? 'OWNER';

  const assignee = await prisma.user.findFirst({
    where: { id: input.userId, companyId: principal.companyId, status: 'ACTIVE' },
    select: { id: true, fullName: true, grade: true },
  });
  if (!assignee) throw new DomainError('That employee is not active.');

  const remainingHours =
    input.allocatedHours ?? Math.max(1, task.estimatedHours * (1 - task.percentComplete / 100));

  return prisma.$transaction(async (tx) => {
    if (role === 'OWNER') {
      await tx.taskAssignment.updateMany({
        where: { taskId, role: 'OWNER', status: 'ACTIVE', userId: { not: input.userId } },
        data: { status: 'RELEASED', releasedAt: new Date() },
      });
    }

    const assignment = await tx.taskAssignment.create({
      data: {
        taskId,
        userId: input.userId,
        role,
        allocatedHours: remainingHours,
        assignedById: principal.userId,
      },
    });

    // Being handed work on a project you are not on should not hide the project from
    // you - membership is created as an observer-level attachment.
    await tx.projectMember.upsert({
      where: { projectId_userId: { projectId: task.projectId, userId: input.userId } },
      create: { projectId: task.projectId, userId: input.userId, role: 'ENGINEER' },
      update: {},
    });

    await audit(
      {
        actorId: principal.userId,
        module: 'pm',
        action: 'task.assigned',
        entityType: 'Task',
        entityId: taskId,
        diff: { userId: input.userId, role, allocatedHours: remainingHours, note: input.note ?? null },
      },
      tx,
    );

    await publish(
      {
        name: EVENTS.TASK_ASSIGNED,
        module: 'pm',
        entityType: 'Task',
        entityId: taskId,
        actorId: principal.userId,
        payload: { userId: input.userId, role, projectId: task.projectId, code: task.code },
      },
      tx,
    );

    if (input.userId !== principal.userId) {
      await notify(
        {
          userIds: [input.userId],
          title: `New ${task.type === 'ADHOC' ? 'ad-hoc ' : ''}task: ${context.code}`,
          body: `${principal.fullName} assigned you "${task.title}" (${Math.round(remainingHours)}h${
            task.plannedEnd ? `, due ${task.plannedEnd.toISOString().slice(0, 10)}` : ''
          }).`,
          link: `/pm/tasks/${taskId}`,
        },
        tx,
      );
    }

    return assignment;
  });
}

export async function deleteTask(principal: Principal, taskId: string) {
  const task = await assertTaskPermission(principal, taskId, 'pm.task.delete');
  const childCount = await prisma.task.count({ where: { parentId: taskId } });
  if (childCount > 0) throw new DomainError('Delete or move the subtasks first.');
  const loggedHours = await prisma.taskProgressLog.count({ where: { taskId } });
  if (loggedHours > 0) {
    throw new DomainError('This task already has progress logged. Cancel it instead of deleting it.');
  }

  await prisma.$transaction(async (tx) => {
    await tx.task.delete({ where: { id: taskId } });
    await audit(
      {
        actorId: principal.userId,
        module: 'pm',
        action: 'task.deleted',
        entityType: 'Task',
        entityId: taskId,
        diff: { code: task.code, title: task.title },
      },
      tx,
    );
  });
  await recomputeTaskDerivedState(task.projectId);
}

/**
 * Recomputes everything derived: which tasks are blocked, and phase-level progress.
 *
 * Called after any structural change. Doing it centrally means blocked state can never
 * drift out of sync with the dependency graph, which is the failure mode that makes
 * dependency features useless in practice.
 */
export async function recomputeTaskDerivedState(projectId: string, tx: Tx = prisma): Promise<void> {
  const graph = await loadProjectGraph(projectId, tx);
  const rollup = rollUpProgress(graph.tasks);

  for (const task of graph.tasks) {
    const updates: Record<string, unknown> = {};

    if (task.status === 'TODO' || task.status === 'BLOCKED') {
      const blockers = blockingReasons(task.id, graph);
      const shouldBe = blockers.length > 0 ? 'BLOCKED' : 'TODO';
      if (shouldBe !== task.status) updates.status = shouldBe;
    }

    const rolled = rollup.get(task.id);
    const isParent = graph.tasks.some((t) => t.parentId === task.id);
    if (isParent && rolled !== undefined && rolled !== task.percentComplete) {
      updates.percentComplete = rolled;
    }

    if (Object.keys(updates).length > 0) {
      await tx.task.update({ where: { id: task.id }, data: updates as never });
    }
  }
}

export async function loadProjectGraph(projectId: string, tx: Tx = prisma): Promise<Graph> {
  const tasks = await tx.task.findMany({
    where: { projectId },
    select: {
      id: true,
      code: true,
      title: true,
      status: true,
      estimatedHours: true,
      percentComplete: true,
      plannedStart: true,
      plannedEnd: true,
      parentId: true,
    },
  });
  const edges = await tx.taskDependency.findMany({
    where: { successor: { projectId } },
    select: { predecessorId: true, successorId: true, type: true, lagDays: true },
  });
  return { tasks, edges };
}

/** Everything one engineer is holding right now, ready for "My work". */
export async function listMyTasks(principal: Principal, filters: { status?: string; includeCompleted?: boolean } = {}) {
  const assignments = await prisma.taskAssignment.findMany({
    where: {
      userId: principal.userId,
      status: filters.includeCompleted ? undefined : 'ACTIVE',
    },
    include: {
      task: {
        include: {
          project: { select: { id: true, code: true, name: true, clientName: true, priority: true } },
          dependencies: {
            include: { predecessor: { select: { id: true, code: true, title: true, status: true } } },
          },
          assignments: {
            where: { status: 'ACTIVE' },
            include: { user: { select: { id: true, fullName: true, avatarColor: true } } },
          },
        },
      },
    },
    orderBy: { assignedAt: 'desc' },
  });

  const rows = assignments
    .filter((a) => filters.includeCompleted || !['COMPLETED', 'CANCELLED'].includes(a.task.status))
    .filter((a) => !filters.status || a.task.status === filters.status);

  return rows.map((a) => ({
    assignment: { id: a.id, role: a.role, status: a.status, allocatedHours: a.allocatedHours },
    task: a.task,
    unmetDependencies: a.task.dependencies
      .filter((d) => !['COMPLETED', 'CANCELLED'].includes(d.predecessor.status))
      .map((d) => d.predecessor),
  }));
}

export async function getTaskDetail(principal: Principal, taskId: string) {
  await assertTaskVisible(principal, taskId);

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      project: {
        select: { id: true, code: true, name: true, clientName: true, departmentId: true, managerId: true, startDate: true },
      },
      parent: { select: { id: true, code: true, title: true } },
      children: {
        select: { id: true, code: true, title: true, status: true, percentComplete: true, estimatedHours: true },
        orderBy: { code: 'asc' },
      },
      createdBy: { select: { id: true, fullName: true, avatarColor: true } },
      milestone: { select: { id: true, name: true, dueDate: true } },
      assignments: {
        include: { user: { select: { id: true, fullName: true, avatarColor: true, designation: true, grade: true } } },
        orderBy: { assignedAt: 'desc' },
      },
      progressLogs: {
        include: { user: { select: { id: true, fullName: true, avatarColor: true } } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      },
      handovers: {
        include: {
          fromUser: { select: { id: true, fullName: true, avatarColor: true } },
          toUser: { select: { id: true, fullName: true, avatarColor: true } },
        },
        orderBy: { createdAt: 'desc' },
      },
      comments: {
        include: { user: { select: { id: true, fullName: true, avatarColor: true } } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      },
      dependencies: {
        include: { predecessor: { select: { id: true, code: true, title: true, status: true, percentComplete: true } } },
      },
      dependents: {
        include: { successor: { select: { id: true, code: true, title: true, status: true, percentComplete: true } } },
      },
    },
  });
  if (!task) throw new NotFoundError('Task not found.');

  const graph = await loadProjectGraph(task.projectId);
  const blockers = blockingReasons(taskId, graph);
  const scope = { projectId: task.projectId, departmentId: task.project.departmentId };
  const isHolder = task.assignments.some((a) => a.status === 'ACTIVE' && a.userId === principal.userId);
  const isManager = task.project.managerId === principal.userId;

  return {
    task,
    blockers,
    downstreamCount: downstreamTaskIds(taskId, graph.edges).length,
    permissions: {
      canEdit: can(principal, 'pm.task.update', scope) || isManager,
      canAssign: can(principal, 'pm.task.assign', scope) || isManager,
      canLogProgress: isHolder || can(principal, 'pm.progress.log', scope) || isManager,
      canHandover: isHolder || can(principal, 'pm.handover.override', scope) || isManager,
      canManageDependencies: can(principal, 'pm.task.dependency.manage', scope) || isManager,
      canDelete: can(principal, 'pm.task.delete', scope) || isManager,
      isHolder,
    },
  };
}

export async function addComment(principal: Principal, taskId: string, body: string) {
  await assertTaskVisible(principal, taskId);
  const trimmed = body.trim();
  if (trimmed.length < 1) throw new DomainError('Comment cannot be empty.');

  const task = await loadTaskContext(taskId);
  return prisma.$transaction(async (tx) => {
    const comment = await tx.taskComment.create({ data: { taskId, userId: principal.userId, body: trimmed } });
    await notify(
      {
        userIds: task.assigneeIds.filter((id) => id !== principal.userId),
        title: `Comment on ${task.code}`,
        body: `${principal.fullName}: ${trimmed.slice(0, 140)}`,
        link: `/pm/tasks/${taskId}`,
      },
      tx,
    );
    return comment;
  });
}
