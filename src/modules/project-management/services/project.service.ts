import type { Prisma } from '@prisma/client';
import { prisma } from '@/core/db/prisma';
import { assertCan } from '@/core/rbac/guard';
import { can } from '@/core/rbac/engine';
import { DomainError, NotFoundError } from '@/core/rbac/errors';
import type { Principal } from '@/core/rbac/types';
import { audit, diffOf } from '@/core/audit/audit';
import { publish } from '@/core/events/bus';
import { EVENTS } from '@/core/events/catalog';
import { notify } from '@/core/notifications/notify';
import { assertProjectPermission, assertProjectVisible, projectVisibilityWhere } from './access';
import type { CreateProjectInput, UpdateProjectInput } from '../validation/schemas';
import { computeSchedule, rollUpProgress, type Graph } from '../domain/scheduling';
import { activeLeafTasks, forecastFinish, isLaneLate, projectStepStats } from '../domain/portfolio';
import { formatName } from '@/core/utils/strings';
import { startOfDay, todayInIndia } from '@/core/utils/dates';
import { syncAllOrdersSafely, syncProjectOrderSafely } from '@/modules/erp/sync';
import { getClientById } from './client.service';


/**
 * Project lifecycle.
 *
 * Creating a project does three things atomically: the project row, the manager's
 * membership, and a PROJECT-scoped role assignment. That last one is what makes the
 * permission model work in practice - the manager gets rights on THIS project only,
 * without anyone editing a global role.
 */
export async function createProject(principal: Principal, input: CreateProjectInput) {
  const manager = await prisma.user.findFirst({
    where: { id: input.managerId, companyId: principal.companyId, status: 'ACTIVE' },
    select: { id: true, fullName: true, departmentId: true },
  });
  if (!manager) throw new DomainError('The selected project manager is not an active employee.');

  const departmentId = input.departmentId || manager.departmentId || principal.departmentId;
  assertCan(principal, 'pm.project.create', { departmentId: departmentId ?? undefined });

  const code = input.code ?? (await nextProjectCode(principal.companyId));

  if (input.startDate && input.targetEndDate && input.targetEndDate < input.startDate) {
    throw new DomainError('Target end date cannot be before the start date.');
  }

  const managerRole = await prisma.role.findUnique({ where: { key: 'PROJECT_MANAGER' }, select: { id: true } });

  const project = await prisma.$transaction(async (tx) => {
    const created = await tx.project.create({
      data: {
        companyId: principal.companyId,
        code,
        name: input.name,
        workOrderNo: input.workOrderNo,
        description: input.description,
        clientId: input.clientId ?? null,
        clientName: input.clientName,
        endUserName: input.endUserName ?? null,
        applicationName: input.applicationName ?? null,
        panelType: input.panelType,
        panelCount: input.panelCount,
        priority: input.priority,
        status: input.status,
        startDate: input.startDate ?? null,
        targetEndDate: input.targetEndDate ?? null,
        managerId: manager.id,
        sponsorId: input.sponsorId || principal.userId,
        departmentId: departmentId ?? null,
      },
    });

    await tx.projectMember.create({
      data: { projectId: created.id, userId: manager.id, role: 'MANAGER', allocationPercent: 100 },
    });

    if (managerRole) {
      await tx.roleAssignment.upsert({
        where: {
          userId_roleId_scopeType_scopeId: {
            userId: manager.id,
            roleId: managerRole.id,
            scopeType: 'PROJECT',
            scopeId: created.id,
          },
        },
        create: {
          userId: manager.id,
          roleId: managerRole.id,
          scopeType: 'PROJECT',
          scopeId: created.id,
          grantedBy: principal.userId,
        },
        update: {},
      });
    }

    await audit(
      {
        actorId: principal.userId,
        module: 'pm',
        action: 'project.created',
        entityType: 'Project',
        entityId: created.id,
        diff: { code: created.code, name: created.name, managerId: manager.id },
      },
      tx,
    );

    await publish(
      {
        name: EVENTS.PROJECT_CREATED,
        module: 'pm',
        entityType: 'Project',
        entityId: created.id,
        actorId: principal.userId,
        payload: { code: created.code, name: created.name, clientName: created.clientName, managerId: manager.id },
      },
      tx,
    );

    if (manager.id !== principal.userId) {
      await notify(
        {
          userIds: [manager.id],
          title: `You are managing ${created.name}`,
          body: `${formatName(principal.fullName)} assigned you as project manager for "${created.name}".`,
          link: `/pm/projects/${created.id}`,
        },
        tx,
      );
    }

    return created;
  });

  return project;
}

/** Generates PRJ-YYYY-NNN or customPrefix-NNN, scoped per company. */
export async function nextProjectCode(companyId: string, customPrefix?: string): Promise<string> {
  const year = new Date().getUTCFullYear();
  const prefix = customPrefix ?? `PRJ-${year}-`;
  const last = await prisma.project.findFirst({
    where: { companyId, code: { startsWith: prefix } },
    orderBy: { code: 'desc' },
    select: { code: true },
  });
  const sequence = last ? Number.parseInt(last.code.slice(prefix.length), 10) + 1 : 1;
  return `${prefix}${String(sequence).padStart(3, '0')}`;
}

