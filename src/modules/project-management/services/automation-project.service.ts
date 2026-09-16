import { prisma } from '@/core/db/prisma';
import { assertCan } from '@/core/rbac/guard';
import { hasPermissionAnywhere } from '@/core/rbac/engine';
import { DomainError, ForbiddenError } from '@/core/rbac/errors';
import type { Principal } from '@/core/rbac/types';
import { audit } from '@/core/audit/audit';
import { addDays, addWorkingDays, startOfDay } from '@/core/utils/dates';
import { recomputeTaskDerivedState } from './task.service';
import {
  allocateTeamForSteps,
  computeWorkload,
  type LeavePeriod,
  type SmartCandidate,
  type SmartStepRequirement,
  type WorkloadAssignment,
  type WorkloadPerson,
} from '../domain/availability';
import { generateWithGemini } from '@/core/ai/vertex';

export interface ScopeSelection {
  templateCode: string; // "PLC" | "SCADA" | "HMI"
  quantity: number;
}

export interface TaskAssignmentDraft {
  templateCode: string;
  unitIndex: number; // 1, 2, ...
  stepNumber: number;
  title: string;
  assigneeId?: string;
  plannedStart: string; // YYYY-MM-DD
  plannedEnd: string;   // YYYY-MM-DD
  durationDays: number;
  estimatedHours: number;
}

export interface CreateAutomationProjectInput {
  name: string;
  code?: string;
  clientName: string;
  poNumber?: string;
  orderValue?: number;
  targetEndDate?: string;
  startDate?: string;
  managerId: string;
  scopes: ScopeSelection[];
  tasks: TaskAssignmentDraft[];
}

/** Get all descendants of a manager in the org chart */
async function getDescendantUserIds(managerId: string): Promise<string[]> {
  const result: string[] = [];
  const queue = [managerId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const directReports = await prisma.user.findMany({
      where: { managerId: current, status: 'ACTIVE' },
      select: { id: true },
    });
    for (const r of directReports) {
      if (!result.includes(r.id)) {
        result.push(r.id);
        queue.push(r.id);
      }
    }
  }

  return result;
}

export async function getPMTeamData(companyId: string) {
  // Find PMs
  const managers = await prisma.user.findMany({
    where: {
      companyId,
      status: 'ACTIVE',
      department: { code: { in: ['TECH', 'DESIGN'] } },
      OR: [
        { fullName: { contains: 'Parth' } },
        { fullName: { contains: 'Paras' } },
        { designation: { contains: 'Project Manager' } },
        { grade: 'MANAGER' },
      ],
      NOT: [
        { designation: { contains: 'Director', mode: 'insensitive' } },
        { grade: 'DIRECTOR' },
      ],
    },
    select: { id: true, fullName: true, designation: true, grade: true, avatarColor: true },
    orderBy: { fullName: 'asc' },
  });

  // Map each PM to their team members
  const teamsByPM: Record<string, string[]> = {};
  for (const m of managers) {
    teamsByPM[m.id] = await getDescendantUserIds(m.id);
  }

  // All technical engineers grouped by seniority (strictly excluding Project Managers and Directors)
  const allEngineers = await prisma.user.findMany({
    where: {
      companyId,
      status: 'ACTIVE',
      grade: { notIn: ['MANAGER', 'HEAD', 'DIRECTOR'] },
      NOT: [
        { designation: { contains: 'Project Manager' } },
        { designation: { contains: 'Director', mode: 'insensitive' } },
        { grade: 'DIRECTOR' },
      ],
    },
    select: {
      id: true,
      fullName: true,
      designation: true,
      grade: true,
      avatarColor: true,
      managerId: true,
    },
    orderBy: [{ grade: 'asc' }, { fullName: 'asc' }],
  });

  return { managers, teamsByPM, allEngineers };
}

