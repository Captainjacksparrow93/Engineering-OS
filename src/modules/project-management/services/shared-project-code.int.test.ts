import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/core/db/prisma';
import { loadPrincipal } from '@/core/rbac/principal';
import { ForbiddenError, DomainError } from '@/core/rbac/errors';
import { createAutomationProject } from './automation-project.service';
import type { Principal } from '@/core/rbac/types';

describe('Plan 005: Shared Project Code Integration Tests', () => {
  let directorPrincipal: Principal;
  let pmPrincipal: Principal;
  let pmUserId: string;
  let testClient: { id: string; name: string; refNumber: string };
  const createdProjectIds: string[] = [];

  beforeAll(async () => {
    const directorUser = await prisma.user.findFirst({
      where: { roleAssignments: { some: { role: { key: 'DIRECTOR' } } }, status: 'ACTIVE' },
    });
    if (!directorUser) throw new Error('No active DIRECTOR user found in database');
    directorPrincipal = (await loadPrincipal(directorUser.id))!;

    const pmUser = await prisma.user.findFirst({
      where: {
        roleAssignments: {
          some: { role: { key: 'PROJECT_MANAGER' } },
          none: { role: { key: { in: ['DIRECTOR', 'TECHNICAL_HEAD', 'SERVICE_HEAD', 'SUPER_ADMIN'] } } },
        },
        status: 'ACTIVE',
      },
    });
    if (!pmUser) throw new Error('No active PROJECT_MANAGER user found in database');
    pmUserId = pmUser.id;
    pmPrincipal = (await loadPrincipal(pmUser.id))!;

    // Create a dedicated test client
    const randomSuffix = Math.floor(1000 + Math.random() * 8999);
    testClient = await prisma.client.create({
      data: {
        companyId: directorPrincipal.companyId,
        name: `Shared Code Client ${randomSuffix}`,
        refNumber: `ACS-${randomSuffix}`,
      },
    });
  });

  afterAll(async () => {
    if (createdProjectIds.length > 0) {
      await prisma.project.deleteMany({
        where: { id: { in: createdProjectIds } },
      });
    }
    if (testClient) {
      await prisma.client.delete({ where: { id: testClient.id } }).catch(() => {});
    }
  });

  it('allows two WORK_ORDER projects with the same explicit code and different WOs', async () => {
    const rand = Math.floor(1000 + Math.random() * 8999);
    const sharedCode = `TEST-SHARED-${rand}`;
    const wo1 = `WO-SH-${rand}-1`;
    const wo2 = `WO-SH-${rand}-2`;

    const p1 = await createAutomationProject(directorPrincipal, {
      kind: 'WORK_ORDER',
      workOrderNo: wo1,
      code: sharedCode,
      clientId: testClient.id,
      clientName: testClient.name,
      managerId: pmUserId,
    });
    createdProjectIds.push(p1.id);
    expect(p1.code).toBe(sharedCode);
    expect(p1.workOrderNo).toBe(wo1);

    const p2 = await createAutomationProject(directorPrincipal, {
      kind: 'WORK_ORDER',
      workOrderNo: wo2,
      code: sharedCode,
      clientId: testClient.id,
      clientName: testClient.name,
      managerId: pmUserId,
    });
    createdProjectIds.push(p2.id);
    expect(p2.code).toBe(sharedCode);
    expect(p2.workOrderNo).toBe(wo2);
    expect(p1.id).not.toBe(p2.id);
  });

  it('still rejects creating a project with a duplicate workOrderNo', async () => {
    const rand = Math.floor(1000 + Math.random() * 8999);
    const wo = `WO-DUP-${rand}`;

    const p = await createAutomationProject(directorPrincipal, {
      kind: 'WORK_ORDER',
      workOrderNo: wo,
      clientId: testClient.id,
      clientName: testClient.name,
      managerId: pmUserId,
    });
    createdProjectIds.push(p.id);

    await expect(
      createAutomationProject(directorPrincipal, {
        kind: 'WORK_ORDER',
        workOrderNo: wo,
        clientId: testClient.id,
        clientName: testClient.name,
        managerId: pmUserId,
      })
    ).rejects.toThrow(DomainError);
  });

  it('auto-generates clientRef-next when code is left blank', async () => {
    const rand = Math.floor(1000 + Math.random() * 8999);
    const wo = `WO-BLANK-${rand}`;

    const p = await createAutomationProject(directorPrincipal, {
      kind: 'WORK_ORDER',
      workOrderNo: wo,
      clientId: testClient.id,
      clientName: testClient.name,
      managerId: pmUserId,
    });
    createdProjectIds.push(p.id);

    expect(p.code).toMatch(new RegExp(`^${testClient.refNumber}-\\d{4}$`));
  });

  it('refuses project creation by PM lacking pm.project.create even with existing code', async () => {
    const rand = Math.floor(1000 + Math.random() * 8999);
    const wo = `WO-PM-${rand}`;

    await expect(
      createAutomationProject(pmPrincipal, {
        kind: 'WORK_ORDER',
        workOrderNo: wo,
        code: `TEST-EXISTING-${rand}`,
        clientId: testClient.id,
        clientName: testClient.name,
        managerId: pmUserId,
      })
    ).rejects.toThrow(ForbiddenError);
  });
});
