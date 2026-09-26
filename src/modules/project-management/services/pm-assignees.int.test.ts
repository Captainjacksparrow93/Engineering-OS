import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/core/db/prisma';
import { loadPrincipal } from '@/core/rbac/principal';
import { DomainError, ForbiddenError } from '@/core/rbac/errors';
import { assignTask, listMyTasks, createTask } from './task.service';
import { requestHandover, decideHandover } from './handover.service';
import { getProjectWorkspace } from './project.service';
import { allocateTeamForSteps, type SmartCandidate, type SmartStepRequirement } from '../domain/availability';

describe('PM and Assistant PM Task Assignment (#4) Integration Tests', () => {
  let dilipPrincipal: any; // Technical Head (ACS-0061)
  let dhrupinPrincipal: any; // Asst. Manager / PM1 (ACS-0070)
  let parasPrincipal: any; // PM2 (ACS-0074)
  let yogiPrincipal: any; // Engineer under Dhrupin (ACS-0071)
  let testProjectId: string;
  let testTaskId: string;
  let crossTaskId: string;

  beforeAll(async () => {
    const dilipUser = await prisma.user.findFirst({ where: { employeeCode: 'ACS-0061' } });
    const dhrupinUser = await prisma.user.findFirst({ where: { employeeCode: 'ACS-0070' } });
    const parasUser = await prisma.user.findFirst({ where: { employeeCode: 'ACS-0074' } });
    const yogiUser = await prisma.user.findFirst({ where: { employeeCode: 'ACS-0071' } });

    if (!dilipUser || !dhrupinUser || !parasUser || !yogiUser) {
      throw new Error(
        'Required seeded users missing: ACS-0061 (Dilip), ACS-0070 (Dhrupin), ACS-0074 (Paras), ACS-0071 (Yogi). Please ensure the database is seeded.',
      );
    }

    dilipPrincipal = await loadPrincipal(dilipUser.id);
    dhrupinPrincipal = await loadPrincipal(dhrupinUser.id);
    parasPrincipal = await loadPrincipal(parasUser.id);
    yogiPrincipal = await loadPrincipal(yogiUser.id);

    // Create a test project and tasks
    const proj = await prisma.project.create({
      data: {
        company: { connect: { id: dilipPrincipal.companyId } },
        code: `TEST-PM-${Date.now()}`,
        name: 'PM Assignee Test Project',
        clientName: 'Test Client',
        manager: { connect: { id: dhrupinPrincipal.userId } },
        targetEndDate: new Date(Date.now() + 7 * 86400000),
      },
    });
    testProjectId = proj.id;

    const task1 = await prisma.task.create({
      data: {
        projectId: proj.id,
        code: `T-1-${Date.now()}`,
        title: 'Test Task for Head Assignment',
        estimatedHours: 8,
        createdById: dilipPrincipal.userId,
      },
    });
    testTaskId = task1.id;

    const task2 = await prisma.task.create({
      data: {
        projectId: proj.id,
        code: `T-2-${Date.now()}`,
        title: 'Test Task for Cross-team Reassign',
        estimatedHours: 8,
        createdById: dilipPrincipal.userId,
      },
    });
    crossTaskId = task2.id;
  });

  afterAll(async () => {
    if (testProjectId) {
      await prisma.taskHandover.deleteMany({ where: { task: { projectId: testProjectId } } });
      await prisma.taskAssignment.deleteMany({ where: { task: { projectId: testProjectId } } });
      await prisma.task.deleteMany({ where: { projectId: testProjectId } });
      await prisma.projectMember.deleteMany({ where: { projectId: testProjectId } });
      await prisma.notification.deleteMany({ where: { link: { contains: testProjectId } } });
      await prisma.project.delete({ where: { id: testProjectId } }).catch(() => {});
    }
  });

  it('1. Technical Head assigns a task to an Assistant PM: moves immediately, shows in My Work, notification sent', async () => {
    // Technical head assigns task1 to Dhrupin (Assistant PM)
    await assignTask(dilipPrincipal, testTaskId, {
      userId: dhrupinPrincipal.userId,
      role: 'OWNER',
    });

    // Check assignment
    const activeOwner = await prisma.taskAssignment.findFirst({
      where: { taskId: testTaskId, status: 'ACTIVE', role: 'OWNER' },
    });
    expect(activeOwner).not.toBeNull();
    expect(activeOwner?.userId).toBe(dhrupinPrincipal.userId);

    // Shows in Dhrupin's My Work
    const myTasks = await listMyTasks(dhrupinPrincipal);
    expect(myTasks.some((r) => r.task.id === testTaskId)).toBe(true);

    // Notification sent
    const notification = await prisma.notification.findFirst({
      where: { userId: dhrupinPrincipal.userId, link: `/pm/tasks/${testTaskId}` },
    });
    expect(notification).not.toBeNull();
  });

  it('2. PM reassigns to their own engineer or to themselves: moves immediately', async () => {
    // First assign crossTaskId to Yogi (Dhrupin's engineer)
    await assignTask(dilipPrincipal, crossTaskId, {
      userId: yogiPrincipal.userId,
      role: 'OWNER',
    });

    // Dhrupin reassigns from Yogi to Dhrupin himself (same team)
    const resultSelf = await requestHandover(dhrupinPrincipal, {
      taskId: crossTaskId,
      toUserId: dhrupinPrincipal.userId,
      reason: 'Taking over directly',
    });

    // Moves immediately (direct move, returns TaskAssignment)
    expect(resultSelf).toHaveProperty('userId', dhrupinPrincipal.userId);
    let currentOwner = await prisma.taskAssignment.findFirst({
      where: { taskId: crossTaskId, status: 'ACTIVE', role: 'OWNER' },
    });
    expect(currentOwner?.userId).toBe(dhrupinPrincipal.userId);

    // Dhrupin reassigns from himself back to Yogi (same team)
    const resultEngineer = await requestHandover(dhrupinPrincipal, {
      taskId: crossTaskId,
      toUserId: yogiPrincipal.userId,
      reason: 'Handing back to my engineer',
    });
    expect(resultEngineer).toHaveProperty('userId', yogiPrincipal.userId);
    currentOwner = await prisma.taskAssignment.findFirst({
      where: { taskId: crossTaskId, status: 'ACTIVE', role: 'OWNER' },
    });
    expect(currentOwner?.userId).toBe(yogiPrincipal.userId);
  });

  it('3. PM reassigns to another PM: created in AWAITING_HEAD_APPROVAL, owner unchanged, moves after head approves', async () => {
    // Currently owned by Yogi (Dhrupin's team). Dhrupin reassigns to Paras (another PM).
    const handover = await requestHandover(dhrupinPrincipal, {
      taskId: crossTaskId,
      toUserId: parasPrincipal.userId,
      reason: 'Cross-team reassign to Paras',
    });

    // Status is AWAITING_HEAD_APPROVAL (skipping stage 1)
    expect(handover).toHaveProperty('status', 'AWAITING_HEAD_APPROVAL');

    // Owner is unchanged
    let currentOwner = await prisma.taskAssignment.findFirst({
      where: { taskId: crossTaskId, status: 'ACTIVE', role: 'OWNER' },
    });
    expect(currentOwner?.userId).toBe(yogiPrincipal.userId);

    // Heads notified
    const headNotification = await prisma.notification.findFirst({
      where: { userId: dilipPrincipal.userId, link: '/pm/approvals' },
    });
    expect(headNotification).not.toBeNull();

    // After Technical Head approves (stage 2): task moves!
    await decideHandover(dilipPrincipal, handover.id, 'ACCEPTED', 'Approved by Head');
    currentOwner = await prisma.taskAssignment.findFirst({
      where: { taskId: crossTaskId, status: 'ACTIVE', role: 'OWNER' },
    });
    expect(currentOwner?.userId).toBe(parasPrincipal.userId);
  });

  it('4. PM reassigns to another PMs engineer, declined by head: stays with original owner', async () => {
    // Reset crossTaskId owner to Yogi
    await assignTask(dilipPrincipal, crossTaskId, {
      userId: yogiPrincipal.userId,
      role: 'OWNER',
    });

    const harshUser = await prisma.user.findFirst({ where: { employeeCode: 'ACS-0064' } });
    if (!harshUser) throw new Error('Harsh user (ACS-0064) missing from seed');

    const handover = await requestHandover(dhrupinPrincipal, {
      taskId: crossTaskId,
      toUserId: harshUser.id,
      reason: 'Reassigning across squad',
    });
    expect(handover.status).toBe('AWAITING_HEAD_APPROVAL');

    // Head declines
    await decideHandover(dilipPrincipal, handover.id, 'DECLINED', 'Denied');
    const ownerAfterDecline = await prisma.taskAssignment.findFirst({
      where: { taskId: crossTaskId, status: 'ACTIVE', role: 'OWNER' },
    });
    expect(ownerAfterDecline?.userId).toBe(yogiPrincipal.userId);
  });

  it('5. Engineer cannot hand over across teams', async () => {
    const harshUser = await prisma.user.findFirst({ where: { employeeCode: 'ACS-0064' } });
    if (!harshUser) throw new Error('Harsh user (ACS-0064) missing from seed');

    // Yogi (engineer under Dhrupin) attempts to hand over to Harsh (under another PM)
    await expect(
      requestHandover(yogiPrincipal, {
        taskId: crossTaskId,
        toUserId: harshUser.id,
        reason: 'Engineer cross-squad attempt',
      }),
    ).rejects.toThrow(DomainError);
  });

  it('6. Auto-assign never selects a pool member', async () => {
    const candidates: SmartCandidate[] = [
      {
        id: 'pm-1',
        fullName: 'Dhrupin Vaghasiya',
        employeeCode: 'ACS-0070',
        grade: 'SENIOR_ENGINEER',
        designation: 'Asst. Manager',
        freeHours: 40,
        totalCapacityHours: 80,
        workingDays: 10,
        leaveDays: 0,
        status: 'ACTIVE',
        leaves: [],
      },
      {
        id: 'eng-1',
        fullName: 'Yogi Patel',
        employeeCode: 'ACS-0071',
        grade: 'SENIOR_ENGINEER',
        designation: 'Sr. Engineer',
        freeHours: 40,
        totalCapacityHours: 80,
        workingDays: 10,
        leaveDays: 0,
        status: 'ACTIVE',
        leaves: [],
      },
    ];

    const steps: SmartStepRequirement[] = [
      {
        id: 'step-1',
        stepNumber: 1,
        name: 'Auto step',
        recommendedSeniority: 'SENIOR',
        estimatedHours: 8,
        plannedStart: new Date('2026-10-01'),
        plannedEnd: new Date('2026-10-05'),
      },
    ];

    const allocations = allocateTeamForSteps(candidates, steps);
    expect(allocations).toHaveLength(1);
    expect(allocations[0].assignedUserId).toBe('eng-1');
    expect(allocations[0].assignedUserId).not.toBe('pm-1');
  });

  it('7. (#4b) PM calling createTask (planned and ADHOC) on their own project gets ForbiddenError', async () => {
    await expect(
      createTask(dhrupinPrincipal, {
        projectId: testProjectId,
        title: 'Unauthorized Planned Task',
        type: 'PROJECT',
        priority: 'MEDIUM',
        estimatedHours: 4,
        requiredSkills: [],
        dependsOn: [],
      }),
    ).rejects.toThrow(ForbiddenError);

    await expect(
      createTask(dhrupinPrincipal, {
        projectId: testProjectId,
        title: 'Unauthorized Adhoc Task',
        type: 'ADHOC',
        priority: 'MEDIUM',
        estimatedHours: 4,
        requiredSkills: [],
        dependsOn: [],
      }),
    ).rejects.toThrow(ForbiddenError);
  });

  it('8. (#4b) Technical Head can create both planned and ADHOC tasks', async () => {
    const plannedTask = await createTask(dilipPrincipal, {
      projectId: testProjectId,
      title: 'Authorized Planned Task',
      type: 'PROJECT',
      priority: 'MEDIUM',
      estimatedHours: 4,
      requiredSkills: [],
      dependsOn: [],
    });
    expect(plannedTask.id).toBeDefined();

    const adhocTask = await createTask(dilipPrincipal, {
      projectId: testProjectId,
      title: 'Authorized Adhoc Task',
      type: 'ADHOC',
      priority: 'MEDIUM',
      estimatedHours: 4,
      requiredSkills: [],
      dependsOn: [],
    });
    expect(adhocTask.id).toBeDefined();
  });

  it('9. (#4b) Project workspace returns canCreateTask: false and canCreateAdhocTask: false for PM', async () => {
    const ws = await getProjectWorkspace(dhrupinPrincipal, testProjectId);
    expect(ws.permissions.canCreateTask).toBe(false);
    expect(ws.permissions.canCreateAdhocTask).toBe(false);
    expect(ws.permissions.canAssign).toBe(true);
    expect(ws.permissions.canEditProject).toBe(true);
  });

  it('10. Technical Head cross-team reassign moves directly', async () => {
    // Reset crossTaskId owner to Yogi (Dhrupin squad)
    await assignTask(dilipPrincipal, crossTaskId, {
      userId: yogiPrincipal.userId,
      role: 'OWNER',
    });

    const harshUser = await prisma.user.findFirst({ where: { employeeCode: 'ACS-0064' } }); // Harsh under Paras
    if (!harshUser) throw new Error('Harsh user (ACS-0064) missing from seed');

    // Dilip (Technical Head) reassigns task across teams (from Yogi to Harsh)
    const result = await requestHandover(dilipPrincipal, {
      taskId: crossTaskId,
      toUserId: harshUser.id,
      reason: 'Direct cross-team move by Technical Head',
    });

    // Moves directly without creating AWAITING_HEAD_APPROVAL
    expect(result).toHaveProperty('userId', harshUser.id);
    expect(result).toHaveProperty('status', 'ACTIVE');

    const currentOwner = await prisma.taskAssignment.findFirst({
      where: { taskId: crossTaskId, status: 'ACTIVE', role: 'OWNER' },
    });
    expect(currentOwner?.userId).toBe(harshUser.id);
  });
});
