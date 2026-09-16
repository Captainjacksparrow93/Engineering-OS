import { prisma } from '@/core/db/prisma';
import { assertCan } from '@/core/rbac/guard';
import { DomainError } from '@/core/rbac/errors';
import type { Principal } from '@/core/rbac/types';
import { audit } from '@/core/audit/audit';
import { addWorkingDays } from '@/core/utils/dates';
import { recomputeTaskDerivedState } from './task.service';

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
      department: { code: { in: ['TECH', 'DESIGN', 'DIR'] } },
      OR: [
        { fullName: { contains: 'Parth' } },
        { fullName: { contains: 'Paras' } },
        { designation: { contains: 'Project Manager' } },
        { grade: 'MANAGER' },
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
      department: { code: { in: ['TECH', 'DESIGN', 'DIR'] } },
      grade: { in: ['SENIOR_ENGINEER', 'ENGINEER', 'JUNIOR_ENGINEER', 'TRAINEE'] },
      NOT: [
        { designation: { contains: 'Project Manager' } },
        { designation: { contains: 'Director' } },
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


  // Generate code if missing
  let code = input.code?.trim();
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
        const unitTasks = input.tasks.filter(
          (t) => t.templateCode === scope.templateCode && (t.unitIndex === u || t.unitIndex === 1 || !t.unitIndex)
        );

        for (const item of tpl.items) {
          const draft = unitTasks.find((d) => d.stepNumber === item.stepNumber);

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
              title: `Step ${item.stepNumber}: ${item.title}`,
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


