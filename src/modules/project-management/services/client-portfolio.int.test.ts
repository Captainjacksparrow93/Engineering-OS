import { describe, it, expect } from 'vitest';
import { prisma } from '@/core/db/prisma';
import { loadPrincipal } from '@/core/rbac/principal';
import { ForbiddenError, NotFoundError } from '@/core/rbac/errors';
import { listClientsWithStats, getClientPortfolio } from './client.service';
import type { Principal } from '@/core/rbac/types';

describe('Clients Menu & Portfolio Integration (#6)', () => {
  it('throws ForbiddenError if principal lacks pm.project.read', async () => {
    const unprivileged: Principal = {
      userId: 'test-user',
      companyId: 'test-company',
      employeeCode: 'TEST',
      fullName: 'Test User',
      email: 'test@example.com',
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

    await expect(listClientsWithStats(unprivileged)).rejects.toThrow(ForbiddenError);
    await expect(getClientPortfolio(unprivileged, 'any-id')).rejects.toThrow(ForbiddenError);
  });

  it('throws NotFoundError for non-existent client or client from another company', async () => {
    const directorUser = await prisma.user.findFirst({
      where: { roleAssignments: { some: { role: { key: 'DIRECTOR' } } } },
    });
    expect(directorUser).not.toBeNull();
    const principal = (await loadPrincipal(directorUser!.id))!;

    // Non-existent client
    await expect(getClientPortfolio(principal, 'non-existent-client-id')).rejects.toThrow(NotFoundError);

    // Create client in another company
    const otherCompany = await prisma.company.create({
      data: {
        name: 'Other Co Test',
        code: `OCT-${Date.now()}`,
      },
    });

    const otherClient = await prisma.client.create({
      data: {
        companyId: otherCompany.id,
        name: `Foreign Client ${Date.now()}`,
        refNumber: `ACS-${Math.floor(1000 + Math.random() * 8000)}`,
      },
    });

    try {
      await expect(getClientPortfolio(principal, otherClient.id)).rejects.toThrow(NotFoundError);
    } finally {
      await prisma.client.delete({ where: { id: otherClient.id } });
      await prisma.company.delete({ where: { id: otherCompany.id } });
    }
  });

  it('aggregates stats and includes legacy clientName projects under client portfolio', async () => {
    const directorUser = await prisma.user.findFirst({
      where: { roleAssignments: { some: { role: { key: 'DIRECTOR' } } } },
    });
    expect(directorUser).not.toBeNull();
    const principal = (await loadPrincipal(directorUser!.id))!;

    const testRef = `ACS-${Math.floor(1000 + Math.random() * 8000)}`;
    const testClientName = `Test Integration Client ${Date.now()}`;

    // Create a new client
    const client = await prisma.client.create({
      data: {
        companyId: principal.companyId,
        name: testClientName,
        refNumber: testRef,
      },
    });

    // Create a project with clientId
    const proj1 = await prisma.project.create({
      data: {
        companyId: principal.companyId,
        code: `PRJ-INT-${Date.now()}-1`,
        workOrderNo: `WO-${Date.now()}-1`,
        name: `${testClientName} Project 1`,
        clientName: testClientName,
        clientId: client.id,
        status: 'IN_PROGRESS',
        priority: 'HIGH',
        managerId: directorUser!.id,
      },
    });

    // Create a legacy project with clientId = null but matching clientName
    const proj2 = await prisma.project.create({
      data: {
        companyId: principal.companyId,
        code: `PRJ-INT-${Date.now()}-2`,
        workOrderNo: `WO-${Date.now()}-2`,
        name: `${testClientName} Project 2 (Legacy)`,
        clientName: testClientName,
        clientId: null,
        status: 'COMPLETED',
        priority: 'MEDIUM',
        managerId: directorUser!.id,
      },
    });

    try {
      // 1. Verify listClientsWithStats
      const list = await listClientsWithStats(principal);
      const foundInList = list.find((c) => c.id === client.id);
      expect(foundInList).toBeDefined();
      expect(foundInList!.refNumber).toBe(testRef);
      expect(foundInList!.activeProjectsCount).toBe(1);
      expect(foundInList!.completedProjectsCount).toBe(1);
      expect(foundInList!.totalProjectsCount).toBe(2);

      // 2. Verify getClientPortfolio
      const portfolio = await getClientPortfolio(principal, client.id);
      expect(portfolio.client.name).toBe(testClientName);
      expect(portfolio.stats.activeCount).toBe(1);
      expect(portfolio.stats.completedCount).toBe(1);
      expect(portfolio.stats.totalCount).toBe(2);

      expect(portfolio.currentProjects).toHaveLength(1);
      expect(portfolio.currentProjects[0].id).toBe(proj1.id);
      expect(portfolio.currentProjects[0].status).toBe('IN_PROGRESS');

      expect(portfolio.pastProjects).toHaveLength(1);
      expect(portfolio.pastProjects[0].id).toBe(proj2.id);
      expect(portfolio.pastProjects[0].status).toBe('COMPLETED');
    } finally {
      await prisma.project.deleteMany({
        where: { id: { in: [proj1.id, proj2.id] } },
      });
      await prisma.client.delete({
        where: { id: client.id },
      });
    }
  });

  it('scopes visible projects based on principal visibility (pm vs director)', async () => {
    const directorUser = await prisma.user.findFirst({
      where: { roleAssignments: { some: { role: { key: 'DIRECTOR' } } } },
    });
    const pmUser = await prisma.user.findFirst({
      where: {
        id: { not: directorUser?.id },
        roleAssignments: {
          some: { role: { key: 'PROJECT_MANAGER' } },
        },
      },
    });
    expect(directorUser).not.toBeNull();
    expect(pmUser).not.toBeNull();

    const directorPrincipal = (await loadPrincipal(directorUser!.id))!;
    const pmPrincipal = (await loadPrincipal(pmUser!.id))!;

    const testRef = `ACS-${Math.floor(1000 + Math.random() * 8000)}`;
    const testClientName = `Scope Test Client ${Date.now()}`;

    const client = await prisma.client.create({
      data: {
        companyId: directorPrincipal.companyId,
        name: testClientName,
        refNumber: testRef,
      },
    });

    // Project managed by director where engineer is NOT a member/assignee
    const proj = await prisma.project.create({
      data: {
        companyId: directorPrincipal.companyId,
        code: `PRJ-SCOPE-${Date.now()}`,
        workOrderNo: `WO-SCOPE-${Date.now()}`,
        name: `${testClientName} Project`,
        clientName: testClientName,
        clientId: client.id,
        status: 'IN_PROGRESS',
        managerId: directorUser!.id,
      },
    });

    try {
      // Director sees the project
      const directorPortfolio = await getClientPortfolio(directorPrincipal, client.id);
      expect(directorPortfolio.stats.activeCount).toBe(1);

      // PM does not see this unassigned project
      const pmPortfolio = await getClientPortfolio(pmPrincipal, client.id);
      expect(pmPortfolio.stats.activeCount).toBe(0);
      expect(pmPortfolio.currentProjects).toHaveLength(0);
    } finally {
      await prisma.project.delete({ where: { id: proj.id } });
      await prisma.client.delete({ where: { id: client.id } });
    }
  });
});