/** Generates <CLIENT_REF>-<4-digit seq> e.g. ACS-0042-0001, scoped per client and company. */
export async function nextClientProjectCode(companyId: string, clientRef: string): Promise<string> {
  const prefix = `${clientRef.trim().toUpperCase()}-`;
  const projects = await prisma.project.findMany({
    where: { companyId, code: { startsWith: prefix } },
    select: { code: true },
  });

  let maxSeq = 0;
  for (const p of projects) {
    const tail = p.code.slice(prefix.length);
    if (/^\d+$/.test(tail)) {
      const num = parseInt(tail, 10);
      if (num > maxSeq) maxSeq = num;
    }
  }

  const nextSeq = maxSeq + 1;
  return `${prefix}${String(nextSeq).padStart(4, '0')}`;
}

/** Lists distinct project codes with their clientId for wizard suggestions. */
export async function listExistingProjectCodes(
  companyId: string,
): Promise<Array<{ code: string; clientId: string | null }>> {
  return prisma.project.findMany({
    where: { companyId },
    select: { code: true, clientId: true },
    distinct: ['code'],
    orderBy: { code: 'asc' },
  });
}



export async function updateProject(
  principal: Principal,
  projectId: string,
  input: UpdateProjectInput,
) {
  const before = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  if (before.companyId !== principal.companyId) {
    throw new NotFoundError('Project not found.');
  }
  const departmentId = before.departmentId || principal.departmentId;
  assertCan(principal, 'pm.project.create', { departmentId: departmentId ?? undefined });

  let code = before.code;
  if (input.code !== undefined && input.code !== null && input.code !== '') {
    code = input.code.trim().toUpperCase().replace(/[\s_]+/g, '-');
    if (!/^[A-Z0-9][A-Z0-9-]{2,19}$/.test(code)) {
      throw new DomainError('Project code must be 3-20 characters: letters, digits or dashes (e.g. ACS-0042-0001).');
    }
  }

  let workOrderNo = before.workOrderNo;
  if (input.workOrderNo !== undefined) {
    if (input.workOrderNo !== null && input.workOrderNo !== '') {
      const trimmedWO = input.workOrderNo.trim();
      if (!/^\d+$/.test(trimmedWO)) {
        throw new DomainError('Work order number must contain digits only.');
      }
      if (trimmedWO !== before.workOrderNo) {
        const existingWO = await prisma.project.findFirst({
          where: {
            companyId: principal.companyId,
            kind: 'WORK_ORDER',
            workOrderNo: trimmedWO,
            id: { not: projectId },
          },
        });
        if (existingWO) {
          throw new DomainError(`Work order number "${trimmedWO}" is already in use by project ${existingWO.code}.`);
        }
      }
      workOrderNo = trimmedWO;
    } else {
      workOrderNo = null;
    }
  }

  let clientId = before.clientId;
  let clientName = before.clientName;
  if (input.clientId !== undefined) {
    clientId = input.clientId || null;
    if (clientId && clientId !== before.clientId) {
      const client = await getClientById(principal.companyId, clientId);
      if (!client) throw new DomainError('Client not found.');
      clientName = client.name;
    }
  }
  if (input.clientName !== undefined && !input.clientId) {
    clientName = input.clientName;
  }

  const startDate = input.startDate !== undefined ? input.startDate : before.startDate;
  const targetEndDate = input.targetEndDate !== undefined ? input.targetEndDate : before.targetEndDate;

  const start = startDate ? startOfDay(startDate) : null;
  const targetEnd = targetEndDate ? startOfDay(targetEndDate) : null;

  if (start && targetEnd && targetEnd.getTime() < start.getTime()) {
    throw new DomainError('Target delivery date cannot be before the start date.');
  }

  const phaseTasks = await prisma.task.findMany({
    where: { projectId, type: 'PHASE' },
    orderBy: { code: 'asc' },
  });

  const phaseUpdates: Array<{ id: string; title: string; from: Date | null; to: Date }> = [];

  for (const phaseTask of phaseTasks) {
    const match = phaseTask.title.match(/^([A-Za-z0-9]+)\s+Panel\s+(\d+)$/i);
    const panelKey = match ? `${match[1]?.toUpperCase()}_${match[2]}` : null;
    const rawInputDate = (panelKey && input.panelDeliveryDates?.[panelKey]) ?? input.panelDeliveryDates?.[phaseTask.title];

    let panelDate: Date | null = null;
    if (rawInputDate) {
      panelDate = startOfDay(new Date(rawInputDate));
      if (isNaN(panelDate.getTime())) {
        throw new DomainError(`${phaseTask.title} delivery date is invalid.`);
      }
    } else if (phaseTask.plannedEnd) {
      panelDate = startOfDay(phaseTask.plannedEnd);
    } else if (targetEnd) {
      panelDate = targetEnd;
    }

    if (panelDate) {
      if (start && panelDate.getTime() < start.getTime()) {
        throw new DomainError(`${phaseTask.title} delivery date is before the project start date.`);
      }
      if (targetEnd && panelDate.getTime() > targetEnd.getTime()) {
        throw new DomainError(`${phaseTask.title} delivery date is after the project target date.`);
      }
    }

    if (rawInputDate && panelDate) {
      const oldDateStr = phaseTask.plannedEnd ? phaseTask.plannedEnd.toISOString().slice(0, 10) : null;
      const newDateStr = panelDate.toISOString().slice(0, 10);
      if (oldDateStr !== newDateStr) {
        phaseUpdates.push({
          id: phaseTask.id,
          title: phaseTask.title,
          from: phaseTask.plannedEnd,
          to: new Date(rawInputDate),
        });
      }
    }
  }

  // Plan 014: on a project made from an ERPNext sales order, the order owns client, WO and dates.
  if (before.erpSalesOrder) {
    const day = (d: Date | null) => (d ? startOfDay(d).toISOString().slice(0, 10) : null);
    const orderFieldChanged =
      workOrderNo !== before.workOrderNo ||
      clientId !== before.clientId ||
      clientName !== before.clientName ||
      day(targetEndDate) !== day(before.targetEndDate) ||
      phaseUpdates.length > 0;
    if (orderFieldChanged) throw new DomainError('This comes from the sales order. Change it in ERP.');
  }

  const data: Record<string, unknown> = {
    name: input.name !== undefined ? input.name : before.name,
    code,
    workOrderNo,
    description: input.description !== undefined ? input.description : before.description,
    clientId,
    clientName,
    endUserName: input.endUserName !== undefined ? input.endUserName : before.endUserName,
    applicationName: input.applicationName !== undefined ? input.applicationName : before.applicationName,
    panelType: input.panelType !== undefined ? input.panelType : before.panelType,
    panelCount: input.panelCount !== undefined ? input.panelCount : before.panelCount,
    priority: input.priority !== undefined ? input.priority : before.priority,
    startDate,
    targetEndDate,
  };

  const beforeData: Record<string, unknown> = {
    name: before.name,
    code: before.code,
    workOrderNo: before.workOrderNo,
    description: before.description,
    clientId: before.clientId,
    clientName: before.clientName,
    endUserName: before.endUserName,
    applicationName: before.applicationName,
    panelType: before.panelType,
    panelCount: before.panelCount,
    priority: before.priority,
    startDate: before.startDate,
    targetEndDate: before.targetEndDate,
  };

  return prisma.$transaction(async (tx) => {
    const updated = await tx.project.update({
      where: { id: projectId },
      data,
    });

    for (const pu of phaseUpdates) {
      await tx.task.update({
        where: { id: pu.id },
        data: { plannedEnd: pu.to },
      });
    }

    const auditDiff = diffOf(beforeData, data);
    for (const pu of phaseUpdates) {
      auditDiff[`${pu.title} delivery`] = {
        from: pu.from ? pu.from.toISOString().slice(0, 10) : null,
        to: pu.to.toISOString().slice(0, 10),
      };
    }

    await audit(
      {
        actorId: principal.userId,
        module: 'pm',
        action: 'project.updated',
        entityType: 'Project',
        entityId: projectId,
        diff: auditDiff,
      },
      tx,
    );

    return updated;
  });
}

