import { prisma } from '@/core/db/prisma';
import { hasPermissionAnywhere } from '@/core/rbac/engine';
import { DomainError, ForbiddenError, NotFoundError } from '@/core/rbac/errors';
import type { Principal } from '@/core/rbac/types';
import { audit } from '@/core/audit/audit';
import { startOfDay } from '@/core/utils/dates';

export interface CreateCommissioningLogInput {
  projectId: string;
  loggedFor: Date | string;
  workDone: string;
  blocker?: string | null;
}

/**
 * List projects eligible for or currently in commissioning.
 * Head / Director view (pm.commissioning.manage).
 */
export async function listCommissioningProjects(principal: Principal) {
  if (!hasPermissionAnywhere(principal, 'pm.commissioning.read')) {
    throw new ForbiddenError('Missing permission: pm.commissioning.read');
  }

  const projects = await prisma.project.findMany({
    where: {
      companyId: principal.companyId,
      status: { in: ['COMPLETED', 'COMMISSIONING'] },
    },
    select: {
      id: true,
      code: true,
      name: true,
      clientName: true,
      workOrderNo: true,
      status: true,
      panelCount: true,
      startDate: true,
      targetEndDate: true,
      actualEndDate: true,
      manager: {
        select: {
          id: true,
          fullName: true,
          avatarColor: true,
        },
      },
      commissioningAssignments: {
        where: { releasedAt: null },
        include: {
          user: {
            select: {
              id: true,
              fullName: true,
              employeeCode: true,
              designation: true,
              avatarColor: true,
              grade: true,
            },
          },
        },
      },
      commissioningLogs: {
        orderBy: { loggedFor: 'desc' },
        take: 5,
        include: {
          user: {
            select: {
              id: true,
              fullName: true,
              avatarColor: true,
            },
          },
        },
      },
      _count: {
        select: {
          commissioningLogs: true,
          tasks: true,
        },
      },
    },
    orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
  });

  // Pending = status is COMPLETED and has no active commissioning assignments
  const pending = projects.filter((p) => p.status === 'COMPLETED' && p.commissioningAssignments.length === 0);
  const inCommissioning = projects.filter((p) => p.status === 'COMMISSIONING' || p.commissioningAssignments.length > 0);

  return {
    all: projects,
    pending,
    inCommissioning,
  };
}

/**
 * All active engineers across every team (not filtered by PM).
 */
export async function listEligibleEngineers(principal: Principal) {
  if (!hasPermissionAnywhere(principal, 'pm.commissioning.manage')) {
    throw new ForbiddenError('Missing permission: pm.commissioning.manage');
  }

  const users = await prisma.user.findMany({
    where: {
      companyId: principal.companyId,
      status: 'ACTIVE',
    },
    select: {
      id: true,
      fullName: true,
      employeeCode: true,
      designation: true,
      grade: true,
      avatarColor: true,
      department: {
        select: {
          name: true,
        },
      },
    },
    orderBy: { fullName: 'asc' },
  });

  return users;
}

/**
 * Assign an engineer to site commissioning for a completed or commissioning project.
 * If the project was COMPLETED, moves it to COMMISSIONING.
 */
export async function assignEngineerToCommissioning(
  principal: Principal,
  projectId: string,
  userId: string
) {
  if (!hasPermissionAnywhere(principal, 'pm.commissioning.manage')) {
    throw new ForbiddenError('Missing permission: pm.commissioning.manage');
  }

  const project = await prisma.project.findFirst({
    where: { id: projectId, companyId: principal.companyId },
    select: { id: true, name: true, status: true },
  });

  if (!project) throw new NotFoundError('Project not found');
  if (project.status !== 'COMPLETED' && project.status !== 'COMMISSIONING') {
    throw new DomainError('Commissioning can only be assigned to completed or commissioning projects.');
  }

  const engineer = await prisma.user.findFirst({
    where: { id: userId, companyId: principal.companyId, status: 'ACTIVE' },
    select: { id: true, fullName: true },
  });

  if (!engineer) throw new NotFoundError('Engineer not found or inactive');

  const result = await prisma.$transaction(async (tx) => {
    // 1. Move to COMMISSIONING if it was COMPLETED
    if (project.status === 'COMPLETED') {
      await tx.project.update({
        where: { id: projectId },
        data: { status: 'COMMISSIONING' },
      });
    }

    // 2. Upsert assignment
    const assignment = await tx.commissioningAssignment.upsert({
      where: {
        projectId_userId: { projectId, userId },
      },
      create: {
        projectId,
        userId,
        assignedById: principal.userId,
        assignedAt: new Date(),
        releasedAt: null,
      },
      update: {
        assignedById: principal.userId,
        assignedAt: new Date(),
        releasedAt: null,
      },
    });

    return assignment;
  });

  await audit({
    actorId: principal.userId,
    module: 'pm',
    action: 'commissioning.engineer_assigned',
    entityType: 'project',
    entityId: projectId,
    diff: {
      engineerId: userId,
      engineerName: engineer.fullName,
      status: 'COMMISSIONING',
    },
  });

  return result;
}

