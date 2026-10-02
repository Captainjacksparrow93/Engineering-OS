import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/core/db/prisma';
import { loadPrincipal } from '@/core/rbac/principal';
import { ForbiddenError, DomainError } from '@/core/rbac/errors';
import { createAutomationProject, getPMTeamData } from './automation-project.service';
import { updateProject } from './project.service';
import { updateClient } from './client.service';
import type { Principal } from '@/core/rbac/types';

describe('Plan 008: Edit Project and Client Integration Tests', () => {
  let directorPrincipal: Principal;
  let technicalHeadPrincipal: Principal;
  let pmPrincipal: Principal;
  let pmId: string;
  let testClient: { id: string; name: string; refNumber: string };
  const createdProjectIds: string[] = [];
  const createdClientIds: string[] = [];

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

    const headUser = await prisma.user.findFirst({
      where: {
        companyId: acsCompany?.id,
        roleAssignments: { some: { role: { key: 'TECHNICAL_HEAD' } } },
        status: 'ACTIVE',
      },
    });
    if (!headUser) throw new Error('No active TECHNICAL_HEAD user found in database');
    technicalHeadPrincipal = (await loadPrincipal(headUser.id))!;

    const { managers } = await getPMTeamData(directorPrincipal.companyId);
    if (managers.length === 0) throw new Error('No managers found');

    pmId = managers[0]!.id;
    pmPrincipal = (await loadPrincipal(pmId))!;

    const rand = Math.floor(1000 + Math.random() * 8999);
    testClient = await prisma.client.create({
      data: {
        companyId: directorPrincipal.companyId,
        name: `Edit Test Client ${rand}`,
        refNumber: `ACS-${rand}`,
      },
    });
    createdClientIds.push(testClient.id);
  });

  afterAll(async () => {
    for (const projId of createdProjectIds) {
      await prisma.notification.deleteMany({ where: { link: { contains: projId } } });
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

    for (const clientId of createdClientIds) {
      await prisma.client.delete({ where: { id: clientId } }).catch(() => {});
    }
  });

  it('allows Director to edit WO, code, dates, priority and panel date, saving and auditing all changes', async () => {
    const rand = Math.floor(10000 + Math.random() * 89999);
    const initial = await createAutomationProject(directorPrincipal, {
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
    });
    createdProjectIds.push(initial.id);

    const newWO = String(rand + 1);
    const newCode = `EDIT-CODE-${rand}`;
    const newStart = new Date('2026-10-05T00:00:00.000Z');
    const newTarget = new Date('2026-11-15T00:00:00.000Z');
    const newPanelDate = '2026-11-10';

    const updated = await updateProject(directorPrincipal, initial.id, {
      workOrderNo: newWO,
      code: newCode,
      startDate: newStart,
      targetEndDate: newTarget,
      priority: 'HIGH',
      endUserName: 'New End User',
      applicationName: 'New App',
      panelDeliveryDates: {
        PLC_1: newPanelDate,
      },
    });

    expect(updated.workOrderNo).toBe(newWO);
    expect(updated.code).toBe(newCode);
    expect(updated.priority).toBe('HIGH');
    expect(updated.endUserName).toBe('New End User');
    expect(updated.applicationName).toBe('New App');

    // Verify PHASE task plannedEnd was updated
    const phaseTask = await prisma.task.findFirst({
      where: { projectId: initial.id, type: 'PHASE', title: 'PLC Panel 1' },
    });
    expect(phaseTask).not.toBeNull();
    expect(phaseTask!.plannedEnd?.toISOString().slice(0, 10)).toBe(newPanelDate);

    // Verify audit log
    const auditLog = await prisma.auditLog.findFirst({
      where: {
        entityType: 'Project',
        entityId: initial.id,
        action: 'project.updated',
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(auditLog).not.toBeNull();
    const diff = auditLog!.diff as Record<string, unknown>;
    expect(diff['priority']).toBeDefined();
    expect(diff['PLC Panel 1 delivery']).toBeDefined();
  });

  it('forbids PM from calling updateProject', async () => {
    const rand = Math.floor(10000 + Math.random() * 89999);
    const project = await createAutomationProject(directorPrincipal, {
      kind: 'WORK_ORDER',
      workOrderNo: String(rand),
      clientId: testClient.id,
      clientName: testClient.name,
      managerId: pmId,
      startDate: '2026-10-01',
      targetEndDate: '2026-10-30',
      scopes: [{ templateCode: 'PLC', quantity: 1 }],
    });
    createdProjectIds.push(project.id);

    await expect(
      updateProject(pmPrincipal, project.id, {
        name: 'Hacked Name',
      })
    ).rejects.toThrow(ForbiddenError);
  });

  it('refuses moving target date before a panel date, naming the panel', async () => {
    const rand = Math.floor(10000 + Math.random() * 89999);
    const project = await createAutomationProject(directorPrincipal, {
      kind: 'WORK_ORDER',
      workOrderNo: String(rand),
      clientId: testClient.id,
      clientName: testClient.name,
      managerId: pmId,
      startDate: '2026-10-01',
      targetEndDate: '2026-10-30',
      scopes: [{ templateCode: 'PLC', quantity: 1 }],
      panelDeliveryDates: {
        PLC_1: '2026-10-25',
      },
    });
    createdProjectIds.push(project.id);

    // Moving target date to 2026-10-20 (which is before PLC Panel 1 delivery date 2026-10-25)
    await expect(
      updateProject(directorPrincipal, project.id, {
        targetEndDate: new Date('2026-10-20T00:00:00.000Z'),
      })
    ).rejects.toThrow(/PLC Panel 1.*after.*target/i);
  });

  it('refuses duplicate workOrderNo on updateProject', async () => {
    const rand1 = Math.floor(10000 + Math.random() * 40000);
    const rand2 = Math.floor(50000 + Math.random() * 40000);

    const p1 = await createAutomationProject(directorPrincipal, {
      kind: 'WORK_ORDER',
      workOrderNo: String(rand1),
      clientId: testClient.id,
      clientName: testClient.name,
      managerId: pmId,
      startDate: '2026-10-01',
      targetEndDate: '2026-10-30',
      scopes: [{ templateCode: 'PLC', quantity: 1 }],
    });
    createdProjectIds.push(p1.id);

    const p2 = await createAutomationProject(directorPrincipal, {
      kind: 'WORK_ORDER',
      workOrderNo: String(rand2),
      clientId: testClient.id,
      clientName: testClient.name,
      managerId: pmId,
      startDate: '2026-10-01',
      targetEndDate: '2026-10-30',
      scopes: [{ templateCode: 'PLC', quantity: 1 }],
    });
    createdProjectIds.push(p2.id);

    // Attempt to update p2 to p1's workOrderNo
    await expect(
      updateProject(directorPrincipal, p2.id, {
        workOrderNo: String(rand1),
      })
    ).rejects.toThrow(DomainError);
  });

  it('allows Technical Head to rename a client and cascades new clientName to projects', async () => {
    const rand = Math.floor(1000 + Math.random() * 8999);
    const client = await prisma.client.create({
      data: {
        companyId: directorPrincipal.companyId,
        name: `Cascade Test Client ${rand}`,
        refNumber: `ACS-${rand}`,
      },
    });
    createdClientIds.push(client.id);

    const project = await createAutomationProject(directorPrincipal, {
      kind: 'WORK_ORDER',
      workOrderNo: String(rand),
      clientId: client.id,
      clientName: client.name,
      managerId: pmId,
      startDate: '2026-10-01',
      targetEndDate: '2026-10-30',
      scopes: [{ templateCode: 'PLC', quantity: 1 }],
    });
    createdProjectIds.push(project.id);

    const updatedClientName = `Renamed Client ${rand}`;
    const updatedClient = await updateClient(technicalHeadPrincipal, client.id, {
      name: updatedClientName,
      refNumber: client.refNumber,
    });
    expect(updatedClient.name).toBe(updatedClientName);

    // Verify cascade to project
    const refreshedProject = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
    expect(refreshedProject.clientName).toBe(updatedClientName);

    // Verify client audit
    const auditLog = await prisma.auditLog.findFirst({
      where: {
        entityType: 'Client',
        entityId: client.id,
        action: 'client.updated',
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(auditLog).not.toBeNull();
  });

  it('rejects duplicate client reference number with friendly message naming the existing client', async () => {
    const rand1 = Math.floor(1000 + Math.random() * 4000);
    const rand2 = Math.floor(5000 + Math.random() * 4000);

    const c1 = await prisma.client.create({
      data: {
        companyId: directorPrincipal.companyId,
        name: `Unique Ref Client A ${rand1}`,
        refNumber: `ACS-${rand1}`,
      },
    });
    createdClientIds.push(c1.id);

    const c2 = await prisma.client.create({
      data: {
        companyId: directorPrincipal.companyId,
        name: `Unique Ref Client B ${rand2}`,
        refNumber: `ACS-${rand2}`,
      },
    });
    createdClientIds.push(c2.id);

    await expect(
      updateClient(directorPrincipal, c2.id, {
        name: c2.name,
        refNumber: `ACS-${rand1}`,
      })
    ).rejects.toThrow(`Reference number ACS-${rand1} is already used by Unique Ref Client A ${rand1}.`);
  });

  it('forbids PM from calling updateClient', async () => {
    const rand = Math.floor(1000 + Math.random() * 8999);
    const client = await prisma.client.create({
      data: {
        companyId: directorPrincipal.companyId,
        name: `PM Forbidden Client ${rand}`,
        refNumber: `ACS-${rand}`,
      },
    });
    createdClientIds.push(client.id);

    await expect(
      updateClient(pmPrincipal, client.id, {
        name: 'Hacked Client Name',
        refNumber: `ACS-${rand}`,
      })
    ).rejects.toThrow(ForbiddenError);
  });

  it('ignores any status passed to updateProject, keeping project status unchanged', async () => {
    const rand = Math.floor(10000 + Math.random() * 89999);
    const initial = await createAutomationProject(directorPrincipal, {
      kind: 'WORK_ORDER',
      workOrderNo: String(rand),
      clientId: testClient.id,
      clientName: testClient.name,
      managerId: pmId,
      startDate: '2026-10-01',
      targetEndDate: '2026-10-30',
      scopes: [{ templateCode: 'PLC', quantity: 1 }],
    });
    createdProjectIds.push(initial.id);
    expect(initial.status).toBe('PLANNING');

    const inputWithStatus = Object.assign({ priority: 'HIGH' as const }, { status: 'COMPLETED' });
    const updated = await updateProject(directorPrincipal, initial.id, inputWithStatus);

    expect(updated.priority).toBe('HIGH');
    expect(updated.status).toBe('PLANNING');

    const fromDb = await prisma.project.findUnique({ where: { id: initial.id } });
    expect(fromDb?.status).toBe('PLANNING');
    expect(fromDb?.actualEndDate).toBeNull();
  });
});