export async function holdProject(
  principal: Principal,
  projectId: string,
  reason: string,
) {
  await assertProjectPermission(principal, projectId, 'pm.project.update');
  const trimmedReason = reason?.trim();
  if (!trimmedReason) {
    throw new DomainError('A reason is required to place a project on hold.');
  }

  const before = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  if (before.status === 'ON_HOLD') {
    throw new DomainError('Project is already on hold.');
  }
  if (before.status === 'COMPLETED') {
    throw new DomainError('A completed project cannot be placed on hold.');
  }

  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const updated = await tx.project.update({
      where: { id: projectId },
      data: {
        status: 'ON_HOLD',
        holdReason: trimmedReason,
        heldAt: now,
      },
    });

    await audit(
      {
        actorId: principal.userId,
        module: 'pm',
        action: 'project.hold',
        entityType: 'Project',
        entityId: projectId,
        diff: {
          status: { from: before.status, to: 'ON_HOLD' },
          holdReason: { from: before.holdReason, to: trimmedReason },
          heldAt: { from: before.heldAt, to: now.toISOString() },
        },
      },
      tx,
    );

    await publish(
      {
        name: EVENTS.PROJECT_STATUS_CHANGED,
        module: 'pm',
        entityType: 'Project',
        entityId: projectId,
        actorId: principal.userId,
        payload: {
          from: before.status,
          to: 'ON_HOLD',
          code: updated.code,
          reason: trimmedReason,
          heldAt: now.toISOString(),
        },
      },
      tx,
    );

    return updated;
  });
}

export async function resumeProject(
  principal: Principal,
  projectId: string,
) {
  await assertProjectPermission(principal, projectId, 'pm.project.update');
  const before = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  if (before.status !== 'ON_HOLD') {
    throw new DomainError('Only projects that are on hold can be resumed.');
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.project.update({
      where: { id: projectId },
      data: {
        status: 'IN_PROGRESS',
        holdReason: null,
        heldAt: null,
      },
    });

    await audit(
      {
        actorId: principal.userId,
        module: 'pm',
        action: 'project.resumed',
        entityType: 'Project',
        entityId: projectId,
        diff: {
          status: { from: 'ON_HOLD', to: 'IN_PROGRESS' },
          holdReason: { from: before.holdReason, to: null },
          heldAt: { from: before.heldAt?.toISOString() ?? null, to: null },
        },
      },
      tx,
    );

    await publish(
      {
        name: EVENTS.PROJECT_STATUS_CHANGED,
        module: 'pm',
        entityType: 'Project',
        entityId: projectId,
        actorId: principal.userId,
        payload: {
          from: 'ON_HOLD',
          to: 'IN_PROGRESS',
          code: updated.code,
          previousReason: before.holdReason,
        },
      },
      tx,
    );

    return updated;
  });
}

