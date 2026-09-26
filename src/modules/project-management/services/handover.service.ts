import { prisma } from '@/core/db/prisma';
import type { Prisma } from '@prisma/client';
import { can, hasPermissionAnywhere } from '@/core/rbac/engine';
import { DomainError, ForbiddenError, NotFoundError } from '@/core/rbac/errors';
import type { Principal } from '@/core/rbac/types';
import { audit } from '@/core/audit/audit';
import { publish } from '@/core/events/bus';
import { EVENTS } from '@/core/events/catalog';
import { notify } from '@/core/notifications/notify';
import { formatName } from '@/core/utils/strings';
import { assertTaskPermission, getOrgPeople, OUTSIDE_TEAM_MESSAGE, oversightRecipients, projectManagerPool, projectVisibilityWhere, reassignTeamFor } from './access';
import { teamRootOf } from '../domain/teams';
import { isExecutionStaff } from '../domain/availability';

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

  // Step 4.2: Target must be an active engineer or in projectManagerPool
  const pool = await projectManagerPool(principal.companyId);
  const isPoolMember = pool.some((p) => p.id === input.toUserId);

  let target: { id: string; fullName: string } | null = null;
  if (isPoolMember) {
    const p = pool.find((pm) => pm.id === input.toUserId)!;
    target = { id: p.id, fullName: p.fullName };
  } else {
    target = await prisma.user.findFirst({
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
              role: { key: { in: ['PM_BASE', 'TECHNICAL_HEAD', 'SERVICE_HEAD', 'DIRECTOR', 'SUPER_ADMIN', 'PROJECT_MANAGER', 'ASST_MANAGER'] } },
            },
          },
        },
      },
      select: { id: true, fullName: true },
    });
  }
  if (!target) {
    throw new DomainError('Reassignment target must be an active engineering team member.');
  }
  const team = await reassignTeamFor(principal);
  if (team && !team.has(target.id)) {
    if (!canManage) {
      throw new DomainError('Engineers cannot hand over tasks outside their squad.');
    }
  }

  const alreadyHolds = task.assignments.some((a) => a.userId === input.toUserId);
  if (alreadyHolds) {
    throw new DomainError(`${target.fullName} is already assigned to this task.`);
  }

  const pending = await prisma.taskHandover.findFirst({
    where: { taskId: input.taskId, status: { in: ['PENDING', 'AWAITING_HEAD_APPROVAL'] } },
  });
  if (pending) {
    throw new DomainError('A reassign request is already awaiting a decision on this task.');
  }

  const remainingPercent = Math.max(0, 100 - task.percentComplete);
  const allocated = ownerAssignment.allocatedHours ?? task.estimatedHours;
  const remainingHours = Math.round(allocated * (remainingPercent / 100) * 10) / 10;

  const people = await getOrgPeople(principal.companyId);
  const toSquadLeadId = teamRootOf(input.toUserId, people);
  const fromSquadLeadId = teamRootOf(fromUserId, people);
  const isCross = toSquadLeadId !== fromSquadLeadId;
  const isManagerOrLead = !isExecutionStaff(principal) || canManage;
  const hasOversight = hasPermissionAnywhere(principal, 'pm.oversight');
  const isDirectMove = hasOversight || (isManagerOrLead && !isCross);

  if (isCross && isExecutionStaff(principal)) {
    throw new DomainError('Engineers cannot hand over tasks outside their squad.');
  }

  return prisma.$transaction(async (tx) => {
    if (isDirectMove) {
      // Direct assignment by Director, Head, or PM: moves work immediately, no request menu items
      await tx.taskAssignment.updateMany({
        where: { taskId: input.taskId, status: 'ACTIVE', role: 'OWNER' },
        data: { status: 'RELEASED', releasedAt: new Date() },
      });

      const newAssignment = await tx.taskAssignment.create({
        data: {
          taskId: input.taskId,
          userId: input.toUserId,
          role: 'OWNER',
          status: 'ACTIVE',
          allocatedHours: remainingHours,
          assignedById: principal.userId,
        },
      });

      // Ensure target is a member of the project
      await tx.projectMember.upsert({
        where: { projectId_userId: { projectId: task.projectId, userId: input.toUserId } },
        create: { projectId: task.projectId, userId: input.toUserId, role: 'ENGINEER' },
        update: {},
      });

      await audit(
        {
          actorId: principal.userId,
          module: 'pm',
          action: 'task.reassigned',
          entityType: 'Task',
          entityId: input.taskId,
          diff: {
            fromUserId,
            toUserId: input.toUserId,
            requestedById: principal.userId,
            remainingPercent,
            remainingHours,
            reason: input.reason,
            direct: true,
          },
        },
        tx,
      );

      // Notification directly to the receiving engineer
      await notify(
        {
          userIds: [input.toUserId],
          title: `Task assigned: ${task.title}`,
          body: `${formatName(principal.fullName)} handed over "${task.title}" to you. Reason: ${input.reason.trim()}`,
          link: `/pm/tasks/${input.taskId}`,
        },
        tx,
      );

      // Notify previous owner
      if (fromUserId !== principal.userId) {
        await notify(
          {
            userIds: [fromUserId],
            title: `Task reassigned: ${task.title}`,
            body: `${formatName(principal.fullName)} reassigned "${task.title}" to ${formatName(target.fullName)}.`,
            link: `/pm/tasks/${input.taskId}`,
          },
          tx,
        );
      }

      // Notify PM if requester is not PM
      if (task.project.managerId && task.project.managerId !== principal.userId && task.project.managerId !== fromUserId) {
        await notify(
          {
            userIds: [task.project.managerId],
            title: `Task reassigned: ${task.title}`,
            body: `${formatName(principal.fullName)} reassigned "${task.title}" to ${formatName(target.fullName)}.`,
            link: `/pm/tasks/${input.taskId}`,
          },
          tx,
        );
      }

      return newAssignment;
    }

    const status = isManagerOrLead ? 'AWAITING_HEAD_APPROVAL' : 'PENDING';
    const created = await tx.taskHandover.create({
      data: {
        taskId: input.taskId,
        fromUserId,
        toUserId: input.toUserId,
        requestedById: principal.userId,
        reason: input.reason.trim(),
        remainingPercent,
        remainingHours,
        status,
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
          crossSquad: isCross,
          status,
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

    if (isManagerOrLead) {
      // Cross-team handover by PM / Asst PM: notify Technical Heads + Directors
      const oversightIds = await oversightRecipients(principal.companyId, task.project.departmentId, principal.userId);
      if (oversightIds.length > 0) {
        await notify(
          {
            userIds: oversightIds,
            title: `Cross-team handover requested: ${task.title}`,
            body: `${formatName(principal.fullName)} requested to reassign "${task.title}" to ${formatName(target.fullName)}. Head approval required.`,
            link: '/pm/approvals',
          },
          tx,
        );
      }
    } else if (isCross) {
      // Cross-squad: PM2 (receiving squad lead) approval is required
      if (toSquadLeadId && toSquadLeadId !== principal.userId) {
        await notify(
          {
            userIds: [toSquadLeadId],
            title: `Cross-squad handover request: ${task.title}`,
            body: `${formatName(principal.fullName)} requested to reassign "${task.title}" to ${formatName(target.fullName)} in your squad. Approval required.`,
            link: '/pm/handovers',
          },
          tx,
        );
      }
      const oversightIds = await oversightRecipients(principal.companyId, task.project.departmentId, principal.userId);
      if (oversightIds.length > 0) {
        await notify(
          {
            userIds: oversightIds,
            title: `Cross-squad handover requested: ${task.title}`,
            body: `${formatName(principal.fullName)} requested to reassign "${task.title}" across squads to ${formatName(target.fullName)}.`,
            link: '/pm/approvals',
          },
          tx,
        );
      }
    } else {
      // Intra-squad: notify receiver (action required)
      await notify(
        {
          userIds: [input.toUserId],
          title: `Reassign request: ${task.title}`,
          body: `${formatName(principal.fullName)} requested to reassign "${task.title}" to you (${remainingPercent}% remaining). Action required: Accept or Decline.`,
          link: '/pm/handovers',
        },
        tx,
      );
    }

    // Notify current owner (if requester is someone else)
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

    // Notify PM if requester is not PM
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
      fromUser: { select: { id: true, fullName: true, avatarColor: true } },
      toUser: { select: { id: true, fullName: true, avatarColor: true } },
      requestedBy: { select: { id: true, fullName: true, avatarColor: true } },
    },
  });
  if (!handover) throw new NotFoundError('Reassign request not found.');
  if (handover.status !== 'PENDING' && handover.status !== 'AWAITING_HEAD_APPROVAL') {
    throw new DomainError('This reassign request has already been decided.');
  }

  const people = await getOrgPeople(principal.companyId);
  const fromSquadRoot = teamRootOf(handover.fromUserId, people);
  const reqSquadRoot = handover.requestedById ? teamRootOf(handover.requestedById, people) : fromSquadRoot;
  const toSquadRoot = teamRootOf(handover.toUserId, people);
  const isCrossSquad = fromSquadRoot !== toSquadRoot || reqSquadRoot !== toSquadRoot;

  const isDirector = can(principal, 'pm.project.read.all');
  const isHead = hasPermissionAnywhere(principal, 'pm.oversight');
  const isReceiver = handover.toUserId === principal.userId;
  const isPM2 = principal.userId === toSquadRoot;
  const isProjectManager = handover.task.project.managerId === principal.userId;

  const now = new Date();
  const oversightIds = await oversightRecipients(principal.companyId, handover.task.project.departmentId, principal.userId);

  // -------------------------------------------------------------------------
  // SAME-SQUAD HANDOVER (Intra-squad peer request-and-accept)
  // -------------------------------------------------------------------------
  if (!isCrossSquad) {
    if (!isReceiver && !isDirector && !isProjectManager) {
      throw new ForbiddenError('Only the assigned recipient, project manager, or a director can accept or decline this reassign request.');
    }

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

      if (normalizedDecision === 'ACCEPTED') {
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
            assignedById: handover.requestedById ?? principal.userId,
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

  // -------------------------------------------------------------------------
  // CROSS-SQUAD HANDOVER (Two-stage approval)
  // -------------------------------------------------------------------------
  if (handover.status === 'PENDING') {
    // STAGE 1: Receiving squad lead (PM2), Head, or Director
    if (!isPM2 && !isHead && !isDirector) {
      throw new ForbiddenError('Only the receiving squad lead or leadership can decide this stage.');
    }

    if (normalizedDecision === 'DECLINED') {
      return prisma.$transaction(async (tx) => {
        const updated = await tx.taskHandover.updateMany({
          where: { id: handoverId, status: 'PENDING' },
          data: {
            status: 'DECLINED',
            decidedById: principal.userId,
            decidedAt: now,
            decisionNote: note ?? null,
          },
        });
        if (updated.count === 0) throw new DomainError('This handover request has already been decided.');

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
              title: `Cross-squad handover declined: ${handover.task.title}`,
              body: `${formatName(principal.fullName)} declined the cross-squad handover. ${note ? `Reason: ${note}` : ''} The task stays with ${formatName(handover.fromUser.fullName)}.`,
              link: `/pm/tasks/${handover.taskId}`,
            },
            tx,
          );
        }

        await audit(
          {
            actorId: principal.userId,
            module: 'pm',
            action: 'task.reassign_declined',
            entityType: 'Task',
            entityId: handover.taskId,
            diff: { handoverId, stage: 1, decision: 'DECLINED', note: note ?? null },
          },
          tx,
        );

        return updated;
      });
    }

    // Stage 1 ACCEPTED
    // A Director may approve either stage outright
    if (isDirector) {
      return prisma.$transaction(async (tx) => {
        const updated = await tx.taskHandover.updateMany({
          where: { id: handoverId, status: 'PENDING' },
          data: {
            status: 'ACCEPTED',
            decidedById: principal.userId,
            decidedAt: now,
            decisionNote: note ?? null,
            headApprovedById: principal.userId,
            headApprovedAt: now,
            headDecisionNote: note ?? 'Director approved outright',
          },
        });
        if (updated.count === 0) throw new DomainError('This handover request has already been decided.');

        // Work moves!
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
            assignedById: handover.requestedById ?? principal.userId,
          },
        });

        // Add receiving engineer as project member on that project only
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

        const notifyUserIds = Array.from(
          new Set(
            [
              handover.requestedById,
              handover.fromUserId,
              handover.toUserId,
              toSquadRoot,
              handover.task.project.managerId,
              ...oversightIds,
            ].filter((uid): uid is string => Boolean(uid) && uid !== principal.userId),
          ),
        );

        if (notifyUserIds.length > 0) {
          await notify(
            {
              userIds: notifyUserIds,
              title: `Cross-squad handover approved: ${handover.task.title}`,
              body: `${formatName(principal.fullName)} approved cross-squad handover of "${handover.task.title}" to ${formatName(handover.toUser.fullName)}.`,
              link: `/pm/tasks/${handover.taskId}`,
            },
            tx,
          );
        }

        await audit(
          {
            actorId: principal.userId,
            module: 'pm',
            action: 'task.reassign_accepted',
            entityType: 'Task',
            entityId: handover.taskId,
            diff: { handoverId, decision: 'ACCEPTED', outright: true, note: note ?? null },
          },
          tx,
        );

        return updated;
      });
    }

    // PM2 (or non-Director head) approves Stage 1 -> moves to AWAITING_HEAD_APPROVAL
    // Work does NOT move!
    return prisma.$transaction(async (tx) => {
      const updated = await tx.taskHandover.updateMany({
        where: { id: handoverId, status: 'PENDING' },
        data: {
          status: 'AWAITING_HEAD_APPROVAL',
          decidedById: principal.userId,
          decidedAt: now,
          decisionNote: note ?? null,
        },
      });
      if (updated.count === 0) throw new DomainError('This handover request has already been decided.');

      // Notify Heads & Director that head approval is required
      const leadershipIds = Array.from(
        new Set([...oversightIds].filter((uid) => uid !== principal.userId)),
      );

      if (leadershipIds.length > 0) {
        await notify(
          {
            userIds: leadershipIds,
            title: `Head approval required: ${handover.task.title}`,
            body: `${formatName(principal.fullName)} approved cross-squad handover of "${handover.task.title}" to ${formatName(handover.toUser.fullName)}. Head sign-off required.`,
            link: '/pm/approvals',
          },
          tx,
        );
      }

      await audit(
        {
          actorId: principal.userId,
          module: 'pm',
          action: 'task.reassign_stage1_approved',
          entityType: 'Task',
          entityId: handover.taskId,
          diff: { handoverId, stage: 1, decision: 'ACCEPTED', note: note ?? null },
        },
        tx,
      );

      return updated;
    });
  }

  // STAGE 2: Status is AWAITING_HEAD_APPROVAL
  if (!isHead && !isDirector) {
    throw new ForbiddenError('Only Technical Head, Service Head, or Director can give final approval.');
  }

  // Self-approval guard: stage 2 approver must not be the same user who approved stage 1 (unless Director)
  if (handover.decidedById === principal.userId && !isDirector) {
    throw new DomainError('Stage 2 approval must be given by a different person than Stage 1.');
  }

  if (normalizedDecision === 'DECLINED') {
    return prisma.$transaction(async (tx) => {
      const updated = await tx.taskHandover.updateMany({
        where: { id: handoverId, status: 'AWAITING_HEAD_APPROVAL' },
        data: {
          status: 'DECLINED',
          headApprovedById: principal.userId,
          headApprovedAt: now,
          headDecisionNote: note ?? null,
        },
      });
      if (updated.count === 0) throw new DomainError('This handover request has already been decided.');

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
          [handover.requestedById, handover.fromUserId, toSquadRoot, handover.task.project.managerId].filter(
            (uid): uid is string => Boolean(uid) && uid !== principal.userId,
          ),
        ),
      );

      if (notifyUserIds.length > 0) {
        await notify(
          {
            userIds: notifyUserIds,
            title: `Cross-squad handover declined by leadership: ${handover.task.title}`,
            body: `${formatName(principal.fullName)} declined the cross-squad handover. ${note ? `Reason: ${note}` : ''} The task stays with ${formatName(handover.fromUser.fullName)}.`,
            link: `/pm/tasks/${handover.taskId}`,
          },
          tx,
        );
      }

      await audit(
        {
          actorId: principal.userId,
          module: 'pm',
          action: 'task.reassign_head_declined',
          entityType: 'Task',
          entityId: handover.taskId,
          diff: { handoverId, stage: 2, decision: 'DECLINED', note: note ?? null },
        },
        tx,
      );

      return updated;
    });
  }

  // Stage 2 ACCEPTED: Work moves here, and only here!
  return prisma.$transaction(async (tx) => {
    const updated = await tx.taskHandover.updateMany({
      where: { id: handoverId, status: 'AWAITING_HEAD_APPROVAL' },
      data: {
        status: 'ACCEPTED',
        headApprovedById: principal.userId,
        headApprovedAt: now,
        headDecisionNote: note ?? null,
      },
    });
    if (updated.count === 0) throw new DomainError('This handover request has already been decided.');

    // Release old active owner
    await tx.taskAssignment.updateMany({
      where: { taskId: handover.taskId, role: 'OWNER', status: 'ACTIVE' },
      data: { status: 'HANDED_OVER', releasedAt: now },
    });

    // Create new active owner
    await tx.taskAssignment.create({
      data: {
        taskId: handover.taskId,
        userId: handover.toUserId,
        role: 'OWNER',
        allocatedHours: handover.remainingHours,
        assignedById: handover.requestedById ?? principal.userId,
      },
    });

    // Add receiving engineer as project member on that project only
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

    // Notify PM1, PM2, and both engineers
    const notifyUserIds = Array.from(
      new Set(
        [
          handover.requestedById,
          handover.fromUserId,
          handover.toUserId,
          toSquadRoot,
          handover.task.project.managerId,
          ...oversightIds,
        ].filter((uid): uid is string => Boolean(uid) && uid !== principal.userId),
      ),
    );

    if (notifyUserIds.length > 0) {
      await notify(
        {
          userIds: notifyUserIds,
          title: `Cross-squad handover approved: ${handover.task.title}`,
          body: `${formatName(principal.fullName)} gave final approval for "${handover.task.title}" to be handed over to ${formatName(handover.toUser.fullName)}.`,
          link: `/pm/tasks/${handover.taskId}`,
        },
        tx,
      );
    }

    await audit(
      {
        actorId: principal.userId,
        module: 'pm',
        action: 'task.reassign_accepted',
        entityType: 'Task',
        entityId: handover.taskId,
        diff: { handoverId, stage: 2, decision: 'ACCEPTED', note: note ?? null },
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
  if (handover.status !== 'PENDING' && handover.status !== 'AWAITING_HEAD_APPROVAL') {
    throw new DomainError('Only a pending request can be withdrawn.');
  }

  const isRequester = handover.requestedById === principal.userId || handover.fromUserId === principal.userId;
  const isDirector = can(principal, 'pm.project.read.all');
  if (!isRequester && !isDirector) {
    throw new ForbiddenError('Only the requester or a director can withdraw this reassign request.');
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

  // Role Gate: Engineers cannot hand over projects
  const isManager = project.managerId === principal.userId;
  const isDirector = can(principal, 'pm.project.read.all');
  const isHead = hasPermissionAnywhere(principal, 'pm.oversight');
  const canManage = can(principal, 'pm.project.update', { projectId: project.id, departmentId: project.departmentId });

  if ((!isManager && !isDirector && !isHead && !canManage) || isExecutionStaff(principal)) {
    throw new ForbiddenError('Engineers cannot hand over projects.');
  }

  if (input.toUserId === principal.userId) {
    throw new DomainError('You cannot hand over a project to yourself.');
  }
  if (input.toUserId === project.managerId) {
    throw new DomainError('That colleague is already managing this project.');
  }

  const target = await prisma.user.findFirst({
    where: {
      id: input.toUserId,
      companyId: principal.companyId,
      status: 'ACTIVE',
      roleAssignments: {
        some: {
          role: { key: { in: ['PROJECT_MANAGER', 'ASST_MANAGER', 'PM_BASE', 'TECHNICAL_HEAD', 'SERVICE_HEAD', 'DIRECTOR'] } },
        },
      },
    },
    select: { id: true, fullName: true },
  });
  if (!target) throw new DomainError('Selected colleague is not eligible to manage projects.');

  const pending = await prisma.projectHandover.findFirst({
    where: { projectId: input.projectId, status: { in: ['PENDING', 'AWAITING_HEAD_APPROVAL'] } },
  });
  if (pending) {
    throw new DomainError('A handover request for this project is already awaiting a decision.');
  }

  const people = await getOrgPeople(principal.companyId);
  const fromSquadRoot = teamRootOf(project.managerId, people);
  const toSquadRoot = teamRootOf(input.toUserId, people);
  const isCross = fromSquadRoot !== toSquadRoot;

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
        diff: { fromUserId: project.managerId, toUserId: input.toUserId, reason: input.reason, crossSquad: isCross },
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

    if (isCross) {
      const oversightIds = await oversightRecipients(principal.companyId, project.departmentId, principal.userId);
      if (oversightIds.length > 0) {
        await notify(
          {
            userIds: oversightIds,
            title: `Cross-squad project handover requested: ${project.name}`,
            body: `${formatName(principal.fullName)} requested to transfer "${project.name}" to ${formatName(target.fullName)}.`,
            link: '/pm/approvals',
          },
          tx,
        );
      }
    }

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
  if (handover.status !== 'PENDING' && handover.status !== 'AWAITING_HEAD_APPROVAL') {
    throw new DomainError('This handover request has already been decided.');
  }

  const people = await getOrgPeople(principal.companyId);
  const fromSquadRoot = teamRootOf(handover.fromUserId, people);
  const toSquadRoot = teamRootOf(handover.toUserId, people);
  const isCrossSquad = fromSquadRoot !== toSquadRoot;

  const isReceiver = handover.toUserId === principal.userId;
  const isDirector = can(principal, 'pm.project.read.all');
  const isHead = hasPermissionAnywhere(principal, 'pm.oversight');
  const now = new Date();
  const oversightIds = await oversightRecipients(principal.companyId, handover.project.departmentId, principal.userId);

  // Helper to execute actual project transfer in transaction
  async function transferProjectInTx(tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) {
    // 1. Update project managerId
    await tx.project.update({
      where: { id: handover!.projectId },
      data: { managerId: handover!.toUserId },
    });

    // 2. Upsert project member
    await tx.projectMember.upsert({
      where: { projectId_userId: { projectId: handover!.projectId, userId: handover!.toUserId } },
      create: { projectId: handover!.projectId, userId: handover!.toUserId, role: 'MANAGER', allocationPercent: 100 },
      update: { role: 'MANAGER' },
    });

    // 3. Grant RBAC Role to new manager
    const managerRole = await tx.role.findUnique({ where: { key: 'PROJECT_MANAGER' } });
    if (managerRole) {
      await tx.roleAssignment.upsert({
        where: {
          userId_roleId_scopeType_scopeId: {
            userId: handover!.toUserId,
            roleId: managerRole.id,
            scopeType: 'PROJECT',
            scopeId: handover!.projectId,
          },
        },
        create: {
          userId: handover!.toUserId,
          roleId: managerRole.id,
          scopeType: 'PROJECT',
          scopeId: handover!.projectId,
          grantedBy: principal.userId,
        },
        update: {},
      });

      // 4. Revoke old manager's RBAC role
      await tx.roleAssignment.deleteMany({
        where: {
          userId: handover!.fromUserId,
          roleId: managerRole.id,
          scopeType: 'PROJECT',
          scopeId: handover!.projectId,
        },
      });
    }

    // 5. Update old manager member role
    await tx.projectMember.updateMany({
      where: { projectId: handover!.projectId, userId: handover!.fromUserId, role: 'MANAGER' },
      data: { role: 'OBSERVER' },
    });

    await notify(
      {
        userIds: [handover!.fromUserId],
        title: `Project handover accepted: ${handover!.project.name}`,
        body: `${formatName(handover!.toUser.fullName)} has accepted the handover and is now the Project Manager.`,
        link: `/pm/projects/${handover!.projectId}`,
      },
      tx,
    );
  }

  // -------------------------------------------------------------------------
  // SAME-SQUAD PROJECT HANDOVER
  // -------------------------------------------------------------------------
  if (!isCrossSquad) {
    if (!isReceiver && !isDirector) {
      throw new ForbiddenError('Only the assigned new manager or a director can accept or decline this project handover.');
    }

    return prisma.$transaction(async (tx) => {
      const updated = await tx.projectHandover.updateMany({
        where: { id: handoverId, status: 'PENDING' },
        data: {
          status: normalizedDecision,
          decidedById: principal.userId,
          decidedAt: now,
          decisionNote: note ?? null,
        },
      });
      if (updated.count === 0) throw new DomainError('This project handover has already been decided.');

      if (normalizedDecision === 'ACCEPTED') {
        await transferProjectInTx(tx);
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

  // -------------------------------------------------------------------------
  // CROSS-SQUAD PROJECT HANDOVER (Two-stage approval)
  // -------------------------------------------------------------------------
  if (handover.status === 'PENDING') {
    // Stage 1: Receiving PM (PM2) or Director
    if (!isReceiver && !isDirector) {
      throw new ForbiddenError('Only the assigned new manager or a director can accept or decline this project handover.');
    }

    if (normalizedDecision === 'DECLINED') {
      return prisma.$transaction(async (tx) => {
        const updated = await tx.projectHandover.updateMany({
          where: { id: handoverId, status: 'PENDING' },
          data: {
            status: 'DECLINED',
            decidedById: principal.userId,
            decidedAt: now,
            decisionNote: note ?? null,
          },
        });
        if (updated.count === 0) throw new DomainError('This project handover has already been decided.');

        await notify(
          {
            userIds: [handover.fromUserId],
            title: `Project handover declined: ${handover.project.name}`,
            body: `${formatName(handover.toUser.fullName)} declined the project handover. ${note ? `Reason: ${note}` : ''}`,
            link: `/pm/projects/${handover.projectId}`,
          },
          tx,
        );

        await audit(
          {
            actorId: principal.userId,
            module: 'pm',
            action: 'project.handover.declined',
            entityType: 'Project',
            entityId: handover.projectId,
            diff: { handoverId, stage: 1, decision: 'DECLINED', note: note ?? null },
          },
          tx,
        );

        return updated;
      });
    }

    // Stage 1 ACCEPTED
    // If Director approves, can accept outright
    if (isDirector) {
      return prisma.$transaction(async (tx) => {
        const updated = await tx.projectHandover.updateMany({
          where: { id: handoverId, status: 'PENDING' },
          data: {
            status: 'ACCEPTED',
            decidedById: principal.userId,
            decidedAt: now,
            decisionNote: note ?? null,
            headApprovedById: principal.userId,
            headApprovedAt: now,
            headDecisionNote: note ?? 'Director approved outright',
          },
        });
        if (updated.count === 0) throw new DomainError('This project handover has already been decided.');

        await transferProjectInTx(tx);

        await audit(
          {
            actorId: principal.userId,
            module: 'pm',
            action: 'project.handover.accepted',
            entityType: 'Project',
            entityId: handover.projectId,
            diff: { handoverId, decision: 'ACCEPTED', outright: true, note: note ?? null },
          },
          tx,
        );

        return updated;
      });
    }

    // PM2 accepts Stage 1 -> moves to AWAITING_HEAD_APPROVAL. Project does NOT move yet!
    return prisma.$transaction(async (tx) => {
      const updated = await tx.projectHandover.updateMany({
        where: { id: handoverId, status: 'PENDING' },
        data: {
          status: 'AWAITING_HEAD_APPROVAL',
          decidedById: principal.userId,
          decidedAt: now,
          decisionNote: note ?? null,
        },
      });
      if (updated.count === 0) throw new DomainError('This project handover has already been decided.');

      const leadershipIds = Array.from(new Set([...oversightIds].filter((uid) => uid !== principal.userId)));
      if (leadershipIds.length > 0) {
        await notify(
          {
            userIds: leadershipIds,
            title: `Head approval required: Project handover (${handover.project.name})`,
            body: `${formatName(principal.fullName)} accepted project handover for "${handover.project.name}". Head sign-off required.`,
            link: '/pm/approvals',
          },
          tx,
        );
      }

      await audit(
        {
          actorId: principal.userId,
          module: 'pm',
          action: 'project.handover.stage1_approved',
          entityType: 'Project',
          entityId: handover.projectId,
          diff: { handoverId, stage: 1, decision: 'ACCEPTED', note: note ?? null },
        },
        tx,
      );

      return updated;
    });
  }

  // STAGE 2: Status is AWAITING_HEAD_APPROVAL
  if (!isHead && !isDirector) {
    throw new ForbiddenError('Only Technical Head, Service Head, or Director can give final approval.');
  }

  if (handover.decidedById === principal.userId && !isDirector) {
    throw new DomainError('Stage 2 approval must be given by a different person than Stage 1.');
  }

  if (normalizedDecision === 'DECLINED') {
    return prisma.$transaction(async (tx) => {
      const updated = await tx.projectHandover.updateMany({
        where: { id: handoverId, status: 'AWAITING_HEAD_APPROVAL' },
        data: {
          status: 'DECLINED',
          headApprovedById: principal.userId,
          headApprovedAt: now,
          headDecisionNote: note ?? null,
        },
      });
      if (updated.count === 0) throw new DomainError('This project handover has already been decided.');

      const notifyUserIds = Array.from(new Set([handover.fromUserId, handover.toUserId].filter((uid) => uid !== principal.userId)));
      if (notifyUserIds.length > 0) {
        await notify(
          {
            userIds: notifyUserIds,
            title: `Project handover declined by leadership: ${handover.project.name}`,
            body: `${formatName(principal.fullName)} declined project handover of "${handover.project.name}". ${note ? `Reason: ${note}` : ''}`,
            link: `/pm/projects/${handover.projectId}`,
          },
          tx,
        );
      }

      await audit(
        {
          actorId: principal.userId,
          module: 'pm',
          action: 'project.handover.head_declined',
          entityType: 'Project',
          entityId: handover.projectId,
          diff: { handoverId, stage: 2, decision: 'DECLINED', note: note ?? null },
        },
        tx,
      );

      return updated;
    });
  }

  // Stage 2 ACCEPTED: Project transfers now!
  return prisma.$transaction(async (tx) => {
    const updated = await tx.projectHandover.updateMany({
      where: { id: handoverId, status: 'AWAITING_HEAD_APPROVAL' },
      data: {
        status: 'ACCEPTED',
        headApprovedById: principal.userId,
        headApprovedAt: now,
        headDecisionNote: note ?? null,
      },
    });
    if (updated.count === 0) throw new DomainError('This project handover has already been decided.');

    await transferProjectInTx(tx);

    await audit(
      {
        actorId: principal.userId,
        module: 'pm',
        action: 'project.handover.accepted',
        entityType: 'Project',
        entityId: handover.projectId,
        diff: { handoverId, stage: 2, decision: 'ACCEPTED', note: note ?? null },
      },
      tx,
    );

    return updated;
  });
}

export async function cancelProjectHandover(principal: Principal, handoverId: string) {
  const handover = await prisma.projectHandover.findUnique({ where: { id: handoverId } });
  if (!handover) throw new NotFoundError('Project handover not found.');
  if (handover.status !== 'PENDING' && handover.status !== 'AWAITING_HEAD_APPROVAL') {
    throw new DomainError('Only a pending project handover can be withdrawn.');
  }
  const isRequester = handover.fromUserId === principal.userId;
  const isDirector = can(principal, 'pm.project.read.all');
  if (!isRequester && !isDirector) throw new ForbiddenError('Only the requester or a director can withdraw this.');

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
  const people = await getOrgPeople(principal.companyId);
  const isHead = hasPermissionAnywhere(principal, 'pm.oversight');
  const isDirector = can(principal, 'pm.project.read.all');
  const isStaff = isExecutionStaff(principal);

  // Squad members for whom principal is the squad lead (PM2)
  const mySquadMemberIds = people
    .filter((p) => teamRootOf(p.id, people) === principal.userId)
    .map((p) => p.id);

  const mySquadRootId = teamRootOf(principal.userId, people);
  const mySquadPeerIds = people
    .filter((p) => teamRootOf(p.id, people) === mySquadRootId)
    .map((p) => p.id);

  // Incoming task handovers:
  // 1. Direct to principal with status PENDING:
  //    - For engineers (execution staff): strictly peer-to-peer intra-squad requests that they can decide.
  //    - For managers / squad leads: requests directly to them or into their squad.
  // 2. Status AWAITING_HEAD_APPROVAL for Heads and Director (stage 2 approval)
  // 3. Status PENDING for Director (who can decide any pending handover)
  const taskIncomingWhere: Prisma.TaskHandoverWhereInput[] = [];

  if (isStaff) {
    taskIncomingWhere.push({
      toUserId: principal.userId,
      fromUserId: { in: mySquadPeerIds },
      status: 'PENDING',
    });
  } else {
    taskIncomingWhere.push({
      toUserId: principal.userId,
      status: 'PENDING',
    });
    if (mySquadMemberIds.length > 0) {
      taskIncomingWhere.push({
        toUserId: { in: mySquadMemberIds },
        status: 'PENDING',
      });
    }
  }

  if (isHead || isDirector) {
    taskIncomingWhere.push({
      status: 'AWAITING_HEAD_APPROVAL',
    });
  }
  if (isDirector) {
    taskIncomingWhere.push({
      status: 'PENDING',
    });
  }

  // Incoming project handovers:
  // 1. toUserId === principal.userId with status PENDING (managers only)
  // 2. Status AWAITING_HEAD_APPROVAL for Heads and Director
  // 3. Status PENDING for Director
  const projectIncomingWhere: Prisma.ProjectHandoverWhereInput[] = [];
  if (!isStaff) {
    projectIncomingWhere.push({ toUserId: principal.userId, status: 'PENDING' });
  }
  if (isHead || isDirector) {
    projectIncomingWhere.push({
      status: 'AWAITING_HEAD_APPROVAL',
    });
  }
  if (isDirector) {
    projectIncomingWhere.push({
      status: 'PENDING',
    });
  }

  const [
    incoming,
    outgoing,
    oversightRaw,
    incomingProjects,
    outgoingProjects,
    oversightProjectsRaw,
  ] = await Promise.all([
    prisma.taskHandover.findMany({
      where: { OR: taskIncomingWhere },
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
        status: { in: ['PENDING', 'AWAITING_HEAD_APPROVAL'] },
        toUserId: { not: principal.userId },
        fromUserId: { not: principal.userId },
        task: { project: projectVisibilityWhere(principal) },
      },
      include: handoverInclude,
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    prisma.projectHandover.findMany({
      where: { OR: projectIncomingWhere },
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
        status: { in: ['PENDING', 'AWAITING_HEAD_APPROVAL'] },
        toUserId: { not: principal.userId },
        fromUserId: { not: principal.userId },
        project: projectVisibilityWhere(principal),
      },
      include: projectHandoverInclude,
      orderBy: { createdAt: 'desc' },
      take: 25,
    }),
  ]);

  const incomingIds = new Set(incoming.map((h) => h.id));
  const oversight = oversightRaw.filter((h) => !incomingIds.has(h.id));

  const incomingProjectIds = new Set(incomingProjects.map((h) => h.id));
  const oversightProjects = oversightProjectsRaw.filter((h) => !incomingProjectIds.has(h.id));

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
      project: { select: { id: true, code: true, name: true, managerId: true, clientName: true } },
    },
  },
  fromUser: { select: { id: true, fullName: true, avatarColor: true, designation: true } },
  toUser: { select: { id: true, fullName: true, avatarColor: true, designation: true } },
  requestedBy: { select: { id: true, fullName: true, avatarColor: true, designation: true } },
  decidedBy: { select: { id: true, fullName: true, avatarColor: true, designation: true } },
  headApprovedBy: { select: { id: true, fullName: true, avatarColor: true, designation: true } },
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
  decidedBy: { select: { id: true, fullName: true, avatarColor: true, designation: true } },
  headApprovedBy: { select: { id: true, fullName: true, avatarColor: true, designation: true } },
} as const;

/**
 * Reassign all remaining incomplete tasks in a panel phase.
 */
export async function requestPanelHandover(
  principal: Principal,
  input: { phaseTaskId: string; toUserId: string; reason: string },
) {
  const phaseTask = await prisma.task.findUniqueOrThrow({
    where: { id: input.phaseTaskId },
    include: {
      project: { select: { id: true, code: true, name: true, managerId: true, departmentId: true } },
      children: {
        where: { status: { notIn: ['COMPLETED', 'CANCELLED'] } },
        include: {
          assignments: { where: { status: 'ACTIVE', role: 'OWNER' } },
        },
        orderBy: { code: 'asc' },
      },
    },
  });

  if (phaseTask.type !== 'PHASE') {
    throw new DomainError('The specified task is not a panel phase.');
  }

  const isManager = phaseTask.project.managerId === principal.userId;
  const isDirector = can(principal, 'pm.project.read.all');
  const isHead = hasPermissionAnywhere(principal, 'pm.oversight');
  const canManage =
    isManager ||
    isDirector ||
    isHead ||
    can(principal, 'pm.progress.review', {
      projectId: phaseTask.projectId,
      departmentId: phaseTask.project.departmentId,
    }) ||
    can(principal, 'pm.task.cancel', {
      projectId: phaseTask.projectId,
      departmentId: phaseTask.project.departmentId,
    });

  const isManagerOrLead = !isExecutionStaff(principal) || canManage;

  const eligibleTasks = phaseTask.children.filter((t) => {
    const owner = t.assignments.find((a) => a.role === 'OWNER');
    if (!owner) return false;
    if (canManage) return true;
    return owner.userId === principal.userId;
  });

  if (eligibleTasks.length === 0) {
    throw new DomainError('No remaining incomplete tasks found to hand over in this panel.');
  }

  const pool = await projectManagerPool(principal.companyId);
  const isPoolMember = pool.some((p) => p.id === input.toUserId);

  let target: { id: string; fullName: string } | null = null;
  if (isPoolMember) {
    const p = pool.find((pm) => pm.id === input.toUserId)!;
    target = { id: p.id, fullName: p.fullName };
  } else {
    target = await prisma.user.findFirst({
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
              role: { key: { in: ['PM_BASE', 'TECHNICAL_HEAD', 'SERVICE_HEAD', 'DIRECTOR', 'SUPER_ADMIN', 'PROJECT_MANAGER', 'ASST_MANAGER'] } },
            },
          },
        },
      },
      select: { id: true, fullName: true },
    });
  }
  if (!target) {
    throw new DomainError('Reassignment target must be an active engineering team member.');
  }

  const people = await getOrgPeople(principal.companyId);
  const firstOwner = eligibleTasks[0]!.assignments.find((a) => a.role === 'OWNER')!.userId;
  const fromSquadRoot = teamRootOf(firstOwner, people);
  const toSquadRoot = teamRootOf(target.id, people);
  const isCross = fromSquadRoot !== toSquadRoot;

  if (isCross && isExecutionStaff(principal)) {
    throw new DomainError('Engineers cannot hand over tasks across squads. Ask your project manager.');
  }

  if (!isCross && isExecutionStaff(principal)) {
    const team = await reassignTeamFor(principal);
    if (team && !team.has(target.id)) {
      throw new DomainError(OUTSIDE_TEAM_MESSAGE);
    }
  }

  const hasOversight = hasPermissionAnywhere(principal, 'pm.oversight');
  const isDirectMove = hasOversight || (isManagerOrLead && !isCross);

  if (isDirectMove) {
    return prisma.$transaction(async (tx) => {
      const movedTasks = [];
      const now = new Date();

      for (const task of eligibleTasks) {
        const owner = task.assignments.find((a) => a.role === 'OWNER');
        if (!owner) continue;
        const fromUserId = owner.userId;
        if (fromUserId === input.toUserId) continue;

        const remainingPercent = Math.max(0, 100 - task.percentComplete);
        const allocated = owner.allocatedHours ?? task.estimatedHours;
        const remainingHours = Math.round(allocated * (remainingPercent / 100) * 10) / 10;

        await tx.taskAssignment.updateMany({
          where: { taskId: task.id, status: 'ACTIVE', role: 'OWNER' },
          data: { status: 'RELEASED', releasedAt: now },
        });

        await tx.taskAssignment.create({
          data: {
            taskId: task.id,
            userId: input.toUserId,
            role: 'OWNER',
            status: 'ACTIVE',
            allocatedHours: remainingHours,
            assignedById: principal.userId,
          },
        });

        await tx.taskHandover.updateMany({
          where: { taskId: task.id, status: { in: ['PENDING', 'AWAITING_HEAD_APPROVAL'] } },
          data: {
            status: 'WITHDRAWN',
            decidedById: principal.userId,
            decidedAt: now,
            decisionNote: 'Reassigned directly by management',
          },
        });

        await audit(
          {
            actorId: principal.userId,
            module: 'pm',
            action: 'task.reassigned',
            entityType: 'Task',
            entityId: task.id,
            diff: {
              panel: phaseTask.title,
              fromUserId,
              toUserId: input.toUserId,
              requestedById: principal.userId,
              remainingPercent,
              remainingHours,
              reason: input.reason,
              direct: true,
            },
          },
          tx,
        );

        await publish(
          {
            name: EVENTS.TASK_ASSIGNED,
            module: 'pm',
            entityType: 'Task',
            entityId: task.id,
            actorId: principal.userId,
            payload: {
              taskId: task.id,
              projectId: phaseTask.projectId,
              userId: input.toUserId,
              fromUserId,
              role: 'OWNER',
            },
          },
          tx,
        );

        movedTasks.push({ taskId: task.id, fromUserId });
      }

      if (movedTasks.length === 0) {
        throw new DomainError('No tasks could be reassigned (target may already own them).');
      }

      // Ensure target is a member of the project
      await tx.projectMember.upsert({
        where: { projectId_userId: { projectId: phaseTask.projectId, userId: input.toUserId } },
        create: { projectId: phaseTask.projectId, userId: input.toUserId, role: 'ENGINEER' },
        update: {},
      });

      // Notification directly to the receiving engineer with link to project
      await notify(
        {
          userIds: [input.toUserId],
          title: `Panel assigned: ${phaseTask.title} (${movedTasks.length} tasks)`,
          body: `${formatName(principal.fullName)} handed over ${movedTasks.length} tasks in "${phaseTask.title}" to you. Reason: ${input.reason.trim()}`,
          link: `/pm/projects/${phaseTask.projectId}`,
        },
        tx,
      );

      // Notify previous owners
      const previousOwnerIds = Array.from(
        new Set(
          movedTasks
            .map((m) => m.fromUserId)
            .filter((uid): uid is string => Boolean(uid) && uid !== principal.userId && uid !== input.toUserId),
        ),
      );
      if (previousOwnerIds.length > 0) {
        await notify(
          {
            userIds: previousOwnerIds,
            title: `Panel reassigned: ${phaseTask.title}`,
            body: `${formatName(principal.fullName)} reassigned tasks in "${phaseTask.title}" to ${formatName(target.fullName)}.`,
            link: `/pm/projects/${phaseTask.projectId}`,
          },
          tx,
        );
      }

      // Notify PM if caller is not PM
      if (
        phaseTask.project.managerId &&
        phaseTask.project.managerId !== principal.userId &&
        phaseTask.project.managerId !== input.toUserId
      ) {
        await notify(
          {
            userIds: [phaseTask.project.managerId],
            title: `Panel reassigned: ${phaseTask.title}`,
            body: `${formatName(principal.fullName)} reassigned ${movedTasks.length} tasks in "${phaseTask.title}" to ${formatName(target.fullName)}.`,
            link: `/pm/projects/${phaseTask.projectId}`,
          },
          tx,
        );
      }

      return { count: movedTasks.length, handovers: [] };
    });
  }

  const pendingHandovers = await prisma.taskHandover.findMany({
    where: {
      taskId: { in: eligibleTasks.map((t) => t.id) },
      status: { in: ['PENDING', 'AWAITING_HEAD_APPROVAL'] },
    },
    select: { taskId: true },
  });
  const pendingTaskIds = new Set(pendingHandovers.map((h) => h.taskId));
  const tasksToHandover = eligibleTasks.filter((t) => !pendingTaskIds.has(t.id));

  if (tasksToHandover.length === 0) {
    throw new DomainError('All remaining tasks in this panel already have pending reassign requests.');
  }

  return prisma.$transaction(async (tx) => {
    const createdList = [];
    for (const task of tasksToHandover) {
      const owner = task.assignments.find((a) => a.role === 'OWNER')!;
      const fromUserId = owner.userId;
      if (fromUserId === input.toUserId) continue;

      const remainingPercent = Math.max(0, 100 - task.percentComplete);
      const allocated = owner.allocatedHours ?? task.estimatedHours;
      const remainingHours = Math.round(allocated * (remainingPercent / 100) * 10) / 10;

      const status = isManagerOrLead ? 'AWAITING_HEAD_APPROVAL' : 'PENDING';
      const created = await tx.taskHandover.create({
        data: {
          taskId: task.id,
          fromUserId,
          toUserId: input.toUserId,
          requestedById: principal.userId,
          reason: input.reason.trim(),
          remainingPercent,
          remainingHours,
          status,
        },
      });
      createdList.push(created);

      await audit(
        {
          actorId: principal.userId,
          module: 'pm',
          action: 'task.reassign_requested',
          entityType: 'Task',
          entityId: task.id,
          diff: {
            panel: phaseTask.title,
            fromUserId,
            toUserId: input.toUserId,
            requestedById: principal.userId,
            remainingPercent,
            remainingHours,
            reason: input.reason,
            crossSquad: isCross,
            status,
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
            taskId: task.id,
            projectId: phaseTask.projectId,
            fromUserId,
            toUserId: input.toUserId,
            remainingPercent,
          },
        },
        tx,
      );
    }

    if (createdList.length === 0) {
      throw new DomainError('No tasks could be reassigned (target may already own them).');
    }

    if (isManagerOrLead && isCross) {
      // Cross-team handover by PM / Asst PM: notify Technical Heads + Directors
      const oversightIds = await oversightRecipients(principal.companyId, phaseTask.project.departmentId, principal.userId);
      if (oversightIds.length > 0) {
        await notify(
          {
            userIds: oversightIds,
            title: `Cross-team panel handover requested: ${phaseTask.title} (${createdList.length} tasks)`,
            body: `${formatName(principal.fullName)} requested to hand over ${createdList.length} tasks in "${phaseTask.title}" to ${formatName(target.fullName)}. Head approval required.`,
            link: '/pm/approvals',
          },
          tx,
        );
      }
    } else if (isCross) {
      // Cross-squad panel handover: receiving squad lead (PM2) and leadership notified
      const oversightIds = await oversightRecipients(principal.companyId, phaseTask.project.departmentId, principal.userId);
      const notifyUserIds = Array.from(
        new Set([toSquadRoot, ...oversightIds].filter((uid): uid is string => Boolean(uid) && uid !== principal.userId)),
      );
      if (notifyUserIds.length > 0) {
        await notify(
          {
            userIds: notifyUserIds,
            title: `Cross-squad panel handover requested: ${phaseTask.title} (${createdList.length} tasks)`,
            body: `${formatName(principal.fullName)} requested to hand over ${createdList.length} tasks in "${phaseTask.title}" to ${formatName(target.fullName)}. Receiving squad lead approval required.`,
            link: '/pm/approvals',
          },
          tx,
        );
      }
    } else {
      // Consolidated notification to receiver
      await notify(
        {
          userIds: [input.toUserId],
          title: `Panel handover: ${phaseTask.title} (${createdList.length} tasks)`,
          body: `${formatName(principal.fullName)} requested to hand over ${createdList.length} tasks in "${phaseTask.title}" to you. Reason: ${input.reason.trim()}`,
          link: '/pm/handovers',
        },
        tx,
      );
    }

    // Consolidated notification to PM (if not requester)
    if (phaseTask.project.managerId !== principal.userId) {
      await notify(
        {
          userIds: [phaseTask.project.managerId],
          title: `Panel handover requested: ${phaseTask.title}`,
          body: `${formatName(principal.fullName)} requested to hand over ${createdList.length} tasks in "${phaseTask.title}" to ${formatName(target.fullName)}.`,
          link: `/pm/projects/${phaseTask.projectId}`,
        },
        tx,
      );
    }

    // Consolidated notification to original owner (if requester is manager)
    if (firstOwner !== principal.userId) {
      await notify(
        {
          userIds: [firstOwner],
          title: `Panel handover requested: ${phaseTask.title}`,
          body: `${formatName(principal.fullName)} requested to hand over ${createdList.length} tasks in "${phaseTask.title}" to ${formatName(target.fullName)}.`,
          link: `/pm/projects/${phaseTask.projectId}`,
        },
        tx,
      );
    }

    return { count: createdList.length, handovers: createdList };
  });
}

export async function decidePanelHandover(
  principal: Principal,
  input: { phaseTaskId: string; decision: 'ACCEPTED' | 'DECLINED' | 'REJECTED'; note?: string },
) {
  const childTasks = await prisma.task.findMany({
    where: { parentId: input.phaseTaskId },
    select: { id: true },
  });
  const taskIds = childTasks.map((t) => t.id);

  const pending = await prisma.taskHandover.findMany({
    where: {
      taskId: { in: taskIds },
      status: { in: ['PENDING', 'AWAITING_HEAD_APPROVAL'] },
    },
    select: { id: true },
  });

  if (pending.length === 0) {
    throw new DomainError('No pending reassignments found for this panel.');
  }

  const results = [];
  for (const h of pending) {
    try {
      const res = await decideHandover(principal, h.id, input.decision, input.note);
      results.push(res);
    } catch {
      // Handover might not be actionable by this principal
    }
  }

  if (results.length === 0) {
    throw new DomainError('No pending reassignments on this panel were actionable by you.');
  }

  return { count: results.length, decision: input.decision };
}

