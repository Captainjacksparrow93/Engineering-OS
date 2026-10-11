import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/core/db/prisma';
import { loadPrincipal } from '@/core/rbac/principal';
import { DomainError, ForbiddenError } from '@/core/rbac/errors';
import {
  createAutomationProject,
  getPMTeamData,
} from '@/modules/project-management/services/automation-project.service';
import { updateProject } from '@/modules/project-management/services/project.service';
import type { Principal } from '@/core/rbac/types';

const LOCKED = 'This comes from the sales order. Change it in ERP.';

describe('Plan 014 step 7: order fields are locked on linked projects', () => {
  let director: Principal;
  let pm: Principal;
  let otherClient: { id: string };
  let client: { id: string; name: string; refNumber: string };
  const run = `${Date.now()}`.slice(-6);
  const projectIds: string[] = [];

  async function newProject(wo: string, salesOrder: string | null) {
    const project = await createAutomationProject(director, {
      kind: 'WORK_ORDER',
      workOrderNo: wo,
      clientId: client.id,
      clientName: client.name,
      managerId: pm.userId,
      startDate: '2026-10-01',
      targetEndDate: '2026-12-30',
      scopes: [{ templateCode: 'PLC', quantity: 1 }],
      panelDeliveryDates: { PLC_1: '2026-12-15' },
    });
    projectIds.push(project.id);
    if (!salesOrder) return project;
    return prisma.project.update({ where: { id: project.id }, data: { erpSalesOrder: salesOrder } });
  }

  beforeAll(async () => {
    const acs = await prisma.company.findFirst({ where: { code: 'ACS' } });
    const directorUser = await prisma.user.findFirst({
      where: { companyId: acs?.id, status: 'ACTIVE', roleAssignments: { some: { role: { key: 'DIRECTOR' } } } },
    });
    director = (await loadPrincipal(directorUser!.id))!;
    const { managers } = await getPMTeamData(director.companyId);
    pm = (await loadPrincipal(managers[0]!.id))!;
    client = await prisma.client.create({
      data: { companyId: director.companyId, name: `Lock Client ${run}`, refNumber: `ACS-L7-${run}` },
    });
    otherClient = await prisma.client.create({
      data: { companyId: director.companyId, name: `Lock Other ${run}`, refNumber: `ACS-L7O-${run}` },
    });
  });

  afterAll(async () => {
    for (const projectId of projectIds) {
      await prisma.taskDependency.deleteMany({ where: { predecessor: { projectId } } });
      await prisma.taskAssignment.deleteMany({ where: { task: { projectId } } });
      await prisma.task.deleteMany({ where: { projectId, parentId: { not: null } } });
      await prisma.task.deleteMany({ where: { projectId } });
      await prisma.projectMember.deleteMany({ where: { projectId } });
      await prisma.roleAssignment.deleteMany({ where: { scopeType: 'PROJECT', scopeId: projectId } });
      await prisma.project.delete({ where: { id: projectId } });
    }
    await prisma.client.deleteMany({ where: { id: { in: [client.id, otherClient.id] } } });
  });

  it('refuses each order field on a linked project', async () => {
    const project = await newProject(`71${run}`, `SO-L7-A-${run}`);
    const attempts = [
      { workOrderNo: `72${run}` },
      { clientId: otherClient.id },
      { clientName: 'Someone else' },
      { targetEndDate: new Date('2026-12-31T00:00:00.000Z') },
      { panelDeliveryDates: { PLC_1: '2026-12-20' } },
    ];
    for (const input of attempts) {
      await expect(updateProject(director, project.id, input)).rejects.toThrow(new DomainError(LOCKED));
    }
    const after = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
    expect(after.workOrderNo).toBe(`71${run}`);
    expect(after.clientId).toBe(client.id);
  });

  it('still saves code, priority and unchanged order values on a linked project (the dialog sends every field)', async () => {
    const project = await newProject(`73${run}`, `SO-L7-B-${run}`);
    const updated = await updateProject(director, project.id, {
      code: `LCK-${run}`,
      priority: 'HIGH',
      workOrderNo: `73${run}`,
      clientId: client.id,
      targetEndDate: new Date('2026-12-30T00:00:00.000Z'),
      panelDeliveryDates: { PLC_1: '2026-12-15' },
    });
    expect(updated.code).toBe(`LCK-${run}`);
    expect(updated.priority).toBe('HIGH');
  });

  it('keeps today’s behaviour on an unlinked project', async () => {
    const project = await newProject(`74${run}`, null);
    const updated = await updateProject(director, project.id, {
      workOrderNo: `75${run}`,
      clientId: otherClient.id,
      targetEndDate: new Date('2026-12-31T00:00:00.000Z'),
      panelDeliveryDates: { PLC_1: '2026-12-20' },
    });
    expect(updated.workOrderNo).toBe(`75${run}`);
    expect(updated.clientId).toBe(otherClient.id);
  });

  it('still forbids a PM', async () => {
    const project = await newProject(`76${run}`, `SO-L7-C-${run}`);
    await expect(updateProject(pm, project.id, { priority: 'LOW' })).rejects.toThrow(ForbiddenError);
  });
});