export async function createAutomationProject(principal: Principal, input: CreateAutomationProjectInput) {
  const manager = await prisma.user.findFirst({
    where: { id: input.managerId, companyId: principal.companyId, status: 'ACTIVE' },
    select: { id: true, fullName: true, departmentId: true },
  });
  if (!manager) throw new DomainError('Selected Project Manager not found or inactive.');

  assertCan(principal, 'pm.project.create', { departmentId: manager.departmentId ?? principal.departmentId });


  // Generate code if missing or sanitize provided code
  let code = input.code?.trim().toUpperCase();
  if (!code) {
    const count = await prisma.project.count({ where: { companyId: principal.companyId } });
    code = `ACS-PRJ-${String(count + 1).padStart(3, '0')}`;
  }

  const existing = await prisma.project.findUnique({ where: { code } });
  if (existing) throw new DomainError(`Project code ${code} is already in use.`);

  const start = input.startDate ? new Date(input.startDate) : new Date();
  const targetEnd = input.targetEndDate ? new Date(input.targetEndDate) : addWorkingDays(start, 45);

  const managerRole = await prisma.role.findUnique({ where: { key: 'PROJECT_MANAGER' }, select: { id: true } });

  const templates = await prisma.checklistTemplate.findMany({
    where: { isActive: true },
    include: { items: { orderBy: { stepNumber: 'asc' } } },
  });
  const templateMap = new Map(templates.map((t) => [t.code, t]));

  const createdProject = await prisma.$transaction(async (tx) => {
    // 1. Create Project
    const project = await tx.project.create({
      data: {
        companyId: principal.companyId,
        code,
        name: input.name,
        clientName: input.clientName,
        poNumber: input.poNumber ?? null,
        orderValue: input.orderValue ? Number(input.orderValue) : null,
        status: 'PLANNING',
        priority: 'MEDIUM',
        startDate: start,
        targetEndDate: targetEnd,
        managerId: manager.id,
        sponsorId: principal.userId,
        departmentId: manager.departmentId,
      },
    });

    // 2. Add PM as member
    await tx.projectMember.create({
      data: { projectId: project.id, userId: manager.id, role: 'MANAGER', allocationPercent: 100 },
    });

    if (managerRole) {
      await tx.roleAssignment.upsert({
        where: {
          userId_roleId_scopeType_scopeId: {
            userId: manager.id,
            roleId: managerRole.id,
            scopeType: 'PROJECT',
            scopeId: project.id,
          },
        },
        create: {
          userId: manager.id,
          roleId: managerRole.id,
          scopeType: 'PROJECT',
          scopeId: project.id,
          grantedBy: principal.userId,
        },
        update: {},
      });
    }

    // 3. Collect unique assigned engineers and add them as project members
    const assignedUserIds = new Set<string>();
    for (const t of input.tasks) {
      if (t.assigneeId && t.assigneeId !== manager.id) {
        assignedUserIds.add(t.assigneeId);
      }
    }

    for (const userId of assignedUserIds) {
      await tx.projectMember.create({
        data: { projectId: project.id, userId, role: 'ENGINEER', allocationPercent: 100 },
      });
    }

    // 4. Create WBS nodes and 13 tasks per scope unit
    let phaseCounter = 1;
    let globalTaskCounter = 1;

    for (const scope of input.scopes) {
      if (scope.quantity <= 0) continue;
      const tpl = templateMap.get(scope.templateCode);
      if (!tpl) continue;

      for (let u = 1; u <= scope.quantity; u++) {
        const unitName = scope.quantity > 1 ? `${tpl.code} ${u}` : tpl.code;
        const phaseCode = `${project.code}-PH${phaseCounter++}`;

        // Create Phase task (container node)
        const phaseTask = await tx.task.create({
          data: {
            projectId: project.id,
            code: phaseCode,
            title: `${unitName}: ${tpl.name}`,
            type: 'PHASE',
            status: 'TODO',
            priority: 'MEDIUM',
            estimatedHours: tpl.items.reduce((sum, item) => sum + item.defaultDurationDays * 8, 0),
            createdById: principal.userId,
            plannedStart: start,
            plannedEnd: targetEnd,
          },
        });

        // Map stepNumber -> created task id for dependency wiring
        const stepTaskIdMap = new Map<number, string>();
        for (const item of tpl.items) {
          const draft = input.tasks.find(
            (d) =>
              d.templateCode === scope.templateCode &&
              (d.unitIndex ?? 1) === u &&
              d.stepNumber === item.stepNumber,
          );

          const taskCode = `${project.code}-T${String(globalTaskCounter++).padStart(3, '0')}`;
          const hasBlocker = Boolean(item.dependsOnStep);
          const taskStart = draft?.plannedStart ? new Date(draft.plannedStart) : start;
          const taskEnd = draft?.plannedEnd ? new Date(draft.plannedEnd) : addWorkingDays(taskStart, item.defaultDurationDays);
          const estimatedHours = draft?.estimatedHours ?? item.defaultDurationDays * 8;

          const task = await tx.task.create({
            data: {
              projectId: project.id,
              parentId: phaseTask.id,
              code: taskCode,
              title: item.title,
              description: item.description ?? `Standard step ${item.stepNumber} of ${tpl.name}`,
              type: 'PROJECT',
              status: hasBlocker ? 'BLOCKED' : 'TODO',
              priority: item.isSimulationSignoff ? 'HIGH' : 'MEDIUM',
              estimatedHours,
              plannedStart: taskStart,
              plannedEnd: taskEnd,
              createdById: principal.userId,
            },
          });

          stepTaskIdMap.set(item.stepNumber, task.id);

          // Assignee
          const assigneeId = draft?.assigneeId;
          if (assigneeId) {
            await tx.taskAssignment.create({
              data: {
                taskId: task.id,
                userId: assigneeId,
                role: 'OWNER',
                allocatedHours: estimatedHours,
                assignedById: principal.userId,
              },
            });
          }
        }

        // Wire Finish-to-Start dependencies only when explicitly configured in template
        for (const item of tpl.items) {
          const successorId = stepTaskIdMap.get(item.stepNumber);
          if (!successorId) continue;

          const predStep = item.dependsOnStep;
          if (predStep && stepTaskIdMap.has(predStep)) {
            const predecessorId = stepTaskIdMap.get(predStep)!;
            await tx.taskDependency.create({
              data: {
                predecessorId,
                successorId,
                type: 'FINISH_TO_START',
                lagDays: 0,
              },
            });
          }
        }
      }
    }

    await audit(
      {
        actorId: principal.userId,
        module: 'pm',
        action: 'automation_project.created',
        entityType: 'Project',
        entityId: project.id,
        diff: { code: project.code, name: project.name, manager: manager.fullName },
      },
      tx,
    );

    return project;
  });

  await recomputeTaskDerivedState(createdProject.id);
  return createdProject;
}

