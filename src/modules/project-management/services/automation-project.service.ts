import { prisma } from '@/core/db/prisma';
import { assertCan } from '@/core/rbac/guard';
import { hasPermissionAnywhere } from '@/core/rbac/engine';
import { DomainError, ForbiddenError } from '@/core/rbac/errors';
import type { Principal } from '@/core/rbac/types';
import { audit } from '@/core/audit/audit';
import { addDays, addWorkingDays, startOfDay, workingDaysBetween } from '@/core/utils/dates';
import { planLaneByHours } from '../domain/scheduling';
import { projectManagerPool } from './access';
import { recomputeTaskDerivedState } from './task.service';
import { nextClientProjectCode } from './project.service';
import { getClientById } from './client.service';
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
  name?: string;
  quantity: number;
}

export interface TaskAssignmentDraft {
  templateCode: string;
  unitIndex: number; // 1, 2, ...
  stepNumber: number;
  title: string;
  assigneeId?: string;
  plannedStart?: string; // YYYY-MM-DD
  plannedEnd?: string;   // YYYY-MM-DD
  estimatedHours?: number;
}

export interface CreateAutomationProjectInput {
  kind?: 'WORK_ORDER' | 'SERVICE_CALL';
  name?: string;
  workOrderNo?: string | null;
  code?: string;
  clientId: string;
  clientName: string;
  clientRefNumber?: string;
  endUserName?: string;
  applicationName?: string;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  description?: string;
  status?: 'DRAFT' | 'PLANNING' | 'IN_PROGRESS' | 'ON_HOLD' | 'COMPLETED' | 'COMMISSIONING' | 'CLOSED' | 'CANCELLED';
  targetEndDate?: string;
  startDate?: string;
  managerId: string;
  departmentId?: string;
  scopes?: ScopeSelection[];
  tasks?: TaskAssignmentDraft[];
}

/** In-memory BFS to find all descendants of a manager given a map of direct reports */
function getDescendantUserIdsFromMap(managerId: string, reportsByManager: Map<string, string[]>): string[] {
  const result: string[] = [];
  const queue = [managerId];
  const visited = new Set<string>([managerId]);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const directReports = reportsByManager.get(current) ?? [];
    for (const reportId of directReports) {
      if (!visited.has(reportId)) {
        visited.add(reportId);
        result.push(reportId);
        queue.push(reportId);
      }
    }
  }

  return result;
}

/** Get all descendants of a manager in the org chart using a single company-level query */
export async function getDescendantUserIds(companyId: string, managerId: string): Promise<string[]> {
  const activeCompanyUsers = await prisma.user.findMany({
    where: { companyId, status: 'ACTIVE' },
    select: { id: true, managerId: true },
  });
  const reportsByManager = new Map<string, string[]>();
  for (const u of activeCompanyUsers) {
    if (u.managerId) {
      const list = reportsByManager.get(u.managerId) ?? [];
      list.push(u.id);
      reportsByManager.set(u.managerId, list);
    }
  }
  return getDescendantUserIdsFromMap(managerId, reportsByManager);
}


