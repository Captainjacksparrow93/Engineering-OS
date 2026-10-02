import { prisma } from '@/core/db/prisma';
import { DomainError } from '@/core/rbac/errors';
import type { Principal } from '@/core/rbac/types';
import { audit } from '@/core/audit/audit';
import { publish } from '@/core/events/bus';
import { EVENTS } from '@/core/events/catalog';
import { notify } from '@/core/notifications/notify';
import { formatName } from '@/core/utils/strings';
import { assertTaskPermission, oversightRecipients } from './access';
import { recomputeTaskDerivedState } from './task.service';
import { startOfDay } from '@/core/utils/dates';
import type { ProgressInput } from '../validation/schemas';

/**
 * Progress punch-in.
 *
 * The log is the source of truth and is append-only; `Task.percentComplete` is
 * the projection maintained here.
 */
export async function logProgress(principal: Principal, input: ProgressInput) {
  await assertTaskPermission(principal, input.taskId, 'pm.progress.log');
  const task = await prisma.task.findUniqueOrThrow({ where: { id: input.taskId } });

  if (['COMPLETED', 'CANCELLED'].includes(task.status)) {
    throw new DomainError('Progress cannot be logged against a closed task.');
  }

  if (input.percentComplete < task.percentComplete) {
    throw new DomainError('Task completion percentage cannot decrease.');
  }

  const childCount = await prisma.task.count({ where: { parentId: input.taskId } });
  if (childCount > 0) {
    throw new DomainError('Progress cannot be logged directly on phase/container tasks.');
  }

  const result = await prisma.$transaction(async (tx) => {
    const log = await tx.taskProgressLog.create({
      data: {
        taskId: input.taskId,
        userId: principal.userId,
        percentComplete: input.percentComplete,
        hoursSpent: input.hoursSpent ?? 0,
        note: input.note,
        blocker: input.blocker ?? null,
        loggedFor: input.loggedFor ? startOfDay(input.loggedFor) : startOfDay(new Date()),
      },
    });

    let nextStatus = task.status;
    let submittedAt = task.submittedAt;

    if (input.blocker && input.blocker.trim().length > 0) {
      nextStatus = 'BLOCKED';
    } else if (input.percentComplete >= 100) {
      nextStatus = 'IN_REVIEW';
      submittedAt = new Date();
    } else if (task.status === 'TODO') {
      nextStatus = 'IN_PROGRESS';
    }

    if (nextStatus === 'IN_PROGRESS') {
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

    await tx.task.update({
      where: { id: input.taskId },
      data: {
        percentComplete: input.percentComplete,
        status: nextStatus,
        actualStart: task.actualStart ?? new Date(),
        submittedAt,
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
          status: { from: task.status, to: nextStatus },
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
          hasBlocker: Boolean(input.blocker),
        },
      },
      tx,
    );

    const project = await tx.project.findUnique({
      where: { id: task.projectId },
      select: { managerId: true, departmentId: true, code: true, name: true },
    });

    if (input.blocker && input.blocker.trim().length > 0) {
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

      const oversightIds = await oversightRecipients(principal.companyId, project?.departmentId, principal.userId);
      const recipientIds = Array.from(
        new Set([project?.managerId, ...oversightIds].filter((v): v is string => Boolean(v) && v !== principal.userId)),
      );

      if (recipientIds.length > 0) {
        await notify(
          {
            userIds: recipientIds,
            title: `Problem reported on ${project?.name || ''} · ${task.title}`,
            body: `${formatName(principal.fullName)}: ${input.blocker.slice(0, 200)}`,
            link: `/pm/tasks/${input.taskId}`,
          },
          tx,
        );
      }
    }

    if (nextStatus === 'IN_REVIEW' && task.status !== 'IN_REVIEW') {
      const oversightIds = await oversightRecipients(principal.companyId, project?.departmentId, principal.userId);
      const recipientIds = Array.from(
        new Set([project?.managerId, ...oversightIds].filter((v): v is string => Boolean(v) && v !== principal.userId)),
      );

      if (recipientIds.length > 0) {
        await notify(
          {
            userIds: recipientIds,
            title: `Review ready: ${task.title}`,
            body: `${formatName(principal.fullName)} reported "${task.title}" as 100% complete and submitted for review in ${project?.name || ''}.`,
            link: `/pm/tasks/${input.taskId}`,
          },
          tx,
        );
      }
    }

    return log;
  });

  await recomputeTaskDerivedState(task.projectId);
  return result;
}