/** Plan 015: "Mark reviewed" on an "Order changed" alert. Directors and heads (`pm.project.create`). */
export async function clearOrderAlert(principal: Principal, projectId: string) {
  const project = await prisma.project.findFirst({ where: { id: projectId, companyId: principal.companyId } });
  if (!project) throw new NotFoundError('Project not found.');
  assertCan(principal, 'pm.project.create', { departmentId: (project.departmentId || principal.departmentId) ?? undefined });
  if (!project.erpOrderAlert) return;

  await prisma.$transaction(async (tx) => {
    await tx.project.update({ where: { id: projectId }, data: { erpOrderAlert: null, erpOrderAlertAt: null } });
    await audit(
      {
        actorId: principal.userId,
        module: 'erp',
        action: 'order_alert_cleared',
        entityType: 'Project',
        entityId: projectId,
        diff: { alert: project.erpOrderAlert },
      },
      tx,
    );
  });
}

export interface ProjectListFilters {
  status?: string;
  search?: string;
  managerId?: string;
}

export async function listProjects(principal: Principal, filters: ProjectListFilters = {}) {
  await syncAllOrdersSafely(principal.companyId);
  const whereClauses: Prisma.ProjectWhereInput[] = [
    projectVisibilityWhere(principal),
  ];

  if (filters.managerId) {
    whereClauses.push({ managerId: filters.managerId });
  }

  if (filters.status) {
    whereClauses.push({ status: filters.status as never });
  }

  if (filters.search) {
    whereClauses.push({
      OR: [
        { name: { contains: filters.search, mode: 'insensitive' as const } },
        { code: { contains: filters.search, mode: 'insensitive' as const } },
        { clientName: { contains: filters.search, mode: 'insensitive' as const } },
      ],
    });
  }

  const projects = await prisma.project.findMany({
    where: {
      AND: whereClauses,
    },
    orderBy: [{ priority: 'desc' }, { targetEndDate: 'asc' }],
    include: {
      manager: { select: { id: true, fullName: true, avatarColor: true } },
      _count: { select: { tasks: true, members: true } },
    },
  });

  const projectIds = projects.map((p) => p.id);
  const tasks = projectIds.length === 0 ? [] : await prisma.task.findMany({
    where: { projectId: { in: projectIds } },
    select: {
      id: true,
      projectId: true,
      parentId: true,
      type: true,
      status: true,
      estimatedHours: true,
      actualHours: true,
      percentComplete: true,
    },
  });

  const tasksByProject = new Map<string, typeof tasks>();
  for (const t of tasks) {
    const list = tasksByProject.get(t.projectId) ?? [];
    list.push(t);
    tasksByProject.set(t.projectId, list);
  }

  return projects.map((project) => {
    const projTasks = tasksByProject.get(project.id) ?? [];
    const stepStats = projectStepStats(projTasks);

    return {
      ...project,
      stats: {
        taskCount: stepStats.taskCount,
        completedCount: stepStats.completedCount,
        blockedCount: stepStats.blockedCount,
        estimatedHours: stepStats.estimatedHours,
        actualHours: stepStats.actualHours,
        progressPercent: stepStats.progressPercent,
      },
    };
  });
}

/**
 * Full project workspace payload: WBS tree, dependency edges, CPM schedule and the
 * team. Assembled in one place so the page, the API and any future export agree.
 */
