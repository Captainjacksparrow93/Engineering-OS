import { describe, it, expect, afterAll } from 'vitest';
import { prisma } from '@/core/db/prisma';
import { loadPrincipal } from '@/core/rbac/principal';
import { listProjects, getProjectWorkspace, getProjectTimeline } from './project.service';
import { getDashboard } from './dashboard.service';
import { projectProgress } from '../domain/portfolio';

describe('Project Progress and Step Count Consistency (#004 Step 1)', () => {
  let createdProjectId: string | undefined;
  let createdClientId: string | undefined;

  afterAll(async () => {
    if (createdProjectId) {
      await prisma.task.deleteMany({ where: { projectId: createdProjectId } });
      await prisma.projectMember.deleteMany({ where: { projectId: createdProjectId } });
      await prisma.project.delete({ where: { id: createdProjectId } }).catch(() => {});
    }
    if (createdClientId) {
      await prisma.client.delete({ where: { id: createdClientId } }).catch(() => {});
    }
  });

  it('guarantees listProjects, getProjectWorkspace, getProjectTimeline and dashboard report identical step counts and progress', async () => {
    const directorUser = await prisma.user.findFirst({
      where: { roleAssignments: { some: { role: { key: 'DIRECTOR' } } } },
    });
    if (!directorUser) return;
    const principal = (await loadPrincipal(directorUser.id))!;

    const client = await prisma.client.create({
      data: {
        companyId: principal.companyId,
        name: `Progress Test Client ${Date.now()}`,
        refNumber: `ACS-TEST-${Math.floor(1000 + Math.random() * 8000)}`,
      },
    });
    createdClientId = client.id;

    // Create a project with 2 panel PHASE rows
    const project = await prisma.project.create({
      data: {
        companyId: principal.companyId,
        name: 'WO 9998',
        code: `ACS-TEST-${Date.now()}`,
        clientName: client.name,
        clientId: client.id,
        managerId: principal.userId,
        status: 'IN_PROGRESS',
        priority: 'HIGH',
        startDate: new Date('2026-09-01'),
        targetEndDate: new Date('2026-10-30'),
        tasks: {
          create: [
            {
              code: 'PH-1',
              title: 'PLC Panel 1',
              type: 'PHASE',
              status: 'IN_PROGRESS',
              estimatedHours: 40,
              percentComplete: 50,
              createdById: principal.userId,
            },
            {
              code: 'PH-2',
              title: 'SCADA Panel 1',
              type: 'PHASE',
              status: 'IN_PROGRESS',
              estimatedHours: 40,
              percentComplete: 0,
              createdById: principal.userId,
            },
          ],
        },
      },
      include: { tasks: true },
    });
    createdProjectId = project.id;

    const ph1 = project.tasks.find((t) => t.code === 'PH-1')!;
    const ph2 = project.tasks.find((t) => t.code === 'PH-2')!;

    // Create child tasks under PH-1: 3 tasks (2 completed, 1 in progress)
    await prisma.task.createMany({
      data: [
        {
          projectId: project.id,
          parentId: ph1.id,
          code: 'PH-1-1',
          title: 'I/O List Preparation',
          type: 'PROJECT',
          status: 'COMPLETED',
          percentComplete: 100,
          estimatedHours: 10,
          createdById: principal.userId,
        },
        {
          projectId: project.id,
          parentId: ph1.id,
          code: 'PH-1-2',
          title: 'Logic Development',
          type: 'PROJECT',
          status: 'COMPLETED',
          percentComplete: 100,
          estimatedHours: 20,
          createdById: principal.userId,
        },
        {
          projectId: project.id,
          parentId: ph1.id,
          code: 'PH-1-3',
          title: 'Internal Testing',
          type: 'PROJECT',
          status: 'IN_PROGRESS',
          percentComplete: 50,
          estimatedHours: 10,
          createdById: principal.userId,
        },
      ],
    });

    // Create child tasks under PH-2: 3 tasks (1 in progress, 1 todo, 1 cancelled)
    await prisma.task.createMany({
      data: [
        {
          projectId: project.id,
          parentId: ph2.id,
          code: 'PH-2-1',
          title: 'Screen Design',
          type: 'PROJECT',
          status: 'IN_PROGRESS',
          percentComplete: 50,
          estimatedHours: 15,
          createdById: principal.userId,
        },
        {
          projectId: project.id,
          parentId: ph2.id,
          code: 'PH-2-2',
          title: 'Tag Binding',
          type: 'PROJECT',
          status: 'TODO',
          percentComplete: 0,
          estimatedHours: 15,
          createdById: principal.userId,
        },
        {
          projectId: project.id,
          parentId: ph2.id,
          code: 'PH-2-3',
          title: 'Obsolete Report Scripting',
          type: 'PROJECT',
          status: 'CANCELLED',
          percentComplete: 0,
          estimatedHours: 10,
          createdById: principal.userId,
        },
      ],
    });

    // Create an ad-hoc/urgent task without parent (no panel)
    await prisma.task.create({
      data: {
        projectId: project.id,
        code: 'ADHOC-1',
        title: 'Urgent Site Valve Support',
        type: 'ADHOC',
        status: 'IN_PROGRESS',
        percentComplete: 20,
        estimatedHours: 10,
        createdById: principal.userId,
      },
    });

    // Fetch all tasks directly to compute expected ground truth using domain projectProgress
    const allDbTasks = await prisma.task.findMany({ where: { projectId: project.id } });
    const expectedProgress = projectProgress(allDbTasks);

    // Total tasks in DB = 9 (2 phase + 6 phase children + 1 adhoc)
    // Leaf non-cancelled tasks = 6 (5 in panels + 1 panel-less adhoc)
    // Completed leaf tasks = 2
    const expectedTotalSteps = 6;
    const expectedCompletedSteps = 2;

    // 1. Check getProjectTimeline
    const timeline = await getProjectTimeline(principal, project.id);
    expect(timeline.totalSteps).toBe(expectedTotalSteps);
    expect(timeline.completedSteps).toBe(expectedCompletedSteps);
    expect(timeline.lanes.some((l) => l.name === 'Other tasks')).toBe(true);

    // 2. Check getProjectWorkspace summary
    const workspace = await getProjectWorkspace(principal, project.id);
    expect(workspace.summary.taskCount).toBe(expectedTotalSteps);
    expect(workspace.summary.completedCount).toBe(expectedCompletedSteps);
    expect(workspace.summary.progressPercent).toBe(expectedProgress);

    // 3. Check listProjects
    const listed = await listProjects(principal, { search: project.code });
    const projectItem = listed.find((p) => p.id === project.id);
    expect(projectItem).toBeDefined();
    expect(projectItem!.stats.taskCount).toBe(expectedTotalSteps);
    expect(projectItem!.stats.completedCount).toBe(expectedCompletedSteps);
    expect(projectItem!.stats.progressPercent).toBe(expectedProgress);

    // 4. Check dashboard
    const dashboard = (await getDashboard(principal, 'week')) as any;
    const dashboardProject = dashboard.projects.find((p: any) => p.id === project.id);
    expect(dashboardProject).toBeDefined();
    expect(dashboardProject!.progressPercent).toBe(expectedProgress);
  });
});
