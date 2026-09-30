import type { TaskStatus as PrismaTaskStatus } from '@prisma/client';
import { prisma, type Tx } from '@/core/db/prisma';
import { DomainError, ForbiddenError, NotFoundError } from '@/core/rbac/errors';
import { can, hasPermissionAnywhere, isReadOnly } from '@/core/rbac/engine';
import type { Principal } from '@/core/rbac/types';
import { audit, diffOf } from '@/core/audit/audit';
import { publish } from '@/core/events/bus';
import { EVENTS } from '@/core/events/catalog';
import { notify } from '@/core/notifications/notify';
import { assertProjectPermission, assertTaskPermission, assertTaskVisible, loadTaskContext, oversightRecipients, projectVisibilityWhere } from './access';
import { addDependency } from './dependency.service';
import type { CreateTaskInput } from '../validation/schemas';
import { blockingReasons, completionBlockers, downstreamTaskIds, rollUpProgress, type Graph } from '../domain/scheduling';
import { formatName } from '@/core/utils/strings';

/**
 * Task lifecycle: creation inside the WBS, assignment, status transitions and the
 * bookkeeping that keeps derived fields (blocked state, rolled-up progress) true.
 */

const ALLOWED_TRANSITIONS: Record<PrismaTaskStatus, PrismaTaskStatus[]> = {
  DRAFT: ['TODO', 'CANCELLED'],
  BLOCKED: ['TODO', 'IN_PROGRESS', 'CANCELLED'],
  TODO: ['IN_PROGRESS', 'BLOCKED', 'CANCELLED'],
  IN_PROGRESS: ['IN_REVIEW', 'BLOCKED', 'TODO', 'CANCELLED'],
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

  if (before.type === 'PHASE' && (input.plannedStart !== undefined || input.plannedEnd !== undefined)) {
    throw new DomainError("Panel delivery dates can't be changed from a task.");
  }

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
  const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });

  if (task.status === status) return task;
  if (!ALLOWED_TRANSITIONS[task.status].includes(status)) {
    throw new DomainError(`A task cannot move from ${task.status} to ${status}.`);
  }

  if (
    ((task.status === 'TODO' || task.status === 'BLOCKED') && status === 'IN_PROGRESS') ||
    (task.status === 'IN_PROGRESS' && status === 'IN_REVIEW')
  ) {
    await assertTaskPermission(principal, taskId, 'pm.progress.log');
  } else if (
    (task.status === 'IN_REVIEW' && (status === 'COMPLETED' || status === 'IN_PROGRESS')) ||
    (task.status === 'COMPLETED' && status === 'IN_PROGRESS')
  ) {
    await assertTaskPermission(principal, taskId, 'pm.progress.review');
  } else if (status === 'CANCELLED') {
    await assertTaskPermission(principal, taskId, 'pm.task.cancel');
  } else {
    await assertTaskPermission(principal, taskId, 'pm.task.update');
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
    if (status === 'IN_PROGRESS') {
      const proj = await tx.project.findUnique({ where: { id: task.projectId }, select: { status: true } });
      if (proj?.status === 'PLANNING') {
        await tx.project.update({ where: { id: task.projectId }, data: { status: 'IN_PROGRESS' } });
        await audit(
          {
            actorId: principal.userId,
            module: 'pm',
            action: 'project.status_changed',
            entityType: 'Project',
            entityId: task.projectId,
            diff: { status: { from: 'PLANNING', to: 'IN_PROGRESS' } },
          },
          tx,
        );
      }
    }

    const updateResult = await tx.task.updateMany({
      where: { id: taskId, status: task.status },
      data: {
        status,
        percentComplete: status === 'COMPLETED' ? 100 : task.percentComplete,
        actualStart: status === 'IN_PROGRESS' && !task.actualStart ? new Date() : task.actualStart,
        submittedAt: status === 'IN_REVIEW' ? new Date() : task.submittedAt,
        completedAt: status === 'COMPLETED' ? new Date() : status === 'IN_PROGRESS' ? null : task.completedAt,
        completedById: status === 'COMPLETED' ? principal.userId : status === 'IN_PROGRESS' ? null : task.completedById,
      },
    });

    if (updateResult.count === 0) {
      throw new DomainError('The task status was changed by another user or process. Please reload and try again.');
    }

    const result = await tx.task.findUniqueOrThrow({ where: { id: taskId } });

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

    const project = await tx.project.findUnique({
      where: { id: task.projectId },
      select: { id: true, name: true, managerId: true, departmentId: true },
    });

    const oversightIds = await oversightRecipients(principal.companyId, project?.departmentId, principal.userId);

    if (status === 'COMPLETED') {
      const leadershipIds = Array.from(
        new Set([project?.managerId, ...oversightIds].filter((uid): uid is string => Boolean(uid) && uid !== principal.userId)),
      );

      if (leadershipIds.length > 0) {
        await notify(
          {
            userIds: leadershipIds,
            title: `Task completed: ${task.title}`,
            body: `${formatName(principal.fullName)} approved and completed "${task.title}" in ${project?.name || ''}.`,
            link: `/pm/projects/${task.projectId}`,
          },
          tx,
        );
      }

      // Tell holders their work was approved
      const holders = await tx.taskAssignment.findMany({
        where: { taskId },
        select: { userId: true },
      });
      const holderIds = holders.map((h) => h.userId).filter((uid) => uid !== principal.userId);
      if (holderIds.length > 0) {
        await notify(
          {
            userIds: holderIds,
            title: `Step approved: ${task.title}`,
            body: `Your step "${task.title}" has been approved and marked complete.`,
            link: `/pm/tasks/${taskId}`,
          },
          tx,
        );
      }

      // Whoever was waiting on this can now move
      const unblocked = downstreamTaskIds(taskId, graph.edges);
      if (unblocked.length) {
        const downstreamHolders = await tx.taskAssignment.findMany({
          where: { taskId: { in: unblocked }, status: 'ACTIVE' },
          select: { userId: true, taskId: true },
        });
        const downstreamNotifyIds = downstreamHolders
          .map((h) => h.userId)
          .filter((uid) => uid !== principal.userId);
        if (downstreamNotifyIds.length > 0) {
          await notify(
            {
              userIds: downstreamNotifyIds,
              title: `${task.title} is done`,
              body: `A task you are waiting on ("${task.title}") has been completed.`,
              link: `/pm/projects/${task.projectId}`,
            },
            tx,
          );
        }
      }
    } else if (status === 'IN_REVIEW') {
      const reviewNotifyIds = Array.from(
        new Set([project?.managerId, ...oversightIds].filter((uid): uid is string => Boolean(uid) && uid !== principal.userId)),
      );
      if (reviewNotifyIds.length > 0) {
        await notify(
          {
            userIds: reviewNotifyIds,
            title: `Review submitted: ${task.title}`,
            body: `${formatName(principal.fullName)} submitted "${task.title}" for review in ${project?.name || ''}.`,
            link: `/pm/tasks/${taskId}`,
          },
          tx,
        );
      }
    } else if (status === 'IN_PROGRESS' && task.status === 'IN_REVIEW') {
      // Sent back for rework
      const activeHolders = await tx.taskAssignment.findMany({
        where: { taskId, status: 'ACTIVE' },
        select: { userId: true },
      });
      const reworkNotifyIds = Array.from(
        new Set(
          [...activeHolders.map((h) => h.userId), ...oversightIds].filter(
            (uid): uid is string => Boolean(uid) && uid !== principal.userId,
          ),
        ),
      );
      if (reworkNotifyIds.length > 0) {
        await notify(
          {
            userIds: reworkNotifyIds,
            title: `Sent back: ${task.title}`,
            body: `${formatName(principal.fullName)} requested rework on "${task.title}": ${note || 'Changes required.'}`,
            link: `/pm/tasks/${taskId}`,
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
  await assertTaskPermission(principal, taskId, 'pm.task.assign');
  const task = await prisma.task.findUniqueOrThrow({
    where: { id: taskId },
    include: {
      project: { select: { id: true, code: true, name: true, managerId: true, departmentId: true } },
      assignments: { where: { status: 'ACTIVE', role: 'OWNER' } },
    },
  });
  const role = input.role ?? 'OWNER';

  const assignee = await prisma.user.findFirst({
    where: { id: input.userId, companyId: principal.companyId, status: 'ACTIVE' },
    select: { id: true, fullName: true, grade: true },
  });
  if (!assignee) throw new DomainError('That employee is not active.');

  // Management assignment: direct move, no request menu items, releases previous owner
  const remainingHours =
    input.allocatedHours ?? Math.max(1, task.estimatedHours * (1 - task.percentComplete / 100));

  const existingOwner = task.assignments.find((a) => a.role === 'OWNER');
  const isReassignment = role === 'OWNER' && Boolean(existingOwner);

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

    await tx.projectMember.upsert({
      where: { projectId_userId: { projectId: task.projectId, userId: input.userId } },
      create: { projectId: task.projectId, userId: input.userId, role: 'ENGINEER' },
      update: {},
    });

    // Withdraw any pending handover requests on this task
    await tx.taskHandover.updateMany({
      where: { taskId, status: { in: ['PENDING', 'AWAITING_HEAD_APPROVAL'] } },
      data: {
        status: 'WITHDRAWN',
        decidedById: principal.userId,
        decidedAt: new Date(),
        decisionNote: 'Reassigned directly by management',
      },
    });

    await audit(
      {
        actorId: principal.userId,
        module: 'pm',
        action: isReassignment ? 'task.reassigned' : 'task.assigned',
        entityType: 'Task',
        entityId: taskId,
        diff: {
          fromUserId: isReassignment ? existingOwner!.userId : null,
          toUserId: input.userId,
          role,
          allocatedHours: remainingHours,
          note: input.note ?? null,
        },
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

    // Notify new assignee
    if (input.userId !== principal.userId) {
      await notify(
        {
          userIds: [input.userId],
          title: `New ${task.type === 'ADHOC' ? 'ad-hoc ' : ''}task: ${task.title}`,
          body: `${formatName(principal.fullName)} assigned you "${task.title}" (${Math.round(remainingHours)}h${
            task.plannedEnd ? `, due ${task.plannedEnd.toISOString().slice(0, 10)}` : ''
          }).`,
          link: `/pm/tasks/${taskId}`,
        },
        tx,
      );
    }

    // If reassigning, notify outgoing owner
    if (isReassignment && existingOwner && existingOwner.userId !== principal.userId && existingOwner.userId !== input.userId) {
      await notify(
        {
          userIds: [existingOwner.userId],
          title: `Task reassigned: ${task.title}`,
          body: `${formatName(principal.fullName)} reassigned "${task.title}" to ${formatName(assignee.fullName)}.`,
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
  const parentIds = new Set(graph.tasks.map((t) => t.parentId).filter(Boolean));

  // Single batch query for latest roadblock logs across all tasks in the project
  const latestLogs = await tx.taskProgressLog.findMany({
    where: { task: { projectId } },
    orderBy: { createdAt: 'desc' },
    distinct: ['taskId'],
    select: { taskId: true, blocker: true },
  });
  const roadblockMap = new Map(
    latestLogs.map((l) => [l.taskId, Boolean(l.blocker && l.blocker.trim().length > 0)]),
  );

  for (const task of graph.tasks) {
    const updates: Record<string, unknown> = {};

    if (task.status === 'TODO' || task.status === 'BLOCKED') {
      const blockers = blockingReasons(task.id, graph);
      const hasRoadblock = roadblockMap.get(task.id) ?? false;
      const shouldBe = blockers.length > 0 || hasRoadblock
        ? 'BLOCKED'
        : task.actualStart || task.percentComplete > 0
          ? 'IN_PROGRESS'
          : 'TODO';
      if (shouldBe !== task.status) updates.status = shouldBe;
    }

    const rolled = rollup.get(task.id);
    const isParent = parentIds.has(task.id);
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
      actualStart: true,
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
export async function listMyTasks(
  principal: Principal,
  filters: { status?: string; includeCompleted?: boolean; onlyCompleted?: boolean } = {},
) {
  const assignments = await prisma.taskAssignment.findMany({
    where: {
      userId: principal.userId,
      status: filters.includeCompleted || filters.onlyCompleted ? undefined : 'ACTIVE',
      task: {
        project: {
          status: { not: 'ON_HOLD' },
        },
      },
    },
    include: {
      task: {
        include: {
          project: { select: { id: true, code: true, name: true, clientName: true, priority: true } },
          parent: { select: { id: true, code: true, title: true } },
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
    .filter((a) => {
      if (filters.onlyCompleted) {
        return a.task.status === 'COMPLETED';
      }
      return filters.includeCompleted || !['COMPLETED', 'CANCELLED'].includes(a.task.status);
    })
    .filter((a) => !filters.status || a.task.status === filters.status)
    .sort((a, b) => {
      if (!a.task.plannedEnd && !b.task.plannedEnd) return 0;
      if (!a.task.plannedEnd) return 1;
      if (!b.task.plannedEnd) return -1;
      return new Date(a.task.plannedEnd).getTime() - new Date(b.task.plannedEnd).getTime();
    });

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
  const isManager = task.project.managerId === principal.userId;
  const isHolder = task.assignments.some((a) => a.status === 'ACTIVE' && a.userId === principal.userId);
  const isHolderOrLead =
    isHolder ||
    Boolean(
      principal.reportIds &&
        principal.reportIds.length > 0 &&
        task.assignments.some((a) => a.status === 'ACTIVE' && principal.reportIds.includes(a.userId)),
    );
  const canStart =
    (task.status === 'TODO' || task.status === 'BLOCKED') &&
    blockers.length === 0 &&
    isHolderOrLead;

  const canMarkCompleted =
    task.status === 'IN_PROGRESS' &&
    isHolderOrLead;

  const canReview =
    task.status === 'IN_REVIEW' &&
    (can(principal, 'pm.progress.review', scope) || isManager);

  const canCancel =
    !['COMPLETED', 'CANCELLED'].includes(task.status) &&
    can(principal, 'pm.task.cancel', scope);

  const canDelete =
    can(principal, 'pm.task.delete', scope);

  const canReopen =
    task.status === 'COMPLETED' &&
    (can(principal, 'pm.progress.review', scope) || isManager);

  const canReportProblem =
    !['COMPLETED', 'CANCELLED'].includes(task.status) &&
    isHolderOrLead;

  const canLogProgress =
    !['COMPLETED', 'CANCELLED'].includes(task.status) &&
    isHolderOrLead;

  const canReviewOrManage =
    can(principal, 'pm.progress.review', scope) || isManager;

  const canRequestReassign =
    isHolderOrLead ||
    can(principal, 'pm.progress.review', scope) ||
    isManager ||
    can(principal, 'pm.task.cancel', scope);

  return {
    task,
    blockers,
    downstreamCount: downstreamTaskIds(taskId, graph.edges).length,
    permissions: {
      canEdit: can(principal, 'pm.task.update', scope) || isManager,
      canAssign: can(principal, 'pm.task.assign', scope) || isManager,
      canLogProgress,
      canHandover: !['COMPLETED', 'CANCELLED'].includes(task.status) && canRequestReassign,
      canManageDependencies: can(principal, 'pm.task.dependency.manage', scope) || isManager || can(principal, 'pm.task.update', scope),
      canDelete,
      canStart,
      canSubmit: canMarkCompleted,
      canMarkCompleted,
      canReview,
      canCancel,
      canReopen,
      canReportProblem,
      canReviewOrManage,
      canRequestReassign,
      isHolder,
      isHolderOrLead,
    },
  };
}

export async function addComment(principal: Principal, taskId: string, body: string) {
  if (isReadOnly(principal)) throw new ForbiddenError('Read-only access cannot post comments.');
  await assertTaskVisible(principal, taskId);
  const trimmed = body.trim();
  if (trimmed.length < 1) throw new DomainError('Comment cannot be empty.');

  const task = await loadTaskContext(taskId);
  return prisma.$transaction(async (tx) => {
    const comment = await tx.taskComment.create({ data: { taskId, userId: principal.userId, body: trimmed } });
    await notify(
      {
        userIds: task.assigneeIds.filter((id) => id !== principal.userId),
        title: `Comment on ${task.title}`,
        body: `${formatName(principal.fullName)}: ${trimmed.slice(0, 140)}`,
        link: `/pm/tasks/${taskId}`,
      },
      tx,
    );
    return comment;
  });
}

/**
 * Project Manager Quality Gate: Approve task submitted for review.
 * Marks task COMPLETED, auto-unlocks downstream tasks, and checks if the entire project is completed.
 */
export async function approveTaskReview(principal: Principal, taskId: string, feedback?: string) {
  await assertTaskPermission(principal, taskId, 'pm.progress.review');

  const task = await prisma.task.findUniqueOrThrow({
    where: { id: taskId },
    include: {
      project: { select: { id: true, managerId: true, departmentId: true, name: true } },
      assignments: { where: { status: 'ACTIVE' } },
    },
  });

  const updatedTask = await changeTaskStatus(principal, taskId, 'COMPLETED', feedback);

  const trimmedFeedback = feedback?.trim();
  if (trimmedFeedback) {
    await prisma.taskComment.create({
      data: {
        taskId,
        userId: principal.userId,
        body: `[PM Review Approved]: ${trimmedFeedback}`,
      },
    });
  }

  const remainingOpen = await prisma.task.count({
    where: {
      projectId: task.projectId,
      id: { not: taskId },
      status: { notIn: ['COMPLETED', 'CANCELLED'] },
    },
  });

  return {
    task: updatedTask,
    allTasksCompleted: remainingOpen === 0,
    projectId: task.projectId,
    projectName: task.project.name,
  };
}

/**
 * Project Manager Quality Gate: Disapprove/reject task submitted for review.
 * Reverts task to IN_PROGRESS, adds corrective feedback comment, and notifies assignee.
 */
export async function disapproveTaskReview(principal: Principal, taskId: string, feedback: string) {
  await assertTaskPermission(principal, taskId, 'pm.progress.review');

  const task = await prisma.task.findUniqueOrThrow({
    where: { id: taskId },
    include: {
      project: { select: { id: true, managerId: true, departmentId: true, name: true } },
      assignments: { where: { status: 'ACTIVE' } },
    },
  });

  const updatedTask = await changeTaskStatus(principal, taskId, 'IN_PROGRESS', feedback);

  const trimmedFeedback = feedback.trim();
  if (trimmedFeedback) {
    await prisma.taskComment.create({
      data: {
        taskId,
        userId: principal.userId,
        body: `[PM Review - Revision Required]: ${trimmedFeedback}`,
      },
    });
  }

  const assigneeIds = task.assignments.map((a) => a.userId);
  if (assigneeIds.length > 0) {
    await notify({
      userIds: assigneeIds,
      title: `Task needs revision: ${task.title}`,
      body: `${formatName(principal.fullName)} requested revisions: ${trimmedFeedback.slice(0, 140)}`,
      link: `/pm/tasks/${taskId}`,
    });
  }

  return updatedTask;
}

/**
 * Roadblock Flagging: Engineer flags an active task with a handwritten explanation.
 */
export async function flagRoadblock(principal: Principal, taskId: string, comment: string) {
  await assertTaskPermission(principal, taskId, 'pm.progress.log');

  const trimmed = comment.trim();
  if (trimmed.length < 5) {
    throw new DomainError('Please enter a specific explanation of the roadblock (at least 5 characters).');
  }

  const task = await prisma.task.findUniqueOrThrow({
    where: { id: taskId },
    include: {
      project: { select: { id: true, managerId: true, sponsorId: true, code: true, name: true } },
    },
  });

  if (task.status === 'COMPLETED' || task.status === 'CANCELLED') {
    throw new DomainError('Cannot flag a roadblock on a completed or cancelled task.');
  }

  await prisma.$transaction(async (tx) => {
    await tx.taskProgressLog.create({
      data: {
        taskId,
        userId: principal.userId,
        percentComplete: task.percentComplete,
        hoursSpent: 0,
        note: `[ROADBLOCK FLAGGED]: ${trimmed}`,
        blocker: trimmed,
        loggedFor: new Date(),
      },
    });

    await tx.task.update({
      where: { id: taskId },
      data: { status: 'BLOCKED' },
    });

    await notify(
      {
        userIds: [task.project.managerId, task.project.sponsorId].filter((id): id is string => Boolean(id)),
        title: `Roadblock on ${task.project.name} · ${task.title}`,
        body: `${formatName(principal.fullName)}: ${trimmed.slice(0, 200)}`,
        link: `/pm/tasks/${taskId}`,
      },
      tx,
    );

    await publish(
      {
        name: EVENTS.TASK_BLOCKED,
        module: 'pm',
        entityType: 'Task',
        entityId: taskId,
        actorId: principal.userId,
        payload: { projectId: task.projectId, code: task.code, blocker: trimmed },
      },
      tx,
    );
  });

  await recomputeTaskDerivedState(task.projectId);
  return { success: true };
}

export async function countPendingApprovals(principal: Principal): Promise<number> {
  const canReview = hasPermissionAnywhere(principal, 'pm.progress.review');
  const isManager = principal.memberProjectIds.length > 0;
  if (!canReview && !isManager) return 0;

  const visibility = projectVisibilityWhere(principal);
  return prisma.task.count({
    where: {
      status: 'IN_REVIEW',
      project: visibility,
    },
  });
}

export async function listPendingApprovals(principal: Principal) {
  const canReview = hasPermissionAnywhere(principal, 'pm.progress.review');
  const isManager = principal.memberProjectIds.length > 0;
  if (!canReview && !isManager) return [];

  const visibility = projectVisibilityWhere(principal);
  return prisma.task.findMany({
    where: {
      status: 'IN_REVIEW',
      project: visibility,
    },
    include: {
      project: {
        select: {
          id: true,
          code: true,
          name: true,
          clientName: true,
        },
      },
      assignments: {
        where: { status: 'ACTIVE' },
        include: {
          user: {
            select: {
              id: true,
              fullName: true,
              avatarColor: true,
              designation: true,
              grade: true,
            },
          },
        },
      },
      progressLogs: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: {
          note: true,
          blocker: true,
          createdAt: true,
          user: { select: { fullName: true } },
        },
      },
    },
    orderBy: { updatedAt: 'desc' },
  });
}


