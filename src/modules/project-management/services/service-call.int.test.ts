import { describe, it, expect } from 'vitest';
import { prisma } from '@/core/db/prisma';
import { loadPrincipal } from '@/core/rbac/principal';
import { ForbiddenError } from '@/core/rbac/errors';
import { createAutomationProject } from './automation-project.service';
import type { Principal } from '@/core/rbac/types';

describe('Urgent Service Call (#1) Integration Tests', () => {
  it('throws ForbiddenError if principal lacks pm.project.create', async () => {
    const unprivileged: Principal = {
      userId: 'test-user-service-call',
      companyId: 'test-company',
      employeeCode: 'TEST',
      fullName: 'Test User',
      email: 'test-sc@example.com',
      grade: 'ENGINEER',
      departmentId: null,
      managerId: null,
      avatarColor: '#888888',
      roleKeys: [],
      grants: [],
      memberProjectIds: [],
      coveredDepartmentIds: [],
      reportIds: [],
    };

    await expect(
      createAutomationProject(unprivileged, {
        kind: 'SERVICE_CALL',
        clientName: 'Test Client',
        clientId: 'any-client',
        managerId: 'any-manager',
      })
    ).rejects.toThrow(ForbiddenError);
  });

  it('allows creating multiple service calls with null workOrderNo without collision', async () => {
    const directorUser = await prisma.user.findFirst({
      where: { roleAssignments: { some: { role: { key: 'DIRECTOR' } } } },
    });
    if (!directorUser) return; // skip if db not running/seeded
    const principal = (await loadPrincipal(directorUser.id))!;

    const testClient = await prisma.client.create({
      data: {
        companyId: principal.companyId,
        name: `Service Call Client ${Date.now()}`,
        refNumber: `ACS-${Math.floor(1000 + Math.random() * 8000)}`,
      },
    });

    let sc1: any;
    let sc2: any;

    try {
      sc1 = await createAutomationProject(principal, {
        kind: 'SERVICE_CALL',
        clientName: testClient.name,
        clientId: testClient.id,
        managerId: principal.userId,
      });

      sc2 = await createAutomationProject(principal, {
        kind: 'SERVICE_CALL',
        clientName: testClient.name,
        clientId: testClient.id,
        managerId: principal.userId,
      });

      expect(sc1.kind).toBe('SERVICE_CALL');
      expect(sc1.workOrderNo).toBeNull();
      expect(sc1.name).toContain(`SC ${testClient.name}`);

      expect(sc2.kind).toBe('SERVICE_CALL');
      expect(sc2.workOrderNo).toBeNull();
      expect(sc2.name).toContain(`SC ${testClient.name}`);
      expect(sc1.id).not.toBe(sc2.id);
    } finally {
      if (sc1 || sc2) {
        await prisma.project.deleteMany({
          where: { id: { in: [sc1?.id, sc2?.id].filter(Boolean) } },
        });
      }
      await prisma.client.delete({ where: { id: testClient.id } }).catch(() => {});
    }
  });
});