/**
 * Release an assigned engineer from site commissioning.
 */
export async function releaseEngineerFromCommissioning(
  principal: Principal,
  projectId: string,
  userId: string
) {
  if (!hasPermissionAnywhere(principal, 'pm.commissioning.manage')) {
    throw new ForbiddenError('Missing permission: pm.commissioning.manage');
  }

  const assignment = await prisma.commissioningAssignment.findUnique({
    where: { projectId_userId: { projectId, userId } },
    include: { user: { select: { fullName: true } } },
  });

  if (!assignment) throw new NotFoundError('Assignment not found');

  await prisma.commissioningAssignment.update({
    where: { projectId_userId: { projectId, userId } },
    data: { releasedAt: new Date() },
  });

  await audit({
    actorId: principal.userId,
    module: 'pm',
    action: 'commissioning.engineer_released',
    entityType: 'project',
    entityId: projectId,
    diff: {
      engineerId: userId,
      engineerName: assignment.user.fullName,
      releasedAt: new Date(),
    },
  });

  return { success: true };
}

/**
 * Mark commissioning complete -> project moves to CLOSED.
 */
export async function closeCommissioning(principal: Principal, projectId: string) {
  if (!hasPermissionAnywhere(principal, 'pm.commissioning.manage')) {
    throw new ForbiddenError('Missing permission: pm.commissioning.manage');
  }

  const project = await prisma.project.findFirst({
    where: { id: projectId, companyId: principal.companyId },
    select: { id: true, name: true, status: true },
  });

  if (!project) throw new NotFoundError('Project not found');
  if (project.status !== 'COMMISSIONING' && project.status !== 'COMPLETED') {
    throw new DomainError('Only projects in commissioning or completed can be closed.');
  }

  await prisma.$transaction(async (tx) => {
    // Release any active assignments
    await tx.commissioningAssignment.updateMany({
      where: { projectId, releasedAt: null },
      data: { releasedAt: new Date() },
    });

    // Mark project CLOSED
    await tx.project.update({
      where: { id: projectId },
      data: {
        status: 'CLOSED',
        actualEndDate: new Date(),
      },
    });

    await audit(
      {
        actorId: principal.userId,
        module: 'pm',
        action: 'commissioning.closed',
        entityType: 'project',
        entityId: projectId,
        diff: {
          status: { from: project.status, to: 'CLOSED' },
        },
      },
      tx
    );
  });

  return { success: true };
}

/**
 * Projects an engineer is currently assigned to for commissioning.
 * Engineer view (pm.commissioning.log).
 */
export async function getMyCommissioningProjects(principal: Principal) {
  if (!hasPermissionAnywhere(principal, 'pm.commissioning.log')) {
    throw new ForbiddenError('Missing permission: pm.commissioning.log');
  }

  const assignments = await prisma.commissioningAssignment.findMany({
    where: {
      userId: principal.userId,
      releasedAt: null,
      project: {
        status: 'COMMISSIONING',
      },
    },
    include: {
      project: {
        select: {
          id: true,
          code: true,
          name: true,
          clientName: true,
          workOrderNo: true,
          panelCount: true,
          status: true,
        },
      },
    },
    orderBy: { assignedAt: 'desc' },
  });

  return assignments.map((a) => a.project);
}

/**
 * Recent daily commissioning logs by the current engineer.
 */
export async function getMyCommissioningLogs(principal: Principal, limit: number = 30) {
  if (!hasPermissionAnywhere(principal, 'pm.commissioning.log')) {
    throw new ForbiddenError('Missing permission: pm.commissioning.log');
  }

  const logs = await prisma.commissioningLog.findMany({
    where: {
      userId: principal.userId,
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
    },
    orderBy: { loggedFor: 'desc' },
    take: limit,
  });

  return logs;
}

/**
 * Record a daily log on site for an assigned commissioning project.
 * Engineer view (pm.commissioning.log).
 */