export async function getProjectWorkspace(principal: Principal, projectId: string) {
  await assertProjectVisible(principal, projectId);
  await syncProjectOrderSafely(principal.companyId, projectId);

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      manager: { select: { id: true, fullName: true, avatarColor: true, designation: true } },
      sponsor: { select: { id: true, fullName: true, avatarColor: true } },
      members: {
        include: { user: { select: { id: true, fullName: true, avatarColor: true, grade: true, designation: true, skills: true } } },
        orderBy: { addedAt: 'asc' },
      },
      milestones: { orderBy: { dueDate: 'asc' } },
    },
  });
  if (!project) throw new NotFoundError('Project not found.');

  const tasks = await prisma.task.findMany({
    where: { projectId },
    orderBy: [{ code: 'asc' }],
    include: {
      assignments: {
        where: { status: { in: ['ACTIVE', 'COMPLETED'] } },
        orderBy: { assignedAt: 'desc' },
        include: {
          user: { select: { id: true, fullName: true, avatarColor: true, designation: true, grade: true } },
        },
      },
      _count: { select: { children: true, dependencies: true, handovers: true } },
    },
  });

  const dependencies = await prisma.taskDependency.findMany({
    where: { OR: [{ predecessor: { projectId } }, { successor: { projectId } }] },
    include: {
      predecessor: { select: { id: true, code: true, title: true, status: true } },
      successor: { select: { id: true, code: true, title: true, status: true } },
    },
  });

  const graph: Graph = {
    tasks: tasks.map((t) => ({
      id: t.id,
      code: t.code,
      title: t.title,
      status: t.status as never,
      estimatedHours: t.estimatedHours,
      percentComplete: t.percentComplete,
      plannedStart: t.plannedStart,
      plannedEnd: t.plannedEnd,
      parentId: t.parentId,
    })),
    edges: dependencies.map((d) => ({
      predecessorId: d.predecessorId,
      successorId: d.successorId,
      type: d.type,
      lagDays: d.lagDays,
    })),
  };

  let schedule: ReturnType<typeof computeSchedule> = [];
  let scheduleError: string | null = null;
  try {
    schedule = computeSchedule(graph, project.startDate ?? new Date());
  } catch (error) {
    scheduleError = error instanceof Error ? error.message : 'Schedule could not be computed.';
  }

  const rollup = rollUpProgress(graph.tasks);

  const statusMap = new Map(tasks.map((t) => [t.id, t.status]));
  const processedTasks = tasks.map((t) => {
    const unmetPreds = dependencies
      .filter((d) => d.successorId === t.id && !['COMPLETED', 'CANCELLED'].includes(statusMap.get(d.predecessorId) ?? 'TODO'))
      .map((d) => d.predecessor);
    const isBlocked = t.status === 'BLOCKED' || (t.status === 'TODO' && unmetPreds.length > 0);
    const effectiveStatus = isBlocked ? 'BLOCKED' : t.status;
    return {
      ...t,
      isBlocked,
      effectiveStatus,
      unmetDependencies: unmetPreds,
      percentComplete: rollup.get(t.id) ?? t.percentComplete,
      rolledUpPercent: rollup.get(t.id) ?? t.percentComplete,
      schedule: schedule.find((s) => s.taskId === t.id) ?? null,
    };
  });

  return {
    project,
    tasks: processedTasks,
    dependencies,
    schedule,
    scheduleError,
    criticalTaskIds: schedule.filter((s) => s.isCritical).map((s) => s.taskId),

    summary: projectStepStats(processedTasks),
    permissions: {
      canCreateTask: can(principal, 'pm.task.create', { projectId, departmentId: project.departmentId }),
      canCreateAdhocTask: can(principal, 'pm.task.adhoc.create', { projectId, departmentId: project.departmentId }),
      canAssign: can(principal, 'pm.task.assign', { projectId, departmentId: project.departmentId }) || project.managerId === principal.userId,
      canManageDependencies:
        can(principal, 'pm.task.dependency.manage', { projectId, departmentId: project.departmentId }) || project.managerId === principal.userId,
      canEditProject: can(principal, 'pm.project.update', { projectId, departmentId: project.departmentId }) || project.managerId === principal.userId,
      canManageMembers:
        can(principal, 'pm.project.member.manage', { projectId, departmentId: project.departmentId }) || project.managerId === principal.userId,
      canDeleteProject: can(principal, 'pm.project.delete', { projectId, departmentId: project.departmentId }),
    },
  };
}

export async function addProjectMember(
  principal: Principal,
  projectId: string,
  userId: string,
  role: 'MANAGER' | 'LEAD' | 'ENGINEER' | 'REVIEWER' | 'OBSERVER',
  allocationPercent = 100,
) {
  await assertProjectPermission(principal, projectId, 'pm.project.member.manage');

  const user = await prisma.user.findFirst({
    where: { id: userId, companyId: principal.companyId, status: 'ACTIVE' },
    select: { id: true, fullName: true, grade: true },
  });
  if (!user) throw new DomainError('That employee is not active.');

  // Membership carries a matching project-scoped role so access follows the team sheet.
  const roleKey = role === 'MANAGER' ? 'PROJECT_MANAGER' : role === 'OBSERVER' ? 'VIEWER' : gradeToRoleKey(user.grade);
  const rbacRole = await prisma.role.findUnique({ where: { key: roleKey }, select: { id: true } });

  return prisma.$transaction(async (tx) => {
    const member = await tx.projectMember.upsert({
      where: { projectId_userId: { projectId, userId } },
      create: { projectId, userId, role, allocationPercent },
      update: { role, allocationPercent },
    });

    if (rbacRole) {
      await tx.roleAssignment.upsert({
        where: {
          userId_roleId_scopeType_scopeId: { userId, roleId: rbacRole.id, scopeType: 'PROJECT', scopeId: projectId },
        },
        create: { userId, roleId: rbacRole.id, scopeType: 'PROJECT', scopeId: projectId, grantedBy: principal.userId },
        update: {},
      });
    }

    await audit(
      {
        actorId: principal.userId,
        module: 'pm',
        action: 'project.member.added',
        entityType: 'Project',
        entityId: projectId,
        diff: { userId, role },
      },
      tx,
    );

    await notify(
      {
        userIds: [userId],
        title: 'Added to a project',
        body: `${principal.fullName} added you to a project as ${role.toLowerCase()}.`,
        link: `/pm/projects/${projectId}`,
      },
      tx,
    );

    return member;
  });
}

