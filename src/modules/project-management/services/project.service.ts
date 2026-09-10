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
import type { CreateProjectInput } from '../validation/schemas';
import { computeSchedule, rollUpProgress, type Graph } from '../domain/scheduling';

/**
 * Project lifecycle.
 *
 * Creating a project does three things atomically: the project row, the manager's
 * membership, and a PROJECT-scoped role assignment. That last one is what makes the
 * permission model work in practice - the manager gets rights on THIS project only,
 * without anyone editing a global role.
 */
export async function createProject(principal: Principal, input: CreateProjectInput) {
  // Department heads may create projects inside their department; directors anywhere.
  assertCan(principal, 'pm.project.create', { departmentId: input.departmentId ?? principal.departmentId });

  const manager = await prisma.user.findFirst({
    where: { id: input.managerId, companyId: principal.companyId, status: 'ACTIVE' },
    select: { id: true, fullName: true, departmentId: true },
  });
  if (!manager) throw new DomainError('The selected project manager is not an active employee.');

  const code = input.code ?? (await nextProjectCode(principal.companyId));
  const existing = await prisma.project.findUnique({ where: { code } });
  if (existing) throw new DomainError(`Project code ${code} is already in use.`);

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
        description: input.description,
        clientName: input.clientName,
        poNumber: input.poNumber,
        orderValue: input.orderValue ?? null,
        panelType: input.panelType,
        panelCount: input.panelCount,
        priority: input.priority,
        status: input.status,
        startDate: input.startDate ?? null,
        targetEndDate: input.targetEndDate ?? null,
        managerId: manager.id,
        sponsorId: input.sponsorId || principal.userId,
        departmentId: input.departmentId || manager.departmentId,
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
          title: `You are managing ${created.code}`,
          body: `${principal.fullName} assigned you as project manager for "${created.name}".`,
          link: `/pm/projects/${created.id}`,
        },
        tx,
      );
    }

    return created;
  });

  return project;
}

/** Generates PRJ-YYYY-NNN, scoped per company per year. */
async function nextProjectCode(companyId: string): Promise<string> {
  const year = new Date().getUTCFullYear();
  const prefix = `PRJ-${year}-`;
  const last = await prisma.project.findFirst({
    where: { companyId, code: { startsWith: prefix } },
    orderBy: { code: 'desc' },
    select: { code: true },
  });
  const sequence = last ? Number.parseInt(last.code.slice(prefix.length), 10) + 1 : 1;
  return `${prefix}${String(sequence).padStart(3, '0')}`;
}

export async function updateProject(
  principal: Principal,
  projectId: string,
  input: Partial<CreateProjectInput>,
) {
  await assertProjectPermission(principal, projectId, 'pm.project.update');
  const before = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });

  const data = {
    name: input.name,
    description: input.description,
    clientName: input.clientName,
    poNumber: input.poNumber,
    orderValue: input.orderValue,
    panelType: input.panelType,
    panelCount: input.panelCount,
    priority: input.priority,
    status: input.status,
    startDate: input.startDate,
    targetEndDate: input.targetEndDate,
    managerId: input.managerId,
    sponsorId: input.sponsorId,
    departmentId: input.departmentId,
  };

  const statusChanged = input.status && input.status !== before.status;

  return prisma.$transaction(async (tx) => {
    const updated = await tx.project.update({
      where: { id: projectId },
      data: {
        ...data,
        actualEndDate: input.status === 'COMPLETED' ? new Date() : before.actualEndDate,
      },
    });

    await audit(
      {
        actorId: principal.userId,
        module: 'pm',
        action: 'project.updated',
        entityType: 'Project',
        entityId: projectId,
        diff: diffOf(before as unknown as Record<string, unknown>, data as Record<string, unknown>),
      },
      tx,
    );

    if (statusChanged) {
      await publish(
        {
          name: EVENTS.PROJECT_STATUS_CHANGED,
          module: 'pm',
          entityType: 'Project',
          entityId: projectId,
          actorId: principal.userId,
          payload: { from: before.status, to: updated.status, code: updated.code },
        },
        tx,
      );
    }
    return updated;
  });
}

export interface ProjectListFilters {
  status?: string;
  search?: string;
  managerId?: string;
  mine?: boolean;
}

