import { prisma } from '@/core/db/prisma';
import { DomainError } from '@/core/rbac/errors';
import type { Principal } from '@/core/rbac/types';
import { audit } from '@/core/audit/audit';
import { publish } from '@/core/events/bus';
import { EVENTS } from '@/core/events/catalog';
import { notify } from '@/core/notifications/notify';
import { formatName } from '@/core/utils/strings';
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
  await assertTaskPermission(principal, input.taskId, 'pm.progress.log');
  const task = await prisma.task.findUniqueOrThrow({ where: { id: input.taskId } });

  if (['COMPLETED', 'CANCELLED'].includes(task.status)) {
    throw new DomainError('Progress cannot be logged against a closed task.');
  }

  const result = await prisma.$transaction(async (tx) => {
    const log = await tx.taskProgressLog.create({
      data: {
        taskId: input.taskId,
        userId: principal.userId,
        percentComplete: input.percentComplete,
        hoursSpent: input.hoursSpent,
        note: input.note,
        blocker: input.blocker ?? null,
        loggedFor: input.loggedFor ? startOfDay(input.loggedFor) : startOfDay(new Date()),
      },
    });

    const nextStatus =
      input.blocker && input.blocker.trim().length > 0
        ? 'BLOCKED'
        : task.status === 'TODO'
          ? 'IN_PROGRESS'
          : task.status;

    const updatedTask = await tx.task.update({
      where: { id: input.taskId },
      data: {
        percentComplete: input.percentComplete,
        actualHours: { increment: input.hoursSpent },
        status: nextStatus,
        actualStart: task.actualStart ?? new Date(),
        actualEnd: input.percentComplete >= 100 ? task.actualEnd ?? new Date() : null,
      },
    });

    await audit(
      {
        actorId: principal.userId,
        module: 'pm',
        action: 'task.progress_logged',
        entityType: 'Task',
        entityId: input.taskId,
        diff: {
          percentComplete: { from: task.percentComplete, to: input.percentComplete },
          hoursSpent: input.hoursSpent,
          totalActualHours: updatedTask.actualHours,
          blocker: input.blocker ?? null,
        },
      },
      tx,
    );

    await publish(
      {
        name: EVENTS.PROGRESS_LOGGED,
        module: 'pm',
        entityType: 'TaskProgressLog',
        entityId: log.id,
        actorId: principal.userId,
        payload: {
          taskId: input.taskId,
          projectId: task.projectId,
          percentComplete: input.percentComplete,
          hoursSpent: input.hoursSpent,
          hasBlocker: Boolean(input.blocker),
        },
      },
      tx,
    );

    if (input.blocker && input.blocker.trim().length > 0) {
      const project = await tx.project.findUnique({
        where: { id: task.projectId },
        select: { managerId: true, sponsorId: true, code: true, name: true },
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
          title: `Roadblock on ${project?.name || ''} · ${task.title}`,
          body: `${formatName(principal.fullName)}: ${input.blocker.slice(0, 200)}`,
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
          title: `Review ready: ${task.title}`,
          body: `${formatName(principal.fullName)} reported "${task.title}" as 100% complete.`,
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