export async function removeProjectMember(principal: Principal, projectId: string, userId: string) {
  const project = await assertProjectPermission(principal, projectId, 'pm.project.member.manage');
  if (project.managerId === userId) throw new DomainError('Reassign the project manager before removing them.');

  const openWork = await prisma.taskAssignment.count({
    where: { userId, status: 'ACTIVE', task: { projectId, status: { notIn: ['COMPLETED', 'CANCELLED'] } } },
  });
  if (openWork > 0) {
    throw new DomainError(`They still hold ${openWork} open task(s). Hand those over or reassign them first.`);
  }

  await prisma.$transaction(async (tx) => {
    await tx.projectMember.deleteMany({ where: { projectId, userId } });
    await tx.roleAssignment.deleteMany({ where: { userId, scopeType: 'PROJECT', scopeId: projectId } });
    await audit(
      {
        actorId: principal.userId,
        module: 'pm',
        action: 'project.member.removed',
        entityType: 'Project',
        entityId: projectId,
        diff: { userId },
      },
      tx,
    );
  });
}

/**
 * Bulk reassign all tasks in a project from one member to another.
 */
export async function reassignAllMemberTasks(
  principal: Principal,
  projectId: string,
  fromUserId: string,
  toUserId: string,
) {
  if (fromUserId === toUserId) {
    throw new DomainError('Cannot reassign tasks to the same member.');
  }

  await assertProjectPermission(principal, projectId, 'pm.project.member.manage');

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, managerId: true },
  });
  if (!project) throw new NotFoundError('Project not found.');

  if (fromUserId === project.managerId) {
    throw new DomainError('Cannot bulk-reassign the Project Manager. Use the Project Handover flow instead.');
  }

  const [toUser, fromUser] = await Promise.all([
    prisma.user.findFirst({ where: { id: toUserId, companyId: principal.companyId, status: 'ACTIVE' } }),
    prisma.user.findFirst({ where: { id: fromUserId, companyId: principal.companyId } }),
  ]);

  if (!toUser) throw new DomainError('Target colleague is not an active employee.');
  if (!fromUser) throw new DomainError('Source member not found.');

  const isMember = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId: toUserId } },
  });

  return prisma.$transaction(async (tx) => {
    if (!isMember) {
      await tx.projectMember.create({
        data: { projectId, userId: toUserId, role: 'ENGINEER', allocationPercent: 100 },
      });
    }

    const assignments = await tx.taskAssignment.findMany({
      where: {
        userId: fromUserId,
        status: 'ACTIVE',
        task: { projectId, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
      },
      select: { id: true, taskId: true, role: true },
    });

    let count = 0;
    for (const assignment of assignments) {
      await tx.taskAssignment.update({
        where: { id: assignment.id },
        data: { status: 'RELEASED', releasedAt: new Date() },
      });

      const existing = await tx.taskAssignment.findFirst({
        where: { taskId: assignment.taskId, userId: toUserId, role: assignment.role, status: 'ACTIVE' },
      });

      if (!existing) {
        await tx.taskAssignment.create({
          data: {
            taskId: assignment.taskId,
            userId: toUserId,
            role: assignment.role,
            status: 'ACTIVE',
          },
        });
      }
      count++;
    }

    // If fromUser is not the Project Manager, remove them from projectMember if 0 active tasks left
    const remaining = await tx.taskAssignment.count({
      where: { userId: fromUserId, task: { projectId }, status: 'ACTIVE' },
    });
    if (remaining === 0) {
      await tx.projectMember.deleteMany({
        where: { projectId, userId: fromUserId, role: { not: 'MANAGER' } },
      });
    }

    await audit(
      {
        actorId: principal.userId,
        module: 'pm',
        action: 'project.tasks.bulk_reassigned',
        entityType: 'Project',
        entityId: projectId,
        diff: { fromUserId, toUserId, taskCount: count },
      },
      tx,
    );

    await notify(
      {
        userIds: [toUserId],
        title: 'Project tasks assigned',
        body: `${formatName(principal.fullName)} reassigned ${count} task(s) on "${project.name}" to you.`,
        link: `/pm/projects/${projectId}`,
      },
      tx,
    );

    return { reassignedCount: count };
  });
}

function gradeToRoleKey(grade: string): string {
  switch (grade) {
    case 'TRAINEE':
    case 'JUNIOR_ENGINEER':
      return 'JUNIOR_ENGINEER';
    case 'MANAGER':
    case 'HEAD':
    case 'DIRECTOR':
      return 'PROJECT_MANAGER';
    default:
      return 'SENIOR_ENGINEER';
  }
}

/**
 * Final Step Gate: Mark project as COMPLETED and dispatch automated notification to the Department Head.
 */
export async function completeAutomationProject(principal: Principal, projectId: string) {
  await assertProjectPermission(principal, projectId, 'pm.project.update');

  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    include: {
      manager: { select: { id: true, fullName: true } },
    },
  });

  const updated = await prisma.$transaction(async (tx) => {
    const res = await tx.project.update({
      where: { id: projectId },
      data: {
        status: 'COMPLETED',
        actualEndDate: new Date(),
      },
    });

    // Notify Department Heads and Sponsor
    const heads = await tx.user.findMany({
      where: {
        companyId: principal.companyId,
        status: 'ACTIVE',
        OR: [
          ...(project.sponsorId ? [{ id: project.sponsorId }] : []),
          { roleAssignments: { some: { role: { key: 'DEPARTMENT_HEAD' } } } },
        ],
      },
      select: { id: true },
    });

    await notify(
      {
        userIds: heads.map((h) => h.id),
        title: `Project Completed: ${project.name}`,
        body: `PM ${project.manager ? formatName(project.manager.fullName) : 'Unassigned'} marked project "${project.name}" as COMPLETED and ready for review.`,
        link: `/pm/projects/${projectId}`,
      },
      tx,
    );

    await audit(
      {
        actorId: principal.userId,
        module: 'pm',
        action: 'project.completed',
        entityType: 'Project',
        entityId: projectId,
        diff: { status: 'COMPLETED', completedBy: formatName(principal.fullName) },
      },
      tx,
    );

    return res;
  });

  return updated;
}

