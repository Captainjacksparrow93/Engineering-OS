import type { Prisma } from '@prisma/client';
import { prisma } from '@/core/db/prisma';
import { assertCan } from '@/core/rbac/guard';
import { can, hasPermissionAnywhere } from '@/core/rbac/engine';
import { ForbiddenError } from '@/core/rbac/errors';
import type { Principal } from '@/core/rbac/types';
import { addDays, startOfDay } from '@/core/utils/dates';
import {
  computeWorkload,
  rankCandidates,
  type AssignmentSuggestion,
  type CapacityWindow,
  type Workload,
  type WorkloadAssignment,
} from '../domain/availability';

/**
 * The resource board.
 *
 * This is the answer to "an urgent job just came in - who can take it?". It loads
 * everyone in scope with their open assignments and approved leave, and computes
 * capacity in one pass rather than per-person queries.
 */

export interface AvailabilityQuery {
  from?: Date;
  to?: Date;
  departmentId?: string;
  skills?: string[];
  requiredHours?: number;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  /** Restrict to a project's team. Omit to look across the whole department/company. */
  projectId?: string;
}

export function defaultWindow(): CapacityWindow {
  const from = startOfDay(new Date());
  return { from, to: addDays(from, 13) }; // Two weeks - the horizon managers plan on.
}

export async function getWorkloads(principal: Principal, query: AvailabilityQuery = {}): Promise<Workload[]> {
  // The permission check is about capability, not reach: holding `pm.resource.read`
  // anywhere lets you open the board, and `visibilityFilter` below decides whose load
  // you actually see. A project manager holds it at PROJECT scope and would fail a
  // department-scoped check even for their own team, which is why this is split.
  if (query.departmentId) {
    assertCan(principal, 'pm.resource.read', { departmentId: query.departmentId });
  } else if (!hasPermissionAnywhere(principal, 'pm.resource.read')) {
    throw new ForbiddenError('You do not have access to resource availability.');
  }

  const window: CapacityWindow = {
    from: query.from ? startOfDay(query.from) : defaultWindow().from,
    to: query.to ? startOfDay(query.to) : defaultWindow().to,
  };

  const people = await prisma.user.findMany({
    where: {
      companyId: principal.companyId,
      status: 'ACTIVE',
      ...visibilityFilter(principal, query),
      ...(query.projectId ? { projectMembers: { some: { projectId: query.projectId } } } : {}),
      ...(query.skills?.length ? { skills: { hasSome: query.skills } } : {}),
    },
    select: {
      id: true,
      fullName: true,
      employeeCode: true,
      grade: true,
      designation: true,
      departmentId: true,
      skills: true,
      dailyCapacityHours: true,
      avatarColor: true,
      department: { select: { name: true } },
    },
    orderBy: { fullName: 'asc' },
  });

  const userIds = people.map((p) => p.id);
  if (userIds.length === 0) return [];

  const [assignments, leaves] = await Promise.all([
    prisma.taskAssignment.findMany({
      where: {
        userId: { in: userIds },
        status: 'ACTIVE',
        task: { status: { notIn: ['COMPLETED', 'CANCELLED'] } },
      },
      select: {
        userId: true,
        allocatedHours: true,
        task: {
          select: {
            id: true,
            code: true,
            title: true,
            status: true,
            priority: true,
            percentComplete: true,
            plannedStart: true,
            plannedEnd: true,
            project: { select: { id: true, code: true } },
          },
        },
      },
    }),
    prisma.leave.findMany({
      where: {
        userId: { in: userIds },
        status: 'APPROVED',
        startDate: { lte: window.to },
        endDate: { gte: window.from },
      },
      select: { userId: true, startDate: true, endDate: true },
    }),
  ]);

  return people.map((person) => {
    const personAssignments: WorkloadAssignment[] = assignments
      .filter((a) => a.userId === person.id)
      .map((a) => ({
        taskId: a.task.id,
        taskCode: a.task.code,
        taskTitle: a.task.title,
        projectId: a.task.project.id,
        projectCode: a.task.project.code,
        priority: a.task.priority,
        status: a.task.status,
        allocatedHours: a.allocatedHours || 0,
        percentComplete: a.task.percentComplete,
        plannedStart: a.task.plannedStart,
        plannedEnd: a.task.plannedEnd,
      }));

    return computeWorkload(
      {
        id: person.id,
        fullName: person.fullName,
        employeeCode: person.employeeCode,
        grade: person.grade,
        designation: person.designation,
        departmentId: person.departmentId,
        departmentName: person.department?.name ?? null,
        skills: person.skills,
        dailyCapacityHours: person.dailyCapacityHours,
        avatarColor: person.avatarColor,
      },
      personAssignments,
      leaves.filter((l) => l.userId === person.id),
      window,
    );
  });
}

