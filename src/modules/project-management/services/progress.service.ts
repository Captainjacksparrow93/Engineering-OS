import { prisma } from '@/core/db/prisma';
import { DomainError } from '@/core/rbac/errors';
import type { Principal } from '@/core/rbac/types';
import { audit } from '@/core/audit/audit';
import { publish } from '@/core/events/bus';
import { EVENTS } from '@/core/events/catalog';
import { notify } from '@/core/notifications/notify';
import { assertTaskPermission } from './access';
import { recomputeTaskDerivedState } from './task.service';
import { startOfDay } from '@/core/utils/dates';
import type { ProgressInput } from '../validation/schemas';

/**
 * Progress punch-in.
 *
 * The log is the source of truth and is append-only; `Task.percentComplete` and
 * `Task.actualHours` are projections maintained here. That is what makes the progress
 * history defensible when a customer disputes a delivery date months later.
 */
export async function logProgress(principal: Principal, input: ProgressInput) {
  const context = await assertTaskPermission(principal, input.taskId, 'pm.progress.log');
  const task = await prisma.task.findUniqueOrThrow({ where: { id: input.taskId } });

  if (task.status === 'CANCELLED') throw new DomainError('This task was cancelled.');
  if (task.status === 'COMPLETED') throw new DomainError('This task is already complete. Reopen it to log more work.');

  const hasChildren = await prisma.task.count({ where: { parentId: task.id } });
  if (hasChildren > 0) {
    throw new DomainError('Progress is rolled up from subtasks. Log against the subtask instead.');
  }

  if (input.percentComplete < task.percentComplete) {
    throw new DomainError(
      `Progress cannot go backwards (currently ${task.percentComplete}%). Add a note or raise a blocker instead.`,
    );
  }

  const loggedFor = startOfDay(input.loggedFor ?? new Date());
  const today = startOfDay(new Date());
  if (loggedFor > today) throw new DomainError('You cannot log progress for a future date.');

  const nextStatus =
    input.percentComplete >= 100
      ? 'IN_REVIEW'
      : task.status === 'TODO' || task.status === 'BLOCKED'
        ? 'IN_PROGRESS'
        : task.status;

  const result = await prisma.$transaction(async (tx) => {
    const log = await tx.taskProgressLog.create({
      data: {
        taskId: input.taskId,
        userId: principal.userId,
        percentComplete: input.percentComplete,
        hoursSpent: input.hoursSpent,
        note: input.note,
        blocker: input.blocker || null,
        loggedFor,
      },
    });

    await tx.task.update({
      where: { id: input.taskId },
      data: {
        percentComplete: input.percentComplete,
        actualHours: { increment: input.hoursSpent },
        status: nextStatus as never,
        actualStart: task.actualStart ?? new Date(),
      },
    });

    await audit(
      {
        actorId: principal.userId,
        module: 'pm',
        action: 'progress.logged',
        entityType: 'Task',
        entityId: input.taskId,
        diff: {
          percentComplete: { from: task.percentComplete, to: input.percentComplete },
          hoursSpent: input.hoursSpent,
          blocker: input.blocker ?? null,
        },
      },
      tx,
    );

    await publish(
      {
        name: EVENTS.PROGRESS_LOGGED,
        module: 'pm',
        entityType: 'Task',
        entityId: input.taskId,
        actorId: principal.userId,
        payload: {
          projectId: task.projectId,
          code: task.code,
          percentComplete: input.percentComplete,
          hoursSpent: input.hoursSpent,
          blocked: Boolean(input.blocker),
        },
      },
      tx,
    );

    // A blocker is the one thing management must never learn about late.
    if (input.blocker) {
      const project = await tx.project.findUnique({
        where: { id: task.projectId },
        select: { managerId: true, sponsorId: true, code: true },
      });
      await publish(
        {
          name: EVENTS.TASK_BLOCKED,
          module: 'pm',
          entityType: 'Task',
          entityId: input.taskId,
          actorId: principal.userId,
          payload: { projectId: task.projectId, code: task.code, blocker: input.blocker },
        },
        tx,
      );
      await notify(
        {
          userIds: [project?.managerId, project?.sponsorId].filter((v): v is string => Boolean(v)),
          title: `Blocker raised on ${context.code}`,
          body: `${principal.fullName}: ${input.blocker.slice(0, 200)}`,
          link: `/pm/tasks/${input.taskId}`,
        },
        tx,
      );
    }

    if (input.percentComplete >= 100) {
      const project = await tx.project.findUnique({ where: { id: task.projectId }, select: { managerId: true } });
      await notify(
        {
          userIds: project?.managerId ? [project.managerId] : [],
          title: `${context.code} is ready for review`,
          body: `${principal.fullName} reported "${task.title}" as 100% complete.`,
          link: `/pm/tasks/${input.taskId}`,
        },
        tx,
      );
    }

    return log;
  });

  await recomputeTaskDerivedState(task.projectId);
  return result;
}

/** Progress punched by one person over a date range - the basis of a timesheet view. */
export async function progressFeed(
  principal: Principal,
  options: { userId?: string; projectId?: string; from?: Date; to?: Date; limit?: number } = {},
) {
  return prisma.taskProgressLog.findMany({
    where: {
      ...(options.userId ? { userId: options.userId } : {}),
      ...(options.projectId ? { task: { projectId: options.projectId } } : {}),
      ...(options.from || options.to
        ? { loggedFor: { ...(options.from ? { gte: options.from } : {}), ...(options.to ? { lte: options.to } : {}) } }
        : {}),
      task: { project: { companyId: principal.companyId } },
    },
    include: {
      user: { select: { id: true, fullName: true, avatarColor: true } },
      task: {
        select: { id: true, code: true, title: true, status: true, project: { select: { id: true, code: true } } },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: options.limit ?? 50,
  });
}