export async function getProjectTimeline(principal: Principal, projectId: string) {
  await assertProjectVisible(principal, projectId);

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      code: true,
      name: true,
      clientName: true,
      startDate: true,
      targetEndDate: true,
      status: true,
      manager: { select: { id: true, fullName: true, avatarColor: true } },
      tasks: {
        where: { status: { not: 'CANCELLED' } },
        select: {
          id: true,
          code: true,
          title: true,
          status: true,
          percentComplete: true,
          parentId: true,
          type: true,
          plannedStart: true,
          plannedEnd: true,
          submittedAt: true,
          completedAt: true,
          completedBy: { select: { id: true, fullName: true } },
          assignments: {
            where: { status: 'ACTIVE' },
            select: { user: { select: { id: true, fullName: true, avatarColor: true } } },
          },
        },
        orderBy: [{ parentId: 'asc' }, { code: 'asc' }],
      },
    },
  });

  if (!project) throw new NotFoundError('Project not found');

  const phaseTasks = project.tasks.filter((t) => t.type === 'PHASE' || (project.tasks.some((c) => c.parentId === t.id) && !t.parentId));
  const leafTasks = activeLeafTasks(project.tasks);

  const today = todayInIndia();
  const latestLeafEnd = forecastFinish(leafTasks, project.targetEndDate ?? today, today);

  const mapStep = (t: (typeof leafTasks)[number], idx: number) => ({
    taskId: t.id,
    stepNumber: idx + 1,
    code: t.code,
    title: t.title,
    status: t.status,
    plannedStart: t.plannedStart,
    plannedEnd: t.plannedEnd,
    submittedAt: t.submittedAt,
    completedAt: t.completedAt,
    completedBy: t.completedBy ? { id: t.completedBy.id, fullName: t.completedBy.fullName } : null,
    assignee: t.assignments[0]?.user ?? null,
  });

  const lanes = [];

  if (phaseTasks.length > 0) {
    const phaseIds = new Set(phaseTasks.map((p) => p.id));
    for (const phase of phaseTasks) {
      const steps = leafTasks.filter((t) => t.parentId === phase.id);
      const deliveryDate = phase.plannedEnd ?? project.targetEndDate ?? null;
      lanes.push({
        id: phase.id,
        name: phase.title,
        deliveryDate,
        isLate: isLaneLate(steps, deliveryDate, today),
        steps: steps.map(mapStep),
      });
    }

    const otherTasks = leafTasks.filter((t) => !t.parentId || !phaseIds.has(t.parentId));
    if (otherTasks.length > 0) {
      const deliveryDate = project.targetEndDate ?? null;
      lanes.push({
        id: 'other',
        name: 'Other tasks',
        deliveryDate,
        isLate: isLaneLate(otherTasks, deliveryDate, today),
        steps: otherTasks.map(mapStep),
      });
    }
  } else {
    const deliveryDate = project.targetEndDate ?? null;
    lanes.push({
      id: 'default',
      name: 'Deliverables',
      deliveryDate,
      isLate: isLaneLate(leafTasks, deliveryDate, today),
      steps: leafTasks.map(mapStep),
    });
  }

  const totalSteps = leafTasks.length;
  const completedSteps = leafTasks.filter((s) => s.status === 'COMPLETED').length;

  return {
    projectId: project.id,
    projectName: project.name,
    projectCode: project.code,
    clientName: project.clientName,
    status: project.status,
    manager: project.manager,
    startDate: project.startDate,
    targetEndDate: project.targetEndDate,
    forecastEndDate: latestLeafEnd,
    totalSteps,
    completedSteps,
    lanes,
  };
}

export interface QuickFindResult {
  projects: Array<{
    id: string;
    code: string;
    name: string;
    clientName: string;
    status: string;
  }>;
  tasks: Array<{
    id: string;
    code: string;
    title: string;
    status: string;
    projectName: string;
  }>;
}