/**
 * Whose workload this principal may look at.
 *
 * Three sources, OR-ed together, because department is not the only reason someone is
 * your concern: a project manager running a cross-functional job must see the load of
 * the electrical and mechanical engineers on it, even though neither reports to them.
 *
 *   1. An explicit department filter, when the caller asked for one.
 *   2. Departments they cover (their own, plus any DEPARTMENT-scoped grant's subtree).
 *   3. Members of projects they hold a project-scoped role on or belong to.
 *
 * Company-wide resource rights (directors, PMO heads) skip the filter entirely.
 */
function visibilityFilter(principal: Principal, query: AvailabilityQuery): Prisma.UserWhereInput {
  if (query.departmentId) return { departmentId: query.departmentId };

  const seesEveryone = can(principal, 'pm.resource.read', {}) && can(principal, 'pm.project.read.all');
  if (seesEveryone) return {};

  const departmentIds = [...new Set([...principal.coveredDepartmentIds, principal.departmentId].filter(Boolean))] as string[];
  const clauses: Prisma.UserWhereInput[] = [];
  if (departmentIds.length) clauses.push({ departmentId: { in: departmentIds } });
  if (principal.memberProjectIds.length) {
    clauses.push({ projectMembers: { some: { projectId: { in: principal.memberProjectIds } } } });
  }

  // Somebody with no department and no projects sees only themselves.
  return clauses.length ? { OR: clauses } : { id: principal.userId };
}

/**
 * Ranked candidates for a specific piece of work. This is what the ad-hoc task form
 * calls so the manager sees "who should take this" instead of a flat list of names.
 */
export async function suggestAssignees(
  principal: Principal,
  query: AvailabilityQuery & { excludeUserIds?: string[] } = {},
): Promise<AssignmentSuggestion[]> {
  const workloads = await getWorkloads(principal, query);
  const filtered = workloads.filter((w) => !(query.excludeUserIds ?? []).includes(w.person.id));
  return rankCandidates(filtered, {
    requiredSkills: query.skills,
    requiredHours: query.requiredHours,
    priority: query.priority,
  });
}

/** Peers a person may hand work to: same department first, then anyone on the project. */
export async function handoverCandidates(principal: Principal, taskId: string) {
  const task = await prisma.task.findUniqueOrThrow({
    where: { id: taskId },
    select: {
      id: true,
      estimatedHours: true,
      percentComplete: true,
      priority: true,
      requiredSkills: true,
      projectId: true,
      assignments: { where: { status: 'ACTIVE' }, select: { userId: true } },
    },
  });

  const remainingHours = task.estimatedHours * (1 - task.percentComplete / 100);
  const excludeUserIds = task.assignments.map((a) => a.userId);

  const [projectPeers, departmentPeers] = await Promise.all([
    safeSuggest(principal, {
      projectId: task.projectId,
      skills: task.requiredSkills,
      requiredHours: remainingHours,
      priority: task.priority,
      excludeUserIds,
    }),
    safeSuggest(principal, {
      departmentId: principal.departmentId ?? undefined,
      skills: task.requiredSkills,
      requiredHours: remainingHours,
      priority: task.priority,
      excludeUserIds,
    }),
  ]);

  const seen = new Set<string>();
  const merged: AssignmentSuggestion[] = [];
  for (const suggestion of [...projectPeers, ...departmentPeers]) {
    if (seen.has(suggestion.workload.person.id)) continue;
    seen.add(suggestion.workload.person.id);
    merged.push(suggestion);
  }
  return merged.sort((a, b) => b.score - a.score);
}

/**
 * Junior engineers can raise a handover but do not hold `pm.resource.read`; they still
 * need to see who to pass work to, so a failed permission check degrades to an empty
 * list rather than breaking the page.
 */
async function safeSuggest(
  principal: Principal,
  query: AvailabilityQuery & { excludeUserIds?: string[] },
): Promise<AssignmentSuggestion[]> {
  try {
    return await suggestAssignees(principal, query);
  } catch {
    return [];
  }
}

/** Peers visible to someone without resource-read rights: their own project team. */
export async function peersForHandover(principal: Principal, taskId: string) {
  const task = await prisma.task.findUniqueOrThrow({
    where: { id: taskId },
    select: { projectId: true, assignments: { where: { status: 'ACTIVE' }, select: { userId: true } } },
  });
  const held = task.assignments.map((a) => a.userId);

  return prisma.user.findMany({
    where: {
      companyId: principal.companyId,
      status: 'ACTIVE',
      id: { notIn: [...held, principal.userId] },
      OR: [
        { projectMembers: { some: { projectId: task.projectId } } },
        ...(principal.departmentId ? [{ departmentId: principal.departmentId }] : []),
      ],
    },
    select: {
      id: true,
      fullName: true,
      employeeCode: true,
      designation: true,
      grade: true,
      avatarColor: true,
      skills: true,
      department: { select: { name: true } },
    },
    orderBy: { fullName: 'asc' },
    take: 100,
  });
}
