import { prisma } from '@/core/db/prisma';
import { can } from '@/core/rbac/engine';
import { DomainError, ForbiddenError, NotFoundError } from '@/core/rbac/errors';
import type { Principal } from '@/core/rbac/types';
import { audit } from '@/core/audit/audit';
import { publish } from '@/core/events/bus';
import { EVENTS } from '@/core/events/catalog';
import { notify } from '@/core/notifications/notify';
import { assertTaskPermission, loadTaskContext } from './access';

/**
 * Peer handover.
 *
 * The real-world case: an engineer has a task half done and cannot finish it - site
 * visit, illness, a hotter priority. They pass the REMAINING work to a peer, who
 * accepts it. Management does not have to be in the loop to unblock the work, but is
 * always told, and the effort already spent stays attributed to the original engineer.
 *
 * This is deliberately different from `assignTask`, which is a top-down reassignment.
 */
export async function requestHandover(
  principal: Principal,
  input: { taskId: string; toUserId: string; reason: string },
) {
  const context = await assertTaskPermission(principal, input.taskId, 'pm.handover.request');
  const task = await prisma.task.findUniqueOrThrow({
    where: { id: input.taskId },
    include: { project: { select: { id: true, code: true, managerId: true, departmentId: true } } },
  });

  if (['COMPLETED', 'CANCELLED'].includes(task.status)) {
    throw new DomainError('Closed tasks cannot be handed over.');
  }
  if (input.toUserId === principal.userId) throw new DomainError('You cannot hand a task over to yourself.');

  const assignment = await prisma.taskAssignment.findFirst({
    where: { taskId: input.taskId, userId: principal.userId, status: 'ACTIVE' },
  });
  const isOverride = can(principal, 'pm.handover.override', {
    projectId: task.projectId,
    departmentId: task.project.departmentId,
  });
  if (!assignment && !isOverride) {
    throw new ForbiddenError('You can only hand over a task you currently hold.');
  }

  const target = await prisma.user.findFirst({
    where: { id: input.toUserId, companyId: principal.companyId, status: 'ACTIVE' },
    select: { id: true, fullName: true },
  });
  if (!target) throw new DomainError('That peer is not an active employee.');

  const alreadyHolds = await prisma.taskAssignment.findFirst({
    where: { taskId: input.taskId, userId: input.toUserId, status: 'ACTIVE' },
  });
  if (alreadyHolds) throw new DomainError(`${target.fullName} is already working on this task.`);

  const pending = await prisma.taskHandover.findFirst({
    where: { taskId: input.taskId, status: 'PENDING' },
  });
  if (pending) throw new DomainError('A handover on this task is already awaiting a decision.');

  const remainingPercent = Math.max(0, 100 - task.percentComplete);
  const allocated = assignment?.allocatedHours ?? task.estimatedHours;
  const remainingHours = Math.round(allocated * (remainingPercent / 100) * 10) / 10;

  const handover = await prisma.$transaction(async (tx) => {
    const created = await tx.taskHandover.create({
      data: {
        taskId: input.taskId,
        fromUserId: principal.userId,
        toUserId: input.toUserId,
        reason: input.reason,
        remainingPercent,
        remainingHours,
      },
    });

    await audit(
      {
        actorId: principal.userId,
        module: 'pm',
        action: 'handover.requested',
        entityType: 'Task',
        entityId: input.taskId,
        diff: { toUserId: input.toUserId, remainingPercent, remainingHours, reason: input.reason },
      },
      tx,
    );

    await publish(
      {
        name: EVENTS.HANDOVER_REQUESTED,
        module: 'pm',
        entityType: 'TaskHandover',
        entityId: created.id,
        actorId: principal.userId,
        payload: {
          taskId: input.taskId,
          projectId: task.projectId,
          fromUserId: principal.userId,
          toUserId: input.toUserId,
          remainingPercent,
        },
      },
      tx,
    );

    await notify(
      {
        userIds: [input.toUserId],
        title: `${principal.fullName} wants to hand you ${context.code}`,
        body: `${remainingPercent}% remaining (~${remainingHours}h). Reason: ${input.reason.slice(0, 160)}`,
        link: `/pm/handovers`,
      },
      tx,
    );

    await notify(
      {
        userIds: [task.project.managerId].filter((id) => id !== principal.userId),
        title: `Handover raised on ${context.code}`,
        body: `${principal.fullName} → ${target.fullName}: ${input.reason.slice(0, 160)}`,
        link: `/pm/tasks/${input.taskId}`,
      },
      tx,
    );

    return created;
  });

  return handover;
}

/**
 * Accept or reject. The receiver decides; a manager with override can decide on their
 * behalf when the receiver is unreachable and the work cannot wait.
 */
