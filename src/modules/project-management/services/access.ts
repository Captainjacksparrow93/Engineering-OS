import type { Prisma } from '@prisma/client';
import { prisma } from '@/core/db/prisma';
import { can } from '@/core/rbac/engine';
import { ForbiddenError, NotFoundError } from '@/core/rbac/errors';
import type { PermissionKey } from '@/core/rbac/permissions';
import type { Principal } from '@/core/rbac/types';

/**
 * Scoping rules for the Project Management module.
 *
 * There are two separate questions and they are answered separately on purpose:
 *   - "Which projects may this person SEE?"  -> `projectVisibilityWhere`
 *   - "May this person DO x on project y?"   -> `assertProjectPermission`
 *
 * Visibility is intentionally generous (you can see what you are attached to);
 * mutation is intentionally strict (you need the permission at a covering scope).
 */

export function projectVisibilityWhere(principal: Principal): Prisma.ProjectWhereInput {
  // Directors and admins: everything in their company.
  if (can(principal, 'pm.project.read.all')) {
    return { companyId: principal.companyId };
  }

  const departmentIds = principal.coveredDepartmentIds;
  const projectIds = principal.memberProjectIds;

  const clauses: Prisma.ProjectWhereInput[] = [
    { managerId: principal.userId },
    { sponsorId: principal.userId },
    { members: { some: { userId: principal.userId } } },
    { tasks: { some: { assignments: { some: { userId: principal.userId } } } } },
  ];
  if (projectIds.length) clauses.push({ id: { in: projectIds } });
  if (departmentIds.length) clauses.push({ departmentId: { in: departmentIds } });

  return { companyId: principal.companyId, OR: clauses };
}

export interface ProjectContext {
  id: string;
  code: string;
  name: string;
  companyId: string;
  departmentId: string | null;
  managerId: string;
  sponsorId: string | null;
  status: string;
}

export async function loadProjectContext(projectId: string): Promise<ProjectContext> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      code: true,
      name: true,
      companyId: true,
      departmentId: true,
      managerId: true,
      sponsorId: true,
      status: true,
    },
  });
  if (!project) throw new NotFoundError('Project not found.');
  return project;
}

/**
 * The single choke point for project-scoped authorisation.
 *
 * The scope passed to the RBAC engine carries BOTH the project id and the project's
 * department, so a department head's DEPARTMENT-scoped grant and a project manager's
 * PROJECT-scoped grant both resolve here without special-casing either.
 */
export async function assertProjectPermission(
  principal: Principal,
  projectId: string,
  permission: PermissionKey,
): Promise<ProjectContext> {
  const project = await loadProjectContext(projectId);
  if (project.companyId !== principal.companyId) throw new NotFoundError('Project not found.');

  const allowed =
    can(principal, permission, { projectId: project.id, departmentId: project.departmentId }) ||
    // The manager of a project always holds the project's own permissions; otherwise
    // handing someone a project would require a separate grant every single time.
    (project.managerId === principal.userId && MANAGER_IMPLIED.has(permission));

  if (!allowed) throw new ForbiddenError(`You cannot perform "${permission}" on project ${project.code}.`);
  return project;
}

/** Permissions the project manager holds by virtue of being the manager. */
const MANAGER_IMPLIED = new Set<PermissionKey>([
  'pm.project.read',
  'pm.project.update',
  'pm.project.member.manage',
  'pm.task.read',
  'pm.task.create',
  'pm.task.update',
  'pm.task.delete',
  'pm.task.assign',
  'pm.task.adhoc.create',
  'pm.task.dependency.manage',
  'pm.progress.review',
  'pm.handover.override',
  'pm.resource.read',
  'pm.report.read',
]);

export async function assertProjectVisible(principal: Principal, projectId: string): Promise<ProjectContext> {
  const project = await loadProjectContext(projectId);
  if (project.companyId !== principal.companyId) throw new NotFoundError('Project not found.');

  if (can(principal, 'pm.project.read.all')) return project;
  if (project.managerId === principal.userId || project.sponsorId === principal.userId) return project;
  if (principal.memberProjectIds.includes(project.id)) return project;
  if (project.departmentId && principal.coveredDepartmentIds.includes(project.departmentId)) return project;

  const assigned = await prisma.taskAssignment.count({
    where: { userId: principal.userId, task: { projectId } },
  });
  if (assigned > 0) return project;

  throw new NotFoundError('Project not found.');
}

export interface TaskContext {
  id: string;
  code: string;
  title: string;
  projectId: string;
  status: string;
  project: ProjectContext;
  assigneeIds: string[];
  ownerId: string | null;
}

export async function loadTaskContext(taskId: string): Promise<TaskContext> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      code: true,
      title: true,
      projectId: true,
      status: true,
      assignments: { where: { status: 'ACTIVE' }, select: { userId: true, role: true } },
      project: {
        select: {
          id: true,
          code: true,
          name: true,
          companyId: true,
          departmentId: true,
          managerId: true,
          sponsorId: true,
          status: true,
        },
      },
    },
  });
  if (!task) throw new NotFoundError('Task not found.');

  return {
    id: task.id,
    code: task.code,
    title: task.title,
    projectId: task.projectId,
    status: task.status,
    project: task.project,
    assigneeIds: task.assignments.map((a) => a.userId),
    ownerId: task.assignments.find((a) => a.role === 'OWNER')?.userId ?? null,
  };
}

/**
 * Relationship-based access: whoever actually holds the task can always read it and
 * punch in progress on it, even without a project-scoped grant. Without this rule an
 * ad-hoc task handed to an engineer outside the project team would be invisible to them.
 */
export function isHolderOfTask(principal: Principal, task: TaskContext): boolean {
  return task.assigneeIds.includes(principal.userId);
}

export async function assertTaskVisible(principal: Principal, taskId: string): Promise<TaskContext> {
  const task = await loadTaskContext(taskId);
  if (task.project.companyId !== principal.companyId) throw new NotFoundError('Task not found.');
  if (isHolderOfTask(principal, task)) return task;
  await assertProjectVisible(principal, task.projectId);
  return task;
}

/**
 * Mutating a task: the project permission, OR the holder rule for the narrow set of
 * actions a holder is trusted with on their own work.
 */
export async function assertTaskPermission(
  principal: Principal,
  taskId: string,
  permission: PermissionKey,
): Promise<TaskContext> {
  const task = await loadTaskContext(taskId);
  if (task.project.companyId !== principal.companyId) throw new NotFoundError('Task not found.');

  const holderMayDoThis = HOLDER_IMPLIED.has(permission) && isHolderOfTask(principal, task);
  if (holderMayDoThis) return task;

  await assertProjectPermission(principal, task.projectId, permission);
  return task;
}

/** What the person holding a task may do on it without any project-scoped grant. */
const HOLDER_IMPLIED = new Set<PermissionKey>(['pm.task.read', 'pm.progress.log', 'pm.handover.request']);