export interface AutoAssignTeamInput {
  managerId: string;
  startDate?: string;
  targetEndDate?: string;
  tasks: Array<{
    id: string;
    templateCode: string;
    unitIndex: number;
    stepNumber: number;
    title: string;
    recommendedSeniority: string;
    plannedStart: string;
    plannedEnd: string;
    estimatedHours: number;
  }>;
}

export async function autoAssignAutomationTeam(
  principal: Principal,
  input: AutoAssignTeamInput,
) {
  if (!hasPermissionAnywhere(principal, 'pm.project.create')) {
    throw new ForbiddenError('Missing permission: pm.project.create');
  }

  if (!input.tasks || input.tasks.length === 0) {
    return { assignments: [] };
  }

  // 1. Fetch PM Squad hierarchy
  const descendantIds = input.managerId ? await getDescendantUserIds(input.managerId) : [];
  const squadSet = new Set(descendantIds);

  // 2. Determine capacity window
  const windowStart = input.startDate ? startOfDay(new Date(input.startDate)) : startOfDay(new Date());
  const windowEnd = input.targetEndDate ? startOfDay(new Date(input.targetEndDate)) : addDays(windowStart, 30);
  const window = { from: windowStart, to: windowEnd };

  // 3. Fetch candidate engineers
  const users = await prisma.user.findMany({
    where: {
      companyId: principal.companyId,
      status: 'ACTIVE',
      grade: { notIn: ['MANAGER', 'HEAD', 'DIRECTOR'] },
    },
    include: {
      department: { select: { id: true, name: true } },
    },
    orderBy: { fullName: 'asc' },
  });

  const userIds = users.map((u) => u.id);

  // 4. Fetch assignments & approved leaves in window
  const [activeAssignments, approvedLeaves] = await Promise.all([
    prisma.taskAssignment.findMany({
      where: {
        userId: { in: userIds },
        status: 'ACTIVE',
        task: { status: { notIn: ['COMPLETED', 'CANCELLED'] } },
      },
      include: {
        task: {
          select: {
            id: true,
            code: true,
            title: true,
            projectId: true,
            priority: true,
            status: true,
            percentComplete: true,
            plannedStart: true,
            plannedEnd: true,
            project: { select: { code: true, name: true } },
          },
        },
      },
    }),
    prisma.leave.findMany({
      where: {
        userId: { in: userIds },
        status: 'APPROVED',
        startDate: { lte: windowEnd },
        endDate: { gte: windowStart },
      },
      select: {
        userId: true,
        startDate: true,
        endDate: true,
      },
    }),
  ]);

  const assignmentsByUser = new Map<string, WorkloadAssignment[]>();
  for (const a of activeAssignments) {
    const list = assignmentsByUser.get(a.userId) || [];
    list.push({
      taskId: a.taskId,
      taskCode: a.task.code,
      taskTitle: a.task.title,
      projectId: a.task.projectId,
      projectCode: a.task.project?.code || '',
      projectName: a.task.project?.name,
      priority: (a.task.priority || 'MEDIUM') as never,
      status: a.task.status as never,
      allocatedHours: a.allocatedHours,
      percentComplete: a.task.percentComplete,
      plannedStart: a.task.plannedStart,
      plannedEnd: a.task.plannedEnd,
    });
    assignmentsByUser.set(a.userId, list);
  }

  const leavesByUser = new Map<string, LeavePeriod[]>();
  for (const l of approvedLeaves) {
    const list = leavesByUser.get(l.userId) || [];
    list.push({ startDate: l.startDate, endDate: l.endDate });
    leavesByUser.set(l.userId, list);
  }

  // 5. Compute workload for each candidate
  const candidates: SmartCandidate[] = users.map((user) => {
    const personWorkloadData: WorkloadPerson = {
      id: user.id,
      fullName: user.fullName,
      employeeCode: user.employeeCode,
      grade: user.grade,
      designation: user.designation,
      departmentId: user.departmentId,
      departmentName: user.department?.name ?? null,
      skills: user.skills,
      dailyCapacityHours: 8,
      avatarColor: user.avatarColor || '#e6e5e0',
    };

    const workload = computeWorkload(
      personWorkloadData,
      assignmentsByUser.get(user.id) || [],
      leavesByUser.get(user.id) || [],
      window,
    );

    return {
      id: user.id,
      fullName: user.fullName,
      employeeCode: user.employeeCode,
      grade: user.grade,
      designation: user.designation,
      status: user.status,
      freeHours: workload.freeHours,
      totalCapacityHours: workload.capacityHours,
      workingDays: workload.workingDays,
      leaveDays: workload.leaveDays,
      leaves: leavesByUser.get(user.id) || [],
    };
  });

  // 6. Map step requirements
  const stepRequirements: SmartStepRequirement[] = input.tasks.map((t) => ({
    id: t.id,
    stepNumber: t.stepNumber,
    templateInstanceId: `${t.templateCode}-${t.unitIndex}`,
    name: t.title,
    recommendedSeniority: t.recommendedSeniority || 'SENIOR',
    estimatedHours: t.estimatedHours || 8,
    plannedStart: t.plannedStart ? new Date(t.plannedStart) : windowStart,
    plannedEnd: t.plannedEnd ? new Date(t.plannedEnd) : windowEnd,
  }));

  // 7. Deterministic Allocation
  const allocations = allocateTeamForSteps(candidates, stepRequirements, squadSet);

  // 8. Optional AI Rationale Enrichment with Vertex AI Gemini 2.5 Flash
  try {
    const prompt = `You are an industrial automation lead engineer. Summarize these task assignments in short, crisp badges (1 sentence each).
Team: ${users.map((u) => `${u.fullName} (${u.grade})`).join(', ')}
Assignments:
${allocations.map((a) => `- Step ${a.stepId}: Assigned to ${a.assignedUserName || 'None'} (Score: ${a.score}%, Breakdown: M=${a.factorBreakdown.M}, A=${a.factorBreakdown.A}, C=${a.factorBreakdown.C}, Q=${a.factorBreakdown.Q})`).join('\n')}

Format as JSON map from stepId to short rationale string e.g. {"PLC-1-1": "95% · senior grade match, 6.5h/day free in squad"}`;

    const aiResponse = await generateWithGemini(prompt, { maxOutputTokens: 1024, timeoutMs: 3000 });
    if (aiResponse) {
      const match = aiResponse.match(/\{[\S\s]*\}/);
      if (match) {
        const rationales = JSON.parse(match[0]) as Record<string, string>;
        for (const a of allocations) {
          if (rationales[a.stepId]) {
            a.rationale = rationales[a.stepId];
          }
        }
      }
    }
  } catch {
    // Fail gracefully to deterministic rationales
  }

  return {
    assignments: allocations.map((a) => ({
      stepId: a.stepId,
      assignedUserId: a.assignedUserId,
      assignedUserName: a.assignedUserName,
      score: a.score,
      factorBreakdown: a.factorBreakdown,
      escalationRung: a.escalationRung,
      rationale: a.rationale,
      isWeakMatch: a.isWeakMatch,
    })),
  };
}
