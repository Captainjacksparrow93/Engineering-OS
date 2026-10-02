import { describe, it, expect } from 'vitest';
import { prisma } from '@/core/db/prisma';
import { loadPrincipal } from '@/core/rbac/principal';
import { ForbiddenError } from '@/core/rbac/errors';
import { createAutomationProject } from './automation-project.service';
import { assignTask, deleteTask } from './task.service';
import {
  requestHandover,
  decideHandover,
  cancelHandover,
  requestProjectHandover,
  decideProjectHandover,
  cancelProjectHandover,
} from './handover.service';
import { listProjects } from './project.service';

describe('Sales Head Integration (#2)', () => {
  it('allows Sales Head to list all projects across the company', async () => {
    const dharmesh = await prisma.user.findUnique({
      where: { email: 'dharmesh.thummar@acsengitech.com' },
    });
    expect(dharmesh).not.toBeNull();

    const principal = await loadPrincipal(dharmesh!.id);
    expect(principal).not.toBeNull();
    expect(principal?.roleKeys).toContain('SALES_HEAD');

    const projects = await listProjects(principal!);
    expect(Array.isArray(projects)).toBe(true);
  });

  it('forbids Sales Head from executing mutating services', async () => {
    const dharmesh = await prisma.user.findUnique({
      where: { email: 'dharmesh.thummar@acsengitech.com' },
    });
    expect(dharmesh).not.toBeNull();

    const principal = (await loadPrincipal(dharmesh!.id))!;
    expect(principal).not.toBeNull();

    // 1. Attempt to create automation project
    await expect(
      createAutomationProject(principal, {
        workOrderNo: '9999',
        clientId: 'fake-client',
        clientName: 'Test Client',
        managerId: dharmesh!.id,
        scopes: [],
        tasks: [],
      })
    ).rejects.toThrow(ForbiddenError);

    // Find any existing task
    const task = await prisma.task.findFirst();
    if (task) {
      // 2. Attempt to assign task
      await expect(
        assignTask(principal, task.id, {
          userId: dharmesh!.id,
        })
      ).rejects.toThrow(ForbiddenError);

      // 3. Attempt to delete task
      await expect(
        deleteTask(principal, task.id)
      ).rejects.toThrow(ForbiddenError);
    }

    // Find any existing project
    const project = await prisma.project.findFirst();
    if (project) {
      // 4. Attempt project handover
      await expect(
        requestProjectHandover(principal, {
          projectId: project.id,
          toUserId: dharmesh!.id,
        })
      ).rejects.toThrow(ForbiddenError);
    }
  });

  it('forbids Sales Head from all handover mutations, while Director can decide cross-team handovers (F1)', async () => {
    const dharmesh = await prisma.user.findUniqueOrThrow({
      where: { email: 'dharmesh.thummar@acsengitech.com' },
    });
    const salesPrincipal = (await loadPrincipal(dharmesh.id))!;

    const directorUser = await prisma.user.findFirstOrThrow({
      where: {
        roleAssignments: { some: { role: { key: 'DIRECTOR' } } },
        status: 'ACTIVE',
      },
    });
    const directorPrincipal = (await loadPrincipal(directorUser.id))!;

    const dhrupinUser = await prisma.user.findFirstOrThrow({ where: { employeeCode: 'ACS-0070' } });
    const yogiUser = await prisma.user.findFirstOrThrow({ where: { employeeCode: 'ACS-0071' } });
    const parasUser = await prisma.user.findFirstOrThrow({ where: { employeeCode: 'ACS-0074' } });

    const department = await prisma.department.findFirstOrThrow({
      where: { companyId: directorPrincipal.companyId, code: 'TECH' },
    });

    const testProject = await prisma.project.create({
      data: {
        companyId: directorPrincipal.companyId,
        departmentId: department.id,
        code: `TEST-SH-${Date.now()}`,
        name: 'Sales Head Handover Test Project',
        clientName: 'Test Client',
        managerId: dhrupinUser.id,
      },
    });

    const testTask = await prisma.task.create({
      data: {
        project: { connect: { id: testProject.id } },
        createdBy: { connect: { id: dhrupinUser.id } },
        code: `TASK-${Date.now()}`,
        title: 'Test Handover Task',
        type: 'PROJECT',
        status: 'TODO',
        assignments: {
          create: {
            userId: yogiUser.id,
            role: 'OWNER',
            status: 'ACTIVE',
          },
        },
      },
    });

    try {
      // 1. Deny: Sales Head calling requestHandover
      await expect(
        requestHandover(salesPrincipal, {
          taskId: testTask.id,
          toUserId: parasUser.id,
          reason: 'Sales Head cannot request task reassignment',
        })
      ).rejects.toThrow(ForbiddenError);

      // Create a cross-team task handover (from Yogi [Dhrupin team] to Paras [other PM])
      const taskHandover = await prisma.taskHandover.create({
        data: {
          taskId: testTask.id,
          fromUserId: yogiUser.id,
          toUserId: parasUser.id,
          requestedById: dhrupinUser.id,
          reason: 'Cross-team reassignment',
          remainingPercent: 100,
          remainingHours: 10,
          status: 'AWAITING_HEAD_APPROVAL',
        },
      });

      // 2. Deny: Sales Head calling decideHandover
      await expect(
        decideHandover(salesPrincipal, taskHandover.id, 'ACCEPTED')
      ).rejects.toThrow(ForbiddenError);

      // Allow: Director can still decide a cross-team handover
      await decideHandover(
        directorPrincipal,
        taskHandover.id,
        'ACCEPTED',
        'Approved by Director'
      );
      const dbHandover = await prisma.taskHandover.findUnique({ where: { id: taskHandover.id } });
      expect(dbHandover?.status).toBe('ACCEPTED');
      expect(dbHandover?.headApprovedById).toBe(directorPrincipal.userId);

      const newOwner = await prisma.taskAssignment.findFirst({
        where: { taskId: testTask.id, status: 'ACTIVE', role: 'OWNER' },
      });
      expect(newOwner?.userId).toBe(parasUser.id);

      // Create a pending task handover for cancelHandover test
      const pendingTaskHandover = await prisma.taskHandover.create({
        data: {
          taskId: testTask.id,
          fromUserId: parasUser.id,
          toUserId: yogiUser.id,
          requestedById: dhrupinUser.id,
          reason: 'Pending handover for cancel test',
          remainingPercent: 100,
          remainingHours: 5,
          status: 'PENDING',
        },
      });

      // 3. Deny: Sales Head calling cancelHandover
      await expect(
        cancelHandover(salesPrincipal, pendingTaskHandover.id)
      ).rejects.toThrow(ForbiddenError);

      // Create a project handover for project handover tests
      const projectHandover = await prisma.projectHandover.create({
        data: {
          projectId: testProject.id,
          fromUserId: dhrupinUser.id,
          toUserId: parasUser.id,
          reason: 'Cross-team project handover',
          status: 'PENDING',
        },
      });

      // 4. Deny: Sales Head calling decideProjectHandover
      await expect(
        decideProjectHandover(salesPrincipal, projectHandover.id, 'ACCEPTED')
      ).rejects.toThrow(ForbiddenError);

      // 5. Deny: Sales Head calling cancelProjectHandover
      await expect(
        cancelProjectHandover(salesPrincipal, projectHandover.id)
      ).rejects.toThrow(ForbiddenError);
    } finally {
      await prisma.notification.deleteMany({
        where: {
          OR: [
            { link: { contains: testProject.id } },
            { link: { contains: testTask.id } },
          ],
        },
      });
      await prisma.taskHandover.deleteMany({ where: { task: { projectId: testProject.id } } });
      await prisma.projectHandover.deleteMany({ where: { projectId: testProject.id } });
      await prisma.taskAssignment.deleteMany({ where: { task: { projectId: testProject.id } } });
      await prisma.task.deleteMany({ where: { projectId: testProject.id } });
      await prisma.projectMember.deleteMany({ where: { projectId: testProject.id } });
      await prisma.project.delete({ where: { id: testProject.id } }).catch(() => {});
    }
  });
});