export async function getPMTeamData(companyId: string) {
  // Find PMs: eligible active users holding PROJECT_MANAGER or ASST_MANAGER role in TECH department
  const managers = await projectManagerPool(companyId);

  // Fetch all active company users once to build direct report hierarchy
  const activeCompanyUsers = await prisma.user.findMany({
    where: { companyId, status: 'ACTIVE' },
    select: { id: true, managerId: true },
  });
  const reportsByManager = new Map<string, string[]>();
  for (const u of activeCompanyUsers) {
    if (u.managerId) {
      const list = reportsByManager.get(u.managerId) ?? [];
      list.push(u.id);
      reportsByManager.set(u.managerId, list);
    }
  }

  // Map each PM to their team members via in-memory BFS
  const teamsByPM: Record<string, string[]> = {};
  for (const m of managers) {
    teamsByPM[m.id] = getDescendantUserIdsFromMap(m.id, reportsByManager);
  }

  // All technical engineers (holding SENIOR_ENGINEER or JUNIOR_ENGINEER) in TECH department, excluding management/assistants
  const allEngineers = await prisma.user.findMany({
    where: {
      companyId,
      status: 'ACTIVE',
      department: { code: { in: ['TECH'] } },
      roleAssignments: { some: { role: { key: { in: ['SENIOR_ENGINEER', 'JUNIOR_ENGINEER'] } } } },
      NOT: [
        { designation: { contains: 'Manager', mode: 'insensitive' } },
        { designation: { contains: 'Asst', mode: 'insensitive' } },
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
  if (!hasPermissionAnywhere(principal, 'pm.project.create')) {
    assertCan(principal, 'pm.project.create');
  }

  const manager = await prisma.user.findFirst({
    where: { id: input.managerId, companyId: principal.companyId, status: 'ACTIVE' },
    select: { id: true, fullName: true, departmentId: true },
  });
  if (!manager) throw new DomainError('Selected Project Manager not found or inactive.');

  const departmentId = input.departmentId || manager.departmentId || principal.departmentId;
  assertCan(principal, 'pm.project.create', { departmentId: departmentId ?? undefined });

  const isServiceCall = input.kind === 'SERVICE_CALL' || !input.workOrderNo;
  const kind = isServiceCall ? 'SERVICE_CALL' : 'WORK_ORDER';

  const scopes = input.scopes ?? [];
  const tasks = input.tasks ?? [];

  // Validate all assignees belong to company and are active
  const assigneeIds = tasks
    .map((t) => t.assigneeId)
    .filter((id): id is string => Boolean(id) && id !== manager.id);

  if (assigneeIds.length > 0) {
    const uniqueIds = Array.from(new Set(assigneeIds));
    const validUsers = await prisma.user.findMany({
      where: {
        id: { in: uniqueIds },
        companyId: principal.companyId,
        status: 'ACTIVE',
      },
      select: { id: true },
    });
    const validSet = new Set(validUsers.map((u) => u.id));
    for (const id of uniqueIds) {
      if (!validSet.has(id)) {
        throw new DomainError(`Assignee ${id} is not an active employee in your company.`);
      }
    }
    const pmTeam = new Set(await getDescendantUserIds(principal.companyId, manager.id));
    if (uniqueIds.some((id) => !pmTeam.has(id))) {
      throw new DomainError("Steps can only be assigned to engineers in the selected PM's team.");
    }
  }

  // Every panel must have an assigned engineer before creating the project.
  const unassignedPanels = new Set<string>();
  for (const task of tasks) {
    if (!task.assigneeId) {
      unassignedPanels.add(`${task.templateCode} Panel ${task.unitIndex}`);
    }
  }
  if (unassignedPanels.size > 0) {
    const list = Array.from(unassignedPanels);
    throw new DomainError(
      `Every panel must have an assigned engineer: ${list.join(', ')} ${list.length > 1 ? 'have' : 'has'} no engineer assigned.`,
    );
  }

  // Determine and validate client
  if (!input.clientId) {
    throw new DomainError('Client is required. Pick a client before creating the project.');
  }

  const client = await getClientById(principal.companyId, input.clientId);
  if (!client) {
    throw new DomainError('Client not found or does not belong to your company.');
  }

  const clientRef = input.clientRefNumber?.trim().toUpperCase() || client.refNumber;
  if (!clientRef) {
    throw new DomainError('Client not found. Pick a client before creating the project.');
  }

  let code = input.code?.trim().toUpperCase();
  if (!code) {
    code = await nextClientProjectCode(principal.companyId, clientRef);
  }

  const trimmedWO = input.workOrderNo ? input.workOrderNo.trim() : null;
  if (trimmedWO) {
    const existingWO = await prisma.project.findUnique({ where: { workOrderNo: trimmedWO } });
    if (existingWO) throw new DomainError(`Work Order No. ${trimmedWO} is already in use.`);
  }

  const start = input.startDate ? new Date(input.startDate) : new Date();
  const targetEnd = input.targetEndDate ? new Date(input.targetEndDate) : addWorkingDays(start, 45);

  const dayStr = String(start.getDate()).padStart(2, '0');
  const monthStr = start.toLocaleString('en-US', { month: 'short' });
  const defaultName = isServiceCall
    ? `SC ${input.clientName} ${dayStr}-${monthStr}`
    : `WO ${trimmedWO}`;
  const projectName = input.name?.trim() || defaultName;

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
        kind,
        workOrderNo: trimmedWO,
        name: projectName,
        description: input.description ?? null,
        clientId: input.clientId,
        clientName: input.clientName,
        endUserName: input.endUserName ?? null,
        applicationName: input.applicationName ?? null,
        status: input.status ?? (isServiceCall ? 'IN_PROGRESS' : 'PLANNING'),
        priority: input.priority ?? (isServiceCall ? 'HIGH' : 'MEDIUM'),
        startDate: start,
        targetEndDate: targetEnd,
        managerId: manager.id,
        sponsorId: principal.userId,
        departmentId: departmentId ?? null,
        automationTypes: [...new Set(scopes.filter((s) => s.quantity > 0 && templateMap.has(s.templateCode)).map((s) => s.templateCode))],
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
    for (const t of tasks) {
      if (t.assigneeId && t.assigneeId !== manager.id) {
        assignedUserIds.add(t.assigneeId);
      }
    }

    for (const userId of assignedUserIds) {
      await tx.projectMember.create({
        data: { projectId: project.id, userId, role: 'ENGINEER', allocationPercent: 100 },
      });
    }

    // 4. Create WBS nodes and 13 tasks per panel (parallel panel phases)
    let phaseCounter = 1;
    let globalTaskCounter = 1;

    for (const scope of scopes) {
      if (scope.quantity <= 0) continue;
      const tpl = templateMap.get(scope.templateCode);
      if (!tpl) continue;

      for (let unit = 1; unit <= scope.quantity; unit++) {
        const phaseTitle = `${tpl.code} Panel ${unit}`;
        const phaseCode = `${project.code}-PH${phaseCounter++}`;
        const panelHours = tpl.items.reduce((sum, item) => sum + item.defaultDurationHours, 0);

        // Create Phase task (container node for this panel)
        const phaseTask = await tx.task.create({
          data: {
            projectId: project.id,
            code: phaseCode,
            title: phaseTitle,
            type: 'PHASE',
            status: 'TODO',
            priority: 'MEDIUM',
            estimatedHours: panelHours,
            createdById: principal.userId,
            plannedStart: start,
            plannedEnd: targetEnd,
          },
        });

        // 1x template duration (multiplier removed)
        const stepHoursList = tpl.items.map((item) => item.defaultDurationHours);
        const lanePlan = planLaneByHours(stepHoursList, start, workingDaysBetween(start, targetEnd));

        // Map stepNumber -> created task id for dependency wiring strictly within this panel
        const stepTaskIdMap = new Map<number, string>();
        for (let idx = 0; idx < tpl.items.length; idx++) {
          const item = tpl.items[idx];
          const draft = tasks.find(
            (d) =>
              d.templateCode === scope.templateCode &&
              d.unitIndex === unit &&
              d.stepNumber === item.stepNumber,
          );

          const taskStart = draft?.plannedStart ? new Date(draft.plannedStart) : lanePlan[idx]!.plannedStart;
          const taskEnd = draft?.plannedEnd ? new Date(draft.plannedEnd) : lanePlan[idx]!.plannedEnd;
          const estimatedHours = draft?.estimatedHours ?? stepHoursList[idx]!;

          const taskCode = `${project.code}-T${String(globalTaskCounter++).padStart(3, '0')}`;
          const hasBlocker = Boolean(item.dependsOnStep);

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

        // Wire Finish-to-Start dependencies strictly within this panel
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
  scopes?: ScopeSelection[];
  tasks: Array<{
    id?: string;
    templateCode: string;
    unitIndex?: number;
    stepNumber: number;
    title: string;
    recommendedSeniority?: string;
    plannedStart?: string;
    plannedEnd?: string;
    estimatedHours?: number;
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
  const descendantIds = input.managerId ? await getDescendantUserIds(principal.companyId, input.managerId) : [];
  const squadSet = new Set<string>(descendantIds);

  // 2. Determine capacity window
  const windowStart = input.startDate ? startOfDay(new Date(input.startDate)) : startOfDay(new Date());
  const windowEnd = input.targetEndDate ? startOfDay(new Date(input.targetEndDate)) : addDays(windowStart, 30);
  const window = { from: windowStart, to: windowEnd };

  // 3. Fetch candidate engineers (strictly TECH department execution staff)
  const users = await prisma.user.findMany({
    where: {
      companyId: principal.companyId,
      status: 'ACTIVE',
      department: { code: { in: ['TECH'] } },
      grade: { notIn: ['MANAGER', 'HEAD', 'DIRECTOR'] },
      NOT: [
        { designation: { contains: 'Manager', mode: 'insensitive' } },
        { designation: { contains: 'Asst', mode: 'insensitive' } },
      ],
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
      dailyCapacityHours: user.dailyCapacityHours ?? 8,
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

  // 6. Map panel requirements (allocate 1 engineer per panel)
  const seniorityRanks: Record<string, number> = { LEAD: 4, SENIOR: 3, JUNIOR: 2, TRAINEE: 1 };
  const panelsMap = new Map<string, {
    templateCode: string;
    unitIndex: number;
    title: string;
    totalHours: number;
    highestSeniority: string;
    plannedStart?: Date;
    plannedEnd?: Date;
  }>();

  for (const t of input.tasks) {
    const unitIndex = t.unitIndex ?? 1;
    const panelKey = `${t.templateCode}_${unitIndex}`;
    const existing = panelsMap.get(panelKey);
    const sen = t.recommendedSeniority || 'SENIOR';
    const hours = t.estimatedHours || 8;
    const start = t.plannedStart ? new Date(t.plannedStart) : windowStart;
    const end = t.plannedEnd ? new Date(t.plannedEnd) : windowEnd;

    if (!existing) {
      panelsMap.set(panelKey, {
        templateCode: t.templateCode,
        unitIndex,
        title: `${t.templateCode} Panel ${unitIndex}`,
        totalHours: hours,
        highestSeniority: sen,
        plannedStart: start,
        plannedEnd: end,
      });
    } else {
      existing.totalHours += hours;
      const currentRank = seniorityRanks[existing.highestSeniority] ?? 2;
      const thisRank = seniorityRanks[sen] ?? 2;
      if (thisRank > currentRank) {
        existing.highestSeniority = sen;
      }
      if (start < existing.plannedStart!) existing.plannedStart = start;
      if (end > existing.plannedEnd!) existing.plannedEnd = end;
    }
  }

  const stepRequirements: SmartStepRequirement[] = Array.from(panelsMap.entries()).map(([key, p]) => ({
    id: key, // e.g. "PLC_1"
    stepNumber: p.unitIndex,
    templateInstanceId: p.templateCode,
    name: p.title,
    recommendedSeniority: p.highestSeniority,
    estimatedHours: p.totalHours,
    plannedStart: p.plannedStart ?? windowStart,
    plannedEnd: p.plannedEnd ?? windowEnd,
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
