import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/core/db/prisma';
import { loadPrincipal } from '@/core/rbac/principal';
import { DomainError, ForbiddenError } from '@/core/rbac/errors';
import { createAutomationProject, getPMTeamData } from './automation-project.service';
import type { Principal } from '@/core/rbac/types';

describe('Plan 006: All Engineers on New Project Integration Tests', () => {
  let directorPrincipal: Principal;
  let pmPrincipal: Principal;
  let pmAId: string;
  let pmBId: string;
  let engineerB: { id: string; fullName: string };
  let testClient: { id: string; name: string; refNumber: string };
  const createdProjectIds: string[] = [];
  const createdUserIds: string[] = [];
  const createdCompanyIds: string[] = [];

  beforeAll(async () => {
    const directorUser = await prisma.user.findFirst({
      where: { roleAssignments: { some: { role: { key: 'DIRECTOR' } } }, status: 'ACTIVE' },
    });
    if (!directorUser) throw new Error('No active DIRECTOR user found in database');
    directorPrincipal = (await loadPrincipal(directorUser.id))!;

    const { managers, teamsByPM, allEngineers } = await getPMTeamData(directorPrincipal.companyId);
    if (managers.length < 2) {
      throw new Error('At least 2 Project Managers required for cross-team testing');
    }

    pmAId = managers[0]!.id;
    pmBId = managers[1]!.id;
    pmPrincipal = (await loadPrincipal(pmAId))!;

    // Find an engineer in PM B's team who is NOT in PM A's team
    const teamAIds = new Set(teamsByPM[pmAId] || []);
    const teamBIds = teamsByPM[pmBId] || [];
    const engCandidateId = teamBIds.find((id) => id !== pmBId && !teamAIds.has(id));

    if (!engCandidateId) {
      // If no engineer in PM B's team, check allEngineers for someone not in PM A's team
      const fallback = allEngineers.find((e) => !teamAIds.has(e.id) && e.id !== pmAId);
      if (!fallback) throw new Error('No engineer found outside PM A team');
      engineerB = fallback;
    } else {
      const found = allEngineers.find((e) => e.id === engCandidateId);
      if (!found) throw new Error(`Engineer ${engCandidateId} not found in allEngineers`);
      engineerB = found;
    }

    // Create a test client
    const rand = Math.floor(1000 + Math.random() * 8999);
    testClient = await prisma.client.create({
      data: {
        companyId: directorPrincipal.companyId,
        name: `Cross-Team Client ${rand}`,
        refNumber: `ACS-${rand}`,
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
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({
        where: { id: { in: createdUserIds } },
      });
    }
    if (createdCompanyIds.length > 0) {
      await prisma.company.deleteMany({
        where: { id: { in: createdCompanyIds } },
      });
    }
  });

  it('allows Director to create project for PM A with panel assigned to engineer from PM B team', async () => {
    const rand = Math.floor(1000 + Math.random() * 8999);
    const wo = `WO-XT-${rand}`;

    const project = await createAutomationProject(directorPrincipal, {
      kind: 'WORK_ORDER',
      workOrderNo: wo,
      clientId: testClient.id,
      clientName: testClient.name,
      managerId: pmAId,
      tasks: [
        {
          templateCode: 'PLC',
          stepNumber: 1,
          unitIndex: 1,
          title: 'PLC Hardware Configuration',
          assigneeId: engineerB.id,
        },
      ],
    });
    createdProjectIds.push(project.id);

    expect(project.id).toBeDefined();
    expect(project.managerId).toBe(pmAId);

    // Verify engineerB became a project member
    const member = await prisma.projectMember.findFirst({
      where: { projectId: project.id, userId: engineerB.id },
    });
    expect(member).not.toBeNull();
    expect(member?.role).toBe('ENGINEER');
  });

  it('still rejects an inactive assignee or an assignee from another company', async () => {
    const rand = Math.floor(1000 + Math.random() * 8999);
    const otherCompany = await prisma.company.create({
      data: { name: `Other Co ${rand}`, code: `OTH-${rand}` },
    });
    createdCompanyIds.push(otherCompany.id);

    const otherUser = await prisma.user.create({
      data: {
        companyId: otherCompany.id,
        fullName: 'Foreign Engineer',
        email: `foreign-${rand}@example.com`,
        status: 'ACTIVE',
        employeeCode: `EXT-${rand}`,
        passwordHash: 'dummy-hash',
      },
    });
    createdUserIds.push(otherUser.id);

    await expect(
      createAutomationProject(directorPrincipal, {
        kind: 'WORK_ORDER',
        workOrderNo: `WO-FOREIGN-${rand}`,
        clientId: testClient.id,
        clientName: testClient.name,
        managerId: pmAId,
        tasks: [
          {
            templateCode: 'PLC',
            stepNumber: 1,
            unitIndex: 1,
            title: 'PLC Hardware Configuration',
            assigneeId: otherUser.id,
          },
        ],
      })
    ).rejects.toThrow(DomainError);

    // Inactive user in same company
    const inactiveUser = await prisma.user.create({
      data: {
        companyId: directorPrincipal.companyId,
        fullName: 'Inactive Engineer',
        email: `inactive-${rand}@example.com`,
        status: 'SUSPENDED',
        employeeCode: `INA-${rand}`,
        passwordHash: 'dummy-hash',
      },
    });
    createdUserIds.push(inactiveUser.id);

    await expect(
      createAutomationProject(directorPrincipal, {
        kind: 'WORK_ORDER',
        workOrderNo: `WO-INACTIVE-${rand}`,
        clientId: testClient.id,
        clientName: testClient.name,
        managerId: pmAId,
        tasks: [
          {
            templateCode: 'PLC',
            stepNumber: 1,
            unitIndex: 1,
            title: 'PLC Hardware Configuration',
            assigneeId: inactiveUser.id,
          },
        ],
      })
    ).rejects.toThrow(DomainError);
  });

  it('refuses project creation by PM lacking pm.project.create', async () => {
    const rand = Math.floor(1000 + Math.random() * 8999);

    await expect(
      createAutomationProject(pmPrincipal, {
        kind: 'WORK_ORDER',
        workOrderNo: `WO-REFUSED-${rand}`,
        clientId: testClient.id,
        clientName: testClient.name,
        managerId: pmAId,
        tasks: [
          {
            templateCode: 'PLC',
            stepNumber: 1,
            unitIndex: 1,
            title: 'PLC Hardware Configuration',
            assigneeId: engineerB.id,
          },
        ],
      })
    ).rejects.toThrow(ForbiddenError);
  });
});