export async function listProjects(principal: Principal, filters: ProjectListFilters = {}) {
  const where = projectVisibilityWhere(principal);

  const projects = await prisma.project.findMany({
    where: {
      ...where,
      ...(filters.status ? { status: filters.status as never } : {}),
      ...(filters.managerId ? { managerId: filters.managerId } : {}),
      ...(filters.mine ? { OR: [{ managerId: principal.userId }, { members: { some: { userId: principal.userId } } }] } : {}),
      ...(filters.search
        ? {
            OR: [
              { name: { contains: filters.search, mode: 'insensitive' as const } },
              { code: { contains: filters.search, mode: 'insensitive' as const } },
              { clientName: { contains: filters.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    },
    orderBy: [{ priority: 'desc' }, { targetEndDate: 'asc' }],
    include: {
      manager: { select: { id: true, fullName: true, avatarColor: true } },
      _count: { select: { tasks: true, members: true } },
    },
  });

  // One grouped query instead of N per-project counts.
  const stats = await prisma.task.groupBy({
    by: ['projectId', 'status'],
    where: { projectId: { in: projects.map((p) => p.id) } },
    _count: { _all: true },
    _sum: { estimatedHours: true, actualHours: true },
  });

  return projects.map((project) => {
    const rows = stats.filter((s) => s.projectId === project.id);
    const total = rows.reduce((sum, r) => sum + r._count._all, 0);
    const completed = rows.filter((r) => r.status === 'COMPLETED').reduce((sum, r) => sum + r._count._all, 0);
    const blocked = rows.filter((r) => r.status === 'BLOCKED').reduce((sum, r) => sum + r._count._all, 0);
    const estimated = rows.reduce((sum, r) => sum + (r._sum.estimatedHours ?? 0), 0);
    const actual = rows.reduce((sum, r) => sum + (r._sum.actualHours ?? 0), 0);
    return {
      ...project,
      orderValue: project.orderValue ? Number(project.orderValue) : null,
      stats: {
        taskCount: total,
        completedCount: completed,
        blockedCount: blocked,
        estimatedHours: Math.round(estimated),
        actualHours: Math.round(actual),
        progressPercent: total === 0 ? 0 : Math.round((completed / total) * 100),
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
        where: { status: 'ACTIVE' },
        include: { user: { select: { id: true, fullName: true, avatarColor: true } } },
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
      status: t.status,
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
    // A cycle should be impossible (insert-time detection), but the workspace must
    // still render so somebody can go in and break the loop.
    scheduleError = error instanceof Error ? error.message : 'Schedule could not be computed.';
  }

  const rollup = rollUpProgress(graph.tasks);
  const openTasks = tasks.filter((t) => !['COMPLETED', 'CANCELLED'].includes(t.status));
  const estimatedHours = tasks.reduce((sum, t) => sum + t.estimatedHours, 0);
  const actualHours = tasks.reduce((sum, t) => sum + t.actualHours, 0);

  return {
    project: { ...project, orderValue: project.orderValue ? Number(project.orderValue) : null },
    tasks: tasks.map((t) => ({
      ...t,
      rolledUpPercent: rollup.get(t.id) ?? t.percentComplete,
      schedule: schedule.find((s) => s.taskId === t.id) ?? null,
    })),
    dependencies,
    schedule,
    scheduleError,
    criticalTaskIds: schedule.filter((s) => s.isCritical).map((s) => s.taskId),
    summary: {
      taskCount: tasks.length,
      openCount: openTasks.length,
      blockedCount: tasks.filter((t) => t.status === 'BLOCKED').length,
      completedCount: tasks.filter((t) => t.status === 'COMPLETED').length,
      overdueCount: openTasks.filter((t) => t.plannedEnd && t.plannedEnd < new Date()).length,
      estimatedHours: Math.round(estimatedHours),
      actualHours: Math.round(actualHours),
      progressPercent: tasks.length === 0 ? 0 : Math.round(
        tasks.reduce((sum, t) => sum + (rollup.get(t.id) ?? 0) * t.estimatedHours, 0) /
          Math.max(1, estimatedHours),
      ),
    },
    permissions: {
      canCreateTask: can(principal, 'pm.task.create', { projectId, departmentId: project.departmentId }) || project.managerId === principal.userId,
      canAssign: can(principal, 'pm.task.assign', { projectId, departmentId: project.departmentId }) || project.managerId === principal.userId,
      canManageDependencies:
        can(principal, 'pm.task.dependency.manage', { projectId, departmentId: project.departmentId }) || project.managerId === principal.userId,
      canEditProject: can(principal, 'pm.project.update', { projectId, departmentId: project.departmentId }) || project.managerId === principal.userId,
      canManageMembers:
        can(principal, 'pm.project.member.manage', { projectId, departmentId: project.departmentId }) || project.managerId === principal.userId,
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
