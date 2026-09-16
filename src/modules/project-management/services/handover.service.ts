import { prisma } from '@/core/db/prisma';
import { can } from '@/core/rbac/engine';
import { DomainError, ForbiddenError, NotFoundError } from '@/core/rbac/errors';
import type { Principal } from '@/core/rbac/types';
import { audit } from '@/core/audit/audit';
import { publish } from '@/core/events/bus';
import { EVENTS } from '@/core/events/catalog';
import { notify } from '@/core/notifications/notify';
import { formatName } from '@/core/utils/strings';
import { assertTaskPermission, oversightRecipients } from './access';

/**
 * Reassign Request (Unified Request -> Accept flow for everyone).
 *
 * Replaces instant reassignment with a collaborative request workflow.
 * The task stays with the current owner until the receiving engineer accepts.
 */
export async function requestHandover(
  principal: Principal,
  input: { taskId: string; toUserId: string; reason: string },
) {
  await assertTaskPermission(principal, input.taskId, 'pm.handover.request');
  const task = await prisma.task.findUniqueOrThrow({
    where: { id: input.taskId },
    include: {
      project: { select: { id: true, code: true, name: true, managerId: true, departmentId: true } },
      assignments: { where: { status: 'ACTIVE' } },
    },
  });

  if (['COMPLETED', 'CANCELLED'].includes(task.status)) {
    throw new DomainError('Closed tasks cannot be reassigned.');
  }

  const isHolder = task.assignments.some((a) => a.userId === principal.userId);
  const isManager = task.project.managerId === principal.userId;
  const canManage =
    isManager ||
    can(principal, 'pm.progress.review', {
      projectId: task.projectId,
      departmentId: task.project.departmentId,
    }) ||
    can(principal, 'pm.task.cancel', {
      projectId: task.projectId,
      departmentId: task.project.departmentId,
    }) ||
    can(principal, 'pm.project.read.all');

  if (!isHolder && !canManage) {
    throw new ForbiddenError('You can only request reassignment for your own tasks or tasks in projects you manage.');
  }

  const ownerAssignment = task.assignments.find((a) => a.role === 'OWNER') ?? task.assignments[0];
  if (!ownerAssignment) {
    throw new DomainError('Cannot request reassignment on a task without an active owner.');
  }
  const fromUserId = ownerAssignment.userId;

  if (input.toUserId === fromUserId) {
    throw new DomainError('Task is already assigned to this engineer.');
  }

  // Step 4.2: Target must be an active engineer holding SENIOR_ENGINEER or JUNIOR_ENGINEER
  // and not PM_BASE, TECHNICAL_HEAD, DIRECTOR, SUPER_ADMIN, PROJECT_MANAGER
  const target = await prisma.user.findFirst({
    where: {
      id: input.toUserId,
      companyId: principal.companyId,
      status: 'ACTIVE',
      roleAssignments: {
        some: {
          role: { key: { in: ['SENIOR_ENGINEER', 'JUNIOR_ENGINEER'] } },
        },
      },
      NOT: {
        roleAssignments: {
          some: {
            role: { key: { in: ['PM_BASE', 'TECHNICAL_HEAD', 'DIRECTOR', 'SUPER_ADMIN', 'PROJECT_MANAGER'] } },
          },
        },
      },
    },
    select: { id: true, fullName: true },
  });
  if (!target) {
    throw new DomainError('Reassignment target must be an active engineering team member.');
  }

  const alreadyHolds = task.assignments.some((a) => a.userId === input.toUserId);
  if (alreadyHolds) {
    throw new DomainError(`${target.fullName} is already assigned to this task.`);
  }

  const pending = await prisma.taskHandover.findFirst({
    where: { taskId: input.taskId, status: 'PENDING' },
  });
  if (pending) {
    throw new DomainError('A reassign request is already awaiting a decision on this task.');
  }

  const remainingPercent = Math.max(0, 100 - task.percentComplete);
  const allocated = ownerAssignment.allocatedHours ?? task.estimatedHours;
  const remainingHours = Math.round(allocated * (remainingPercent / 100) * 10) / 10;

  return prisma.$transaction(async (tx) => {
    const created = await tx.taskHandover.create({
      data: {
        taskId: input.taskId,
        fromUserId,
        toUserId: input.toUserId,
        requestedById: principal.userId,
        reason: input.reason.trim(),
        remainingPercent,
        remainingHours,
        status: 'PENDING',
      },
    });

    await audit(
      {
        actorId: principal.userId,
        module: 'pm',
        action: 'task.reassign_requested',
        entityType: 'Task',
        entityId: input.taskId,
        diff: {
          fromUserId,
          toUserId: input.toUserId,
          requestedById: principal.userId,
          remainingPercent,
          remainingHours,
          reason: input.reason,
        },
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
          fromUserId,
          toUserId: input.toUserId,
          remainingPercent,
        },
      },
      tx,
    );

    // 1. Notify receiver (action required)
    await notify(
      {
        userIds: [input.toUserId],
        title: `Reassign request: ${task.title}`,
        body: `${formatName(principal.fullName)} requested to reassign "${task.title}" to you (${remainingPercent}% remaining). Action required: Accept or Decline.`,
        link: '/pm/handovers',
      },
      tx,
    );

    // 2. Notify current owner (if requester is someone else)
    if (fromUserId !== principal.userId) {
      await notify(
        {
          userIds: [fromUserId],
          title: `Reassign requested: ${task.title}`,
          body: `${formatName(principal.fullName)} requested to reassign "${task.title}" to ${formatName(target.fullName)}.`,
          link: `/pm/tasks/${input.taskId}`,
        },
        tx,
      );
    }

    // 3. Notify PM if requester is not PM
    if (task.project.managerId && task.project.managerId !== principal.userId && task.project.managerId !== fromUserId) {
      await notify(
        {
          userIds: [task.project.managerId],
          title: `Reassign requested: ${task.title}`,
          body: `${formatName(principal.fullName)} requested to reassign "${task.title}" to ${formatName(target.fullName)}.`,
          link: `/pm/tasks/${input.taskId}`,
        },
        tx,
      );
    }

    return created;
  });
}

