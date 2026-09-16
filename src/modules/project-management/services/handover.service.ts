import { prisma } from '@/core/db/prisma';
import { can } from '@/core/rbac/engine';
import { DomainError, ForbiddenError, NotFoundError } from '@/core/rbac/errors';
import type { Principal } from '@/core/rbac/types';
import { audit } from '@/core/audit/audit';
import { publish } from '@/core/events/bus';
import { EVENTS } from '@/core/events/catalog';
import { notify } from '@/core/notifications/notify';
import { formatName } from '@/core/utils/strings';
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
  await assertTaskPermission(principal, input.taskId, 'pm.handover.request');
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

  const ownerAssignment = assignment ?? (await prisma.taskAssignment.findFirst({
    where: { taskId: input.taskId, role: 'OWNER', status: 'ACTIVE' },
  }));
  if (!ownerAssignment) {
    throw new DomainError('Cannot request a handover on a task without an active owner.');
  }
  const fromUserId = ownerAssignment.userId;

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
  const allocated = ownerAssignment.allocatedHours ?? task.estimatedHours;
  const remainingHours = Math.round(allocated * (remainingPercent / 100) * 10) / 10;

  const handover = await prisma.$transaction(async (tx) => {
    const created = await tx.taskHandover.create({
      data: {
        taskId: input.taskId,
        fromUserId,
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
        title: `${formatName(principal.fullName)} wants to hand you ${task.title}`,
        body: `${remainingPercent}% remaining (~${remainingHours}h). Reason: ${input.reason.slice(0, 160)}`,
        link: `/pm/handovers`,
      },
      tx,
    );

    await notify(
      {
        userIds: [task.project.managerId].filter((id) => id !== principal.userId),
        title: `Handover raised on ${task.title}`,
        body: `${formatName(principal.fullName)} → ${formatName(target.fullName)}: ${input.reason.slice(0, 160)}`,
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
  const canDecide = isReceiver || canOverride;
  if (!canDecide) throw new ForbiddenError('Only the receiving engineer or a manager can decide this handover.');

  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const updated = await tx.taskHandover.updateMany({
      where: { id: handoverId, status: 'PENDING' },
      data: {
        status: decision,
        decidedById: principal.userId,
        decidedAt: now,
        decisionNote: note,
      },
    });
    if (updated.count === 0) {
      throw new DomainError('This handover has already been decided.');
    }

    if (decision === 'ACCEPTED') {
      // The outgoing assignment is retired, not deleted: the hours already burned stay
      // attributed to the engineer who burned them. Release all existing active OWNER assignments.
      await tx.taskAssignment.updateMany({
        where: { taskId: handover.taskId, role: 'OWNER', status: 'ACTIVE' },
        data: { status: 'HANDED_OVER', releasedAt: now },
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
          title: `Handover accepted: ${handover.task.title}`,
          body: `${formatName(handover.toUser.fullName)} has taken over the remaining ${handover.remainingPercent}% of "${handover.task.title}".`,
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
          title: `Handover declined: ${handover.task.title}`,
          body: `${formatName(handover.toUser.fullName)} declined. ${note ?? 'No reason given.'} The task stays with ${formatName(handover.fromUser.fullName)}.`,
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

// =====================================================================================
// PROJECT HANDOVER (Two-way consent between Project Managers)
// =====================================================================================

export async function requestProjectHandover(
  principal: Principal,
  input: { projectId: string; toUserId: string; reason?: string },
) {
  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: { id: true, code: true, name: true, managerId: true, departmentId: true },
  });
  if (!project) throw new NotFoundError('Project not found.');

  const isManager = project.managerId === principal.userId;
  const isOverride =
    can(principal, 'pm.handover.override', {
      projectId: project.id,
      departmentId: project.departmentId,
    }) ||
    can(principal, 'pm.project.update', {
      projectId: project.id,
      departmentId: project.departmentId,
    });

  if (!isManager && !isOverride) {
    throw new ForbiddenError('You can only hand over a project you currently manage.');
  }

  if (input.toUserId === principal.userId) {
    throw new DomainError('You cannot hand over a project to yourself.');
  }
  if (input.toUserId === project.managerId) {
    throw new DomainError('That colleague is already managing this project.');
  }

  const target = await prisma.user.findFirst({
    where: { id: input.toUserId, companyId: principal.companyId, status: 'ACTIVE' },
    select: { id: true, fullName: true },
  });
  if (!target) throw new DomainError('Selected colleague is not an active employee.');

  const pending = await prisma.projectHandover.findFirst({
    where: { projectId: input.projectId, status: 'PENDING' },
  });
  if (pending) {
    throw new DomainError('A handover request for this project is already awaiting a decision.');
  }

  const handover = await prisma.$transaction(async (tx) => {
    const created = await tx.projectHandover.create({
      data: {
        projectId: input.projectId,
        fromUserId: project.managerId,
        toUserId: input.toUserId,
        reason: input.reason?.trim() || null,
        status: 'PENDING',
      },
    });

    await audit(
      {
        actorId: principal.userId,
        module: 'pm',
        action: 'project.handover.requested',
        entityType: 'Project',
        entityId: input.projectId,
        diff: { fromUserId: project.managerId, toUserId: input.toUserId, reason: input.reason },
      },
      tx,
    );

    await notify(
      {
        userIds: [input.toUserId],
        title: `${formatName(principal.fullName)} wants to hand over ${project.name}`,
        body: `Project handover requested. ${input.reason ? `Reason: ${input.reason}` : 'Please review and accept or decline.'}`,
        link: '/pm/handovers',
      },
      tx,
    );

    return created;
  });

  return handover;
}

export async function decideProjectHandover(
  principal: Principal,
  handoverId: string,
  decision: 'ACCEPTED' | 'REJECTED',
  note?: string,
) {
  const handover = await prisma.projectHandover.findUnique({
    where: { id: handoverId },
    include: {
      project: { select: { id: true, code: true, name: true, managerId: true, departmentId: true } },
      fromUser: { select: { id: true, fullName: true } },
      toUser: { select: { id: true, fullName: true } },
    },
  });
  if (!handover) throw new NotFoundError('Project handover request not found.');
  if (handover.status !== 'PENDING') throw new DomainError('This handover request has already been decided.');

  const isReceiver = handover.toUserId === principal.userId;
  const canOverride = can(principal, 'pm.handover.override', {
    projectId: handover.project.id,
    departmentId: handover.project.departmentId,
  });

  if (!isReceiver && !canOverride) {
    throw new ForbiddenError('Only the assigned new manager can accept or decline this project handover.');
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.projectHandover.updateMany({
      where: { id: handoverId, status: 'PENDING' },
      data: {
        status: decision,
        decidedById: principal.userId,
        decidedAt: new Date(),
        decisionNote: note ?? null,
      },
    });
    if (updated.count === 0) {
      throw new DomainError('This project handover has already been decided.');
    }

    if (decision === 'ACCEPTED') {
      // 1. Update project managerId
      await tx.project.update({
        where: { id: handover.projectId },
        data: { managerId: handover.toUserId },
      });

      // 2. Upsert project member
      await tx.projectMember.upsert({
        where: { projectId_userId: { projectId: handover.projectId, userId: handover.toUserId } },
        create: { projectId: handover.projectId, userId: handover.toUserId, role: 'MANAGER', allocationPercent: 100 },
        update: { role: 'MANAGER' },
      });

      // 3. Grant RBAC Role to new manager
      const managerRole = await tx.role.findUnique({ where: { key: 'PROJECT_MANAGER' } });
      if (managerRole) {
        await tx.roleAssignment.upsert({
          where: {
            userId_roleId_scopeType_scopeId: {
              userId: handover.toUserId,
              roleId: managerRole.id,
              scopeType: 'PROJECT',
              scopeId: handover.projectId,
            },
          },
          create: {
            userId: handover.toUserId,
            roleId: managerRole.id,
            scopeType: 'PROJECT',
            scopeId: handover.projectId,
            grantedBy: principal.userId,
          },
          update: {},
        });

        // 4. Revoke old manager's RBAC role
        await tx.roleAssignment.deleteMany({
          where: {
            userId: handover.fromUserId,
            roleId: managerRole.id,
            scopeType: 'PROJECT',
            scopeId: handover.projectId,
          },
        });
      }

      // 5. Update old manager member role
      await tx.projectMember.updateMany({
        where: { projectId: handover.projectId, userId: handover.fromUserId, role: 'MANAGER' },
        data: { role: 'OBSERVER' },
      });

      // 6. Bulk reassign open task assignments from old PM to new PM
      const openAssignments = await tx.taskAssignment.findMany({
        where: {
          userId: handover.fromUserId,
          status: 'ACTIVE',
          task: { projectId: handover.projectId, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
        },
        select: { id: true, taskId: true },
      });

      if (openAssignments.length > 0) {
        await tx.taskAssignment.updateMany({
          where: { id: { in: openAssignments.map((a) => a.id) } },
          data: { userId: handover.toUserId },
        });

        for (const a of openAssignments) {
          await audit(
            {
              actorId: principal.userId,
              module: 'pm',
              action: 'task.reassigned',
              entityType: 'Task',
              entityId: a.taskId,
              diff: { assigneeId: { old: handover.fromUserId, new: handover.toUserId }, bulkHandover: true },
            },
            tx,
          );
        }
      }

      await notify(
        {
          userIds: [handover.fromUserId],
          title: `Project handover accepted: ${handover.project.name}`,
          body: `${formatName(handover.toUser.fullName)} has accepted the handover and is now the Project Manager.`,
          link: `/pm/projects/${handover.projectId}`,
        },
        tx,
      );
    } else {
      await notify(
        {
          userIds: [handover.fromUserId],
          title: `Project handover declined: ${handover.project.name}`,
          body: `${formatName(handover.toUser.fullName)} declined the handover. ${note ? `Reason: ${note}` : ''}`,
          link: `/pm/projects/${handover.projectId}`,
        },
        tx,
      );
    }

    await audit(
      {
        actorId: principal.userId,
        module: 'pm',
        action: `project.handover.${decision.toLowerCase()}`,
        entityType: 'Project',
        entityId: handover.projectId,
        diff: { handoverId, decision, note: note ?? null },
      },
      tx,
    );

    return updated;
  });
}

export async function cancelProjectHandover(principal: Principal, handoverId: string) {
  const handover = await prisma.projectHandover.findUnique({ where: { id: handoverId } });
  if (!handover) throw new NotFoundError('Project handover not found.');
  if (handover.status !== 'PENDING') throw new DomainError('Only a pending project handover can be withdrawn.');
  if (handover.fromUserId !== principal.userId) throw new ForbiddenError('Only the requester can withdraw this.');

  await prisma.$transaction(async (tx) => {
    await tx.projectHandover.update({
      where: { id: handoverId },
      data: { status: 'CANCELLED', decidedById: principal.userId, decidedAt: new Date() },
    });
    await audit(
      {
        actorId: principal.userId,
        module: 'pm',
        action: 'project.handover.cancelled',
        entityType: 'Project',
        entityId: handover.projectId,
        diff: { handoverId },
      },
      tx,
    );
  });
}

/** The inbox: handovers waiting on me, plus the ones I raised. */
export async function listHandovers(principal: Principal) {
  const [
    incoming,
    outgoing,
    oversight,
    incomingProjects,
    outgoingProjects,
    oversightProjects,
  ] = await Promise.all([
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
    prisma.projectHandover.findMany({
      where: { toUserId: principal.userId, status: 'PENDING' },
      include: projectHandoverInclude,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.projectHandover.findMany({
      where: { fromUserId: principal.userId },
      include: projectHandoverInclude,
      orderBy: { createdAt: 'desc' },
      take: 25,
    }),
    prisma.projectHandover.findMany({
      where: {
        status: 'PENDING',
        toUserId: { not: principal.userId },
        fromUserId: { not: principal.userId },
        project: { sponsorId: principal.userId },
      },
      include: projectHandoverInclude,
      orderBy: { createdAt: 'desc' },
      take: 25,
    }),
  ]);

  return {
    incoming,
    outgoing,
    oversight,
    incomingProjects,
    outgoingProjects,
    oversightProjects,
  };
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

const projectHandoverInclude = {
  project: {
    select: {
      id: true,
      code: true,
      name: true,
      status: true,
      priority: true,
      targetEndDate: true,
      clientName: true,
    },
  },
  fromUser: { select: { id: true, fullName: true, avatarColor: true, designation: true } },
  toUser: { select: { id: true, fullName: true, avatarColor: true, designation: true } },
} as const;

export async function getTaskContextForHandover(taskId: string) {
  return loadTaskContext(taskId);
}