export async function createCommissioningLog(
  principal: Principal,
  input: CreateCommissioningLogInput
) {
  if (!hasPermissionAnywhere(principal, 'pm.commissioning.log')) {
    throw new ForbiddenError('Missing permission: pm.commissioning.log');
  }

  const workDone = input.workDone?.trim();
  if (!workDone) {
    throw new DomainError('Work done description is required.');
  }

  // Verify engineer is assigned to this project
  const assignment = await prisma.commissioningAssignment.findFirst({
    where: {
      projectId: input.projectId,
      userId: principal.userId,
      releasedAt: null,
      project: {
        status: 'COMMISSIONING',
      },
    },
  });

  if (!assignment) {
    throw new DomainError('You are not actively assigned to site commissioning for this project.');
  }

  const loggedFor = startOfDay(new Date(input.loggedFor));

  // Check unique log for this engineer, project, and day
  const existing = await prisma.commissioningLog.findUnique({
    where: {
      projectId_userId_loggedFor: {
        projectId: input.projectId,
        userId: principal.userId,
        loggedFor,
      },
    },
  });

  if (existing) {
    throw new DomainError('You have already logged site work for this project on this date.');
  }

  const log = await prisma.commissioningLog.create({
    data: {
      projectId: input.projectId,
      userId: principal.userId,
      loggedFor,
      workDone,
      blocker: input.blocker?.trim() || null,
    },
  });

  await audit({
    actorId: principal.userId,
    module: 'pm',
    action: 'commissioning.log_created',
    entityType: 'commissioning_log',
    entityId: log.id,
    diff: {
      projectId: input.projectId,
      loggedFor,
      workDone,
      blocker: input.blocker,
    },
  });

  return log;
}

/**
 * Pending commissioning logs awaiting approval.
 * Head / Director view (pm.commissioning.approve).
 */
export async function listPendingCommissioningApprovals(principal: Principal) {
  if (!hasPermissionAnywhere(principal, 'pm.commissioning.approve')) {
    throw new ForbiddenError('Missing permission: pm.commissioning.approve');
  }

  const logs = await prisma.commissioningLog.findMany({
    where: {
      approvedAt: null,
      rejectedAt: null,
      project: {
        companyId: principal.companyId,
      },
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
      user: {
        select: {
          id: true,
          fullName: true,
          employeeCode: true,
          designation: true,
          avatarColor: true,
        },
      },
    },
    orderBy: { loggedFor: 'desc' },
  });

  return logs;
}

/**
 * Approve a daily commissioning log.
 */
export async function approveCommissioningLog(principal: Principal, logId: string) {
  if (!hasPermissionAnywhere(principal, 'pm.commissioning.approve')) {
    throw new ForbiddenError('Missing permission: pm.commissioning.approve');
  }

  const log = await prisma.commissioningLog.findUnique({
    where: { id: logId },
    include: { project: { select: { companyId: true } } },
  });

  if (!log || log.project.companyId !== principal.companyId) {
    throw new NotFoundError('Commissioning log not found');
  }

  const updated = await prisma.commissioningLog.update({
    where: { id: logId },
    data: {
      approvedById: principal.userId,
      approvedAt: new Date(),
      rejectedAt: null,
    },
  });

  await audit({
    actorId: principal.userId,
    module: 'pm',
    action: 'commissioning.log_approved',
    entityType: 'commissioning_log',
    entityId: logId,
    diff: {
      approvedById: principal.userId,
      approvedAt: new Date(),
    },
  });

  return updated;
}

/**
 * Reject a daily commissioning log with an optional decision note.
 */
export async function rejectCommissioningLog(
  principal: Principal,
  logId: string,
  decisionNote?: string
) {
  if (!hasPermissionAnywhere(principal, 'pm.commissioning.approve')) {
    throw new ForbiddenError('Missing permission: pm.commissioning.approve');
  }

  const log = await prisma.commissioningLog.findUnique({
    where: { id: logId },
    include: { project: { select: { companyId: true } } },
  });

  if (!log || log.project.companyId !== principal.companyId) {
    throw new NotFoundError('Commissioning log not found');
  }

  const updated = await prisma.commissioningLog.update({
    where: { id: logId },
    data: {
      rejectedAt: new Date(),
      approvedAt: null,
      decisionNote: decisionNote?.trim() || null,
    },
  });

  await audit({
    actorId: principal.userId,
    module: 'pm',
    action: 'commissioning.log_rejected',
    entityType: 'commissioning_log',
    entityId: logId,
    diff: {
      rejectedAt: new Date(),
      decisionNote,
    },
  });

  return updated;
}