/**
 * Accept or decline a reassign request.
 * Step 4.6: Strictly receiver only - nobody accepts on someone else's behalf.
 */
export async function decideHandover(
  principal: Principal,
  handoverId: string,
  decision: 'ACCEPTED' | 'DECLINED' | 'REJECTED',
  note?: string,
) {
  const normalizedDecision: 'ACCEPTED' | 'DECLINED' = decision === 'REJECTED' ? 'DECLINED' : decision;

  const handover = await prisma.taskHandover.findUnique({
    where: { id: handoverId },
    include: {
      task: { include: { project: { select: { id: true, code: true, name: true, managerId: true, departmentId: true } } } },
      fromUser: { select: { id: true, fullName: true } },
      toUser: { select: { id: true, fullName: true } },
      requestedBy: { select: { id: true, fullName: true } },
    },
  });
  if (!handover) throw new NotFoundError('Reassign request not found.');
  if (handover.status !== 'PENDING') throw new DomainError('This reassign request has already been decided.');

  // Step 4.6: Strictly the receiver
  if (handover.toUserId !== principal.userId) {
    throw new ForbiddenError('Only the assigned recipient can accept or decline this reassign request.');
  }

  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const updated = await tx.taskHandover.updateMany({
      where: { id: handoverId, status: 'PENDING' },
      data: {
        status: normalizedDecision,
        decidedById: principal.userId,
        decidedAt: now,
        decisionNote: note ?? null,
      },
    });
    if (updated.count === 0) {
      throw new DomainError('This reassign request has already been decided.');
    }

    const oversightIds = await oversightRecipients(principal.companyId, handover.task.project.departmentId, principal.userId);

    if (normalizedDecision === 'ACCEPTED') {
      // Release every active OWNER assignment on the task
      await tx.taskAssignment.updateMany({
        where: { taskId: handover.taskId, role: 'OWNER', status: 'ACTIVE' },
        data: { status: 'HANDED_OVER', releasedAt: now },
      });

      // Create new ACTIVE OWNER assignment for receiver
      await tx.taskAssignment.create({
        data: {
          taskId: handover.taskId,
          userId: handover.toUserId,
          role: 'OWNER',
          allocatedHours: handover.remainingHours,
          assignedById: handover.requestedById ?? principal.userId,
        },
      });

      // Add receiver as project member
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

      // Notify requester, previous owner, PM, and leadership
      const notifyUserIds = Array.from(
        new Set(
          [
            handover.requestedById,
            handover.fromUserId,
            handover.task.project.managerId,
            ...oversightIds,
          ].filter((uid): uid is string => Boolean(uid) && uid !== principal.userId),
        ),
      );

      if (notifyUserIds.length > 0) {
        await notify(
          {
            userIds: notifyUserIds,
            title: `Reassign accepted: ${handover.task.title}`,
            body: `${formatName(handover.toUser.fullName)} accepted and took over "${handover.task.title}".`,
            link: `/pm/tasks/${handover.taskId}`,
          },
          tx,
        );
      }
    } else {
      // DECLINED
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

      const notifyUserIds = Array.from(
        new Set(
          [handover.requestedById, handover.fromUserId, handover.task.project.managerId].filter(
            (uid): uid is string => Boolean(uid) && uid !== principal.userId,
          ),
        ),
      );

      if (notifyUserIds.length > 0) {
        await notify(
          {
            userIds: notifyUserIds,
            title: `Reassign declined: ${handover.task.title}`,
            body: `${formatName(handover.toUser.fullName)} declined reassignment of "${handover.task.title}". ${note ? `Reason: ${note}` : ''} The task stays with ${formatName(handover.fromUser.fullName)}.`,
            link: `/pm/tasks/${handover.taskId}`,
          },
          tx,
        );
      }
    }

    await audit(
      {
        actorId: principal.userId,
        module: 'pm',
        action: `task.reassign_${normalizedDecision.toLowerCase()}`,
        entityType: 'Task',
        entityId: handover.taskId,
        diff: { handoverId, decision: normalizedDecision, note: note ?? null },
      },
      tx,
    );

    return updated;
  });
}