export async function quickFind(principal: Principal, query: string): Promise<QuickFindResult> {
  const q = query.trim();
  if (q.length < 2) {
    return { projects: [], tasks: [] };
  }

  const [projects, tasks] = await Promise.all([
    prisma.project.findMany({
      where: {
        AND: [
          projectVisibilityWhere(principal),
          {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { code: { contains: q, mode: 'insensitive' } },
              { clientName: { contains: q, mode: 'insensitive' } },
            ],
          },
        ],
      },
      select: {
        id: true,
        code: true,
        name: true,
        clientName: true,
        status: true,
      },
      take: 4,
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.task.findMany({
      where: {
        AND: [
          { project: projectVisibilityWhere(principal) },
          {
            OR: [
              { title: { contains: q, mode: 'insensitive' } },
              { code: { contains: q, mode: 'insensitive' } },
            ],
          },
        ],
      },
      select: {
        id: true,
        code: true,
        title: true,
        status: true,
        project: {
          select: { name: true },
        },
      },
      take: 4,
      orderBy: { updatedAt: 'desc' },
    }),
  ]);

  return {
    projects,
    tasks: tasks.map((t) => ({
      id: t.id,
      code: t.code,
      title: t.title,
      status: t.status,
      projectName: t.project.name,
    })),
  };
}

/**
 * Cancel a project (Director only).
 * Sets status to CANCELLED. Reversible via restoreProject.
 */
export async function cancelProject(principal: Principal, projectId: string) {
  const project = await assertProjectPermission(principal, projectId, 'pm.project.delete');
  if (project.status === 'CANCELLED') {
    throw new DomainError('Project is already cancelled.');
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.project.update({
      where: { id: projectId },
      data: { status: 'CANCELLED' },
    });

    await audit(
      {
        actorId: principal.userId,
        module: 'pm',
        action: 'pm.project.cancelled',
        entityType: 'Project',
        entityId: projectId,
        diff: { from: project.status, to: 'CANCELLED' },
      },
      tx,
    );

    await publish(
      {
        name: EVENTS.PROJECT_STATUS_CHANGED,
        module: 'pm',
        entityType: 'Project',
        entityId: projectId,
        actorId: principal.userId,
        payload: { from: project.status, to: 'CANCELLED', code: project.code },
      },
      tx,
    );

    return updated;
  });
}

/**
 * Restore a cancelled project back to PLANNING (Director only).
 */
export async function restoreProject(principal: Principal, projectId: string) {
  const project = await assertProjectPermission(principal, projectId, 'pm.project.delete');
  if (project.status !== 'CANCELLED') {
    throw new DomainError('Only cancelled projects can be restored.');
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.project.update({
      where: { id: projectId },
      data: { status: 'PLANNING' },
    });

    await audit(
      {
        actorId: principal.userId,
        module: 'pm',
        action: 'pm.project.restored',
        entityType: 'Project',
        entityId: projectId,
        diff: { from: 'CANCELLED', to: 'PLANNING' },
      },
      tx,
    );

    await publish(
      {
        name: EVENTS.PROJECT_STATUS_CHANGED,
        module: 'pm',
        entityType: 'Project',
        entityId: projectId,
        actorId: principal.userId,
        payload: { from: 'CANCELLED', to: 'PLANNING', code: project.code },
      },
      tx,
    );

    return updated;
  });
}

/**
 * Permanently delete a project (Director only, strictly guarded).
 *
 * Guard 1: Block delete if any progress log exists across tasks.
 * Guard 2: Type-to-confirm project code.
 * Guard 3: Audit before deleting in the same transaction.
 */
export async function deleteProject(principal: Principal, projectId: string, confirmationCode?: string) {
  await assertProjectPermission(principal, projectId, 'pm.project.delete');

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      _count: { select: { tasks: true } },
    },
  });
  if (!project) throw new NotFoundError('Project not found.');

  // Guard 2: Type-to-confirm project code
  if (confirmationCode !== undefined && confirmationCode.trim() !== project.code.trim()) {
    throw new DomainError(`Confirmation code does not match "${project.code}".`);
  }

  // Guard 1: Block delete if any real work has been recorded.
  const [progressLogCount, commissioningLogCount] = await Promise.all([
    prisma.taskProgressLog.count({
      where: { task: { projectId } },
    }),
    prisma.commissioningLog.count({
      where: { projectId },
    }),
  ]);

  if (progressLogCount > 0 || commissioningLogCount > 0) {
    throw new DomainError(
      'Cannot delete project with recorded progress logs. Please cancel the project instead to preserve history.',
    );
  }

  return prisma.$transaction(async (tx) => {
    // Guard 3: Audit inside the same transaction BEFORE deleting.
    await audit(
      {
        actorId: principal.userId,
        module: 'pm',
        action: 'pm.project.deleted',
        entityType: 'Project',
        entityId: projectId,
        diff: {
          code: project.code,
          name: project.name,
          clientName: project.clientName,
          workOrderNo: project.workOrderNo,
          taskCount: project._count.tasks,
        },
      },
      tx,
    );

    // Clean up scoped role assignments for this project
    await tx.roleAssignment.deleteMany({
      where: { scopeType: 'PROJECT', scopeId: projectId },
    });

    // Clean up notifications pointing to this project or its tasks
    const tasks = await tx.task.findMany({
      where: { projectId },
      select: { id: true },
    });
    const taskLinks = tasks.map((t) => `/pm/tasks/${t.id}`);
    const projectLinkPrefix = `/pm/projects/${projectId}`;

    await tx.notification.deleteMany({
      where: {
        OR: [
          { link: { startsWith: projectLinkPrefix } },
          ...(taskLinks.length > 0 ? [{ link: { in: taskLinks } }] : []),
        ],
      },
    });

    // Delete project (cascades to members, tasks, assignments, dependencies, handovers, etc.)
    await tx.project.delete({
      where: { id: projectId },
    });

    return { success: true, code: project.code };
  });
}