export async function decideHandover(
  principal: Principal,
  handoverId: string,
  decision: 'ACCEPTED' | 'REJECTED',
  note?: string,
) {
  const handover = await prisma.taskHandover.findUnique({
    where: { id: handoverId },
    include: {
      task: { include: { project: { select: { id: true, code: true, managerId: true, departmentId: true } } } },
      fromUser: { select: { id: true, fullName: true } },
      toUser: { select: { id: true, fullName: true } },
    },
  });
  if (!handover) throw new NotFoundError('Handover not found.');
  if (handover.status !== 'PENDING') throw new DomainError('This handover has already been decided.');

  const isReceiver = handover.toUserId === principal.userId;
  const canOverride = can(principal, 'pm.handover.override', {
    projectId: handover.task.projectId,
    departmentId: handover.task.project.departmentId,
  });
  const canDecide =
    (isReceiver && can(principal, 'pm.handover.decide', {
      projectId: handover.task.projectId,
      departmentId: handover.task.project.departmentId,
    })) ||
    isReceiver ||
    canOverride;
  if (!canDecide) throw new ForbiddenError('Only the receiving engineer or a manager can decide this handover.');

  return prisma.$transaction(async (tx) => {
    const updated = await tx.taskHandover.update({
      where: { id: handoverId },
      data: {
        status: decision,
        decidedById: principal.userId,
        decidedAt: new Date(),
        decisionNote: note,
      },
    });

    if (decision === 'ACCEPTED') {
      // The outgoing assignment is retired, not deleted: the hours already burned stay
      // attributed to the engineer who burned them.
      await tx.taskAssignment.updateMany({
        where: { taskId: handover.taskId, userId: handover.fromUserId, status: 'ACTIVE' },
        data: { status: 'HANDED_OVER', releasedAt: new Date() },
      });

      await tx.taskAssignment.create({
        data: {
          taskId: handover.taskId,
          userId: handover.toUserId,
          role: 'OWNER',
          allocatedHours: handover.remainingHours,
          assignedById: principal.userId,
        },
      });

      await tx.projectMember.upsert({
        where: { projectId_userId: { projectId: handover.task.projectId, userId: handover.toUserId } },
        create: { projectId: handover.task.projectId, userId: handover.toUserId, role: 'ENGINEER' },
        update: {},
      });

      await publish(
        {
          name: EVENTS.HANDOVER_ACCEPTED,
          module: 'pm',
          entityType: 'TaskHandover',
          entityId: handoverId,
          actorId: principal.userId,
          payload: {
            taskId: handover.taskId,
            projectId: handover.task.projectId,
            fromUserId: handover.fromUserId,
            toUserId: handover.toUserId,
            remainingHours: handover.remainingHours,
          },
        },
        tx,
      );

      await notify(
        {
          userIds: [handover.fromUserId, handover.task.project.managerId].filter((id) => id !== principal.userId),
          title: `Handover accepted on ${handover.task.code}`,
          body: `${handover.toUser.fullName} has taken over the remaining ${handover.remainingPercent}%.`,
          link: `/pm/tasks/${handover.taskId}`,
        },
        tx,
      );
    } else {
      await publish(
        {
          name: EVENTS.HANDOVER_REJECTED,
          module: 'pm',
          entityType: 'TaskHandover',
          entityId: handoverId,
          actorId: principal.userId,
          payload: { taskId: handover.taskId, fromUserId: handover.fromUserId, toUserId: handover.toUserId },
        },
        tx,
      );

      await notify(
        {
          userIds: [handover.fromUserId, handover.task.project.managerId],
          title: `Handover declined on ${handover.task.code}`,
          body: `${handover.toUser.fullName} declined. ${note ?? 'No reason given.'} The task stays with ${handover.fromUser.fullName}.`,
          link: `/pm/tasks/${handover.taskId}`,
        },
        tx,
      );
    }

    await audit(
      {
        actorId: principal.userId,
        module: 'pm',
        action: `handover.${decision.toLowerCase()}`,
        entityType: 'Task',
        entityId: handover.taskId,
        diff: { handoverId, decision, note: note ?? null, onBehalf: !isReceiver },
      },
      tx,
    );

    return updated;
  });
}

export async function cancelHandover(principal: Principal, handoverId: string) {
  const handover = await prisma.taskHandover.findUnique({ where: { id: handoverId } });
  if (!handover) throw new NotFoundError('Handover not found.');
  if (handover.status !== 'PENDING') throw new DomainError('Only a pending handover can be withdrawn.');
  if (handover.fromUserId !== principal.userId) throw new ForbiddenError('Only the requester can withdraw this.');

  await prisma.$transaction(async (tx) => {
    await tx.taskHandover.update({
      where: { id: handoverId },
      data: { status: 'CANCELLED', decidedById: principal.userId, decidedAt: new Date() },
    });
    await audit(
      {
        actorId: principal.userId,
        module: 'pm',
        action: 'handover.cancelled',
        entityType: 'Task',
        entityId: handover.taskId,
        diff: { handoverId },
      },
      tx,
    );
  });
}

/** The inbox: handovers waiting on me, plus the ones I raised. */
export async function listHandovers(principal: Principal) {
  const [incoming, outgoing, oversight] = await Promise.all([
    prisma.taskHandover.findMany({
      where: { toUserId: principal.userId, status: 'PENDING' },
      include: handoverInclude,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.taskHandover.findMany({
      where: { fromUserId: principal.userId },
      include: handoverInclude,
      orderBy: { createdAt: 'desc' },
      take: 25,
    }),
    prisma.taskHandover.findMany({
      where: {
        status: 'PENDING',
        toUserId: { not: principal.userId },
        fromUserId: { not: principal.userId },
        task: { project: { OR: [{ managerId: principal.userId }, { sponsorId: principal.userId }] } },
      },
      include: handoverInclude,
      orderBy: { createdAt: 'desc' },
      take: 25,
    }),
  ]);

  return { incoming, outgoing, oversight };
}

const handoverInclude = {
  task: {
    select: {
      id: true,
      code: true,
      title: true,
      status: true,
      priority: true,
      plannedEnd: true,
      percentComplete: true,
      project: { select: { id: true, code: true, name: true } },
    },
  },
  fromUser: { select: { id: true, fullName: true, avatarColor: true, designation: true } },
  toUser: { select: { id: true, fullName: true, avatarColor: true, designation: true } },
} as const;

export async function getTaskContextForHandover(taskId: string) {
  return loadTaskContext(taskId);
}