/** Requester can withdraw a pending reassign request. */
export async function cancelHandover(principal: Principal, handoverId: string) {
  const handover = await prisma.taskHandover.findUnique({ where: { id: handoverId } });
  if (!handover) throw new NotFoundError('Reassign request not found.');
  if (handover.status !== 'PENDING') throw new DomainError('Only a pending request can be withdrawn.');

  const isRequester = handover.requestedById === principal.userId || handover.fromUserId === principal.userId;
  if (!isRequester) {
    throw new ForbiddenError('Only the requester can withdraw this reassign request.');
  }

  await prisma.$transaction(async (tx) => {
    await tx.taskHandover.update({
      where: { id: handoverId },
      data: { status: 'WITHDRAWN', decidedById: principal.userId, decidedAt: new Date() },
    });
    await audit(
      {
        actorId: principal.userId,
        module: 'pm',
        action: 'task.reassign_withdrawn',
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
  const isDirector = can(principal, 'pm.project.read.all');
  if (!isManager && !isDirector) {
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

  return prisma.$transaction(async (tx) => {
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
}

export async function decideProjectHandover(
  principal: Principal,
  handoverId: string,
  decision: 'ACCEPTED' | 'DECLINED' | 'REJECTED',
  note?: string,
) {
  const normalizedDecision: 'ACCEPTED' | 'DECLINED' = decision === 'REJECTED' ? 'DECLINED' : decision;

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

  // Only the assigned new manager can accept or decline
  if (handover.toUserId !== principal.userId) {
    throw new ForbiddenError('Only the assigned new manager can accept or decline this project handover.');
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.projectHandover.updateMany({
      where: { id: handoverId, status: 'PENDING' },
      data: {
        status: normalizedDecision,
        decidedById: principal.userId,
        decidedAt: new Date(),
        decisionNote: note ?? null,
      },
    });
    if (updated.count === 0) {
      throw new DomainError('This project handover has already been decided.');
    }

    if (normalizedDecision === 'ACCEPTED') {
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
        action: `project.handover.${normalizedDecision.toLowerCase()}`,
        entityType: 'Project',
        entityId: handover.projectId,
        diff: { handoverId, decision: normalizedDecision, note: note ?? null },
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
      data: { status: 'WITHDRAWN', decidedById: principal.userId, decidedAt: new Date() },
    });
    await audit(
      {
        actorId: principal.userId,
        module: 'pm',
        action: 'project.handover.withdrawn',
        entityType: 'Project',
        entityId: handover.projectId,
        diff: { handoverId },
      },
      tx,
    );
  });
}

/** The inbox: requests waiting on me, plus the ones I raised. */
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
      where: {
        OR: [
          { fromUserId: principal.userId },
          { requestedById: principal.userId },
        ],
      },
      include: handoverInclude,
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    prisma.taskHandover.findMany({
      where: {
        status: 'PENDING',
        toUserId: { not: principal.userId },
        fromUserId: { not: principal.userId },
        task: { project: { managerId: principal.userId } },
      },
      include: handoverInclude,
      orderBy: { createdAt: 'desc' },
      take: 50,
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
        project: { managerId: principal.userId },
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
  requestedBy: { select: { id: true, fullName: true, avatarColor: true, designation: true } },
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
