import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/core/db/prisma';
import { loadPrincipal } from '@/core/rbac/principal';
import { createAutomationProject, getPMTeamData } from './automation-project.service';
import { updateTask } from './task.service';
import type { Principal } from '@/core/rbac/types';

describe('Plan 007: Panel Delivery Dates Integration Tests', () => {
  let directorPrincipal: Principal;
  let pmPrincipal: Principal;
  let pmId: string;
  let testClient: { id: string; name: string; refNumber: string };
  const createdProjectIds: string[] = [];

  beforeAll(async () => {
    const acsCompany = await prisma.company.findFirst({ where: { code: 'ACS' } });
    const directorUser = await prisma.user.findFirst({
      where: {
        companyId: acsCompany?.id,
        roleAssignments: { some: { role: { key: 'DIRECTOR' } } },
        status: 'ACTIVE',
      },
    });
    if (!directorUser) throw new Error('No active DIRECTOR user found in database');
    directorPrincipal = (await loadPrincipal(directorUser.id))!;

    const { managers } = await getPMTeamData(directorPrincipal.companyId);
    if (managers.length === 0) throw new Error('No managers found');

    pmId = managers[0]!.id;
    pmPrincipal = (await loadPrincipal(pmId))!;

    const rand = Math.floor(1000 + Math.random() * 8999);
    testClient = await prisma.client.create({
      data: {
        companyId: directorPrincipal.companyId,
        name: `Panel Date Client ${rand}`,
        refNumber: `ACS-PD-${rand}`,
      },
    });
  });

  afterAll(async () => {
    for (const projId of createdProjectIds) {
      await prisma.notification.deleteMany({
        where: { link: { contains: projId } },
      });
      await prisma.taskHandover.deleteMany({ where: { task: { projectId: projId } } });
      await prisma.projectHandover.deleteMany({ where: { projectId: projId } });
      await prisma.taskDependency.deleteMany({ where: { predecessor: { projectId: projId } } });
      await prisma.taskAssignment.deleteMany({ where: { task: { projectId: projId } } });
      await prisma.task.deleteMany({ where: { projectId: projId } });
      await prisma.projectMember.deleteMany({ where: { projectId: projId } });
      if (projId) {
        await prisma.project.delete({ where: { id: projId } }).catch(() => {});
      }
    }

    if (testClient) {
      await prisma.client.delete({ where: { id: testClient.id } }).catch(() => {});
    }
  });

  it('stores panel delivery date on PHASE task and plans its steps to end on or before that date', async () => {
    const startDate = '2026-10-01';
    const targetEndDate = '2026-10-30';
    const panelDeliveryDate = '2026-10-20';

    const rand = Math.floor(10000 + Math.random() * 89999);
    const created = await createAutomationProject(directorPrincipal, {
      kind: 'WORK_ORDER',
      workOrderNo: String(rand),
      clientId: testClient.id,
      clientName: testClient.name,
      managerId: pmId,
      startDate,
      targetEndDate,
      scopes: [{ templateCode: 'PLC', quantity: 1 }],
      panelDeliveryDates: {
        PLC_1: panelDeliveryDate,
      },
    });
    createdProjectIds.push(created.id);

    // 1. Verify PHASE task has panel delivery date
    const phaseTask = await prisma.task.findFirst({
      where: { projectId: created.id, type: 'PHASE', title: 'PLC Panel 1' },
    });
    expect(phaseTask).not.toBeNull();
    const phaseEndStr = phaseTask!.plannedEnd?.toISOString().slice(0, 10);
    expect(phaseEndStr).toBe(panelDeliveryDate);

    // 2. Verify all child steps end on or before panel delivery date
    const steps = await prisma.task.findMany({
      where: { projectId: created.id, parentId: phaseTask!.id },
    });
    expect(steps.length).toBeGreaterThan(0);
    const maxEnd = new Date(`${panelDeliveryDate}T23:59:59.999Z`);
    for (const step of steps) {
      expect(step.plannedEnd).not.toBeNull();
      expect(new Date(step.plannedEnd!).getTime()).toBeLessThanOrEqual(maxEnd.getTime());
    }
  });

  it('rejects panel date after project target delivery date with error naming the panel', async () => {
    const rand = Math.floor(10000 + Math.random() * 89999);
    await expect(
      createAutomationProject(directorPrincipal, {
        kind: 'WORK_ORDER',
        workOrderNo: String(rand),
        clientId: testClient.id,
        clientName: testClient.name,
        managerId: pmId,
        startDate: '2026-10-01',
        targetEndDate: '2026-10-30',
        scopes: [{ templateCode: 'PLC', quantity: 1 }],
        panelDeliveryDates: {
          PLC_1: '2026-11-05',
        },
      }),
    ).rejects.toThrow(/PLC Panel 1.*after.*target/i);
  });

  it('rejects panel date before project start date with error naming the panel', async () => {
    const rand = Math.floor(10000 + Math.random() * 89999);
    await expect(
      createAutomationProject(directorPrincipal, {
        kind: 'WORK_ORDER',
        workOrderNo: String(rand),
        clientId: testClient.id,
        clientName: testClient.name,
        managerId: pmId,
        startDate: '2026-10-01',
        targetEndDate: '2026-10-30',
        scopes: [{ templateCode: 'PLC', quantity: 1 }],
        panelDeliveryDates: {
          PLC_1: '2026-09-20',
        },
      }),
    ).rejects.toThrow(/PLC Panel 1.*before.*start/i);
  });

  it('refuses PM updateTask on a PHASE task plannedEnd', async () => {
    // Pick an existing PHASE task or create one
    const startDate = '2026-10-01';
    const targetEndDate = '2026-10-30';
    const rand = Math.floor(10000 + Math.random() * 89999);
    const created = await createAutomationProject(directorPrincipal, {
      kind: 'WORK_ORDER',
      workOrderNo: String(rand),
      clientId: testClient.id,
      clientName: testClient.name,
      managerId: pmId,
      startDate,
      targetEndDate,
      scopes: [{ templateCode: 'PLC', quantity: 1 }],
    });
    createdProjectIds.push(created.id);

    const phaseTask = await prisma.task.findFirstOrThrow({
      where: { projectId: created.id, type: 'PHASE' },
    });

    // PM tries to update plannedEnd on the PHASE task
    await expect(
      updateTask(pmPrincipal, phaseTask.id, {
        plannedEnd: new Date('2026-10-25'),
      }),
    ).rejects.toThrow();
  });

  it('rejects task draft whose plannedEnd is after its panel delivery date naming the panel', async () => {
    const rand = Math.floor(10000 + Math.random() * 89999);
    await expect(
      createAutomationProject(directorPrincipal, {
        kind: 'WORK_ORDER',
        workOrderNo: String(rand),
        clientId: testClient.id,
        clientName: testClient.name,
        managerId: pmId,
        startDate: '2026-10-01',
        targetEndDate: '2026-10-30',
        scopes: [{ templateCode: 'PLC', quantity: 1 }],
        panelDeliveryDates: {
          PLC_1: '2026-10-20',
        },
        tasks: [
          {
            templateCode: 'PLC',
            unitIndex: 1,
            stepNumber: 1,
            title: 'Review Control Philosophy',
            assigneeId: pmId,
            plannedStart: '2026-10-01',
            plannedEnd: '2026-10-25',
            estimatedHours: 8,
          },
        ],
      }),
    ).rejects.toThrow(/PLC Panel 1.*after.*panel delivery date/i);
  });

  it('rejects panel date with too few working days naming the panel and required days (F3)', async () => {
    const rand = Math.floor(10000 + Math.random() * 89999);
    await expect(
      createAutomationProject(directorPrincipal, {
        kind: 'WORK_ORDER',
        workOrderNo: String(rand),
        clientId: testClient.id,
        clientName: testClient.name,
        managerId: pmId,
        startDate: '2026-10-01',
        targetEndDate: '2026-10-30',
        scopes: [{ templateCode: 'PLC', quantity: 1 }],
        panelDeliveryDates: {
          PLC_1: '2026-10-15',
        },
      }),
    ).rejects.toThrow(/PLC Panel 1 needs at least 14 working days \(finishes 16 Oct\)/);
  });
});
