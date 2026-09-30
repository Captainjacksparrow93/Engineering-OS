import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/core/db/prisma';
import { loadPrincipal } from '@/core/rbac/principal';
import type { Principal } from '@/core/rbac/types';
import {
  getPMTeamData,
  autoAssignAutomationTeam,
  createAutomationProject,
} from './automation-project.service';
import { projectManagerPool } from './access';

describe('Plan 011: PM and Assistant PM Panel Assignment Integration Tests', () => {
  let directorPrincipal: Principal;
  let pmUser: any;
  const createdProjectIds: string[] = [];
  const createdClientIds: string[] = [];

  beforeAll(async () => {
    const directorUser = await prisma.user.findFirst({
      where: { roleAssignments: { some: { role: { key: 'DIRECTOR' } } }, status: 'ACTIVE' },
    });
    if (!directorUser) throw new Error('No active DIRECTOR user found in database');
    directorPrincipal = (await loadPrincipal(directorUser.id))!;

    const pmUsers = await projectManagerPool(directorPrincipal.companyId);
    if (pmUsers.length === 0) throw new Error('No active PM users found in database');
    pmUser = pmUsers[0];
  });

  afterAll(async () => {
    if (createdProjectIds.length > 0) {
      await prisma.project.deleteMany({ where: { id: { in: createdProjectIds } } });
    }
    if (createdClientIds.length > 0) {
      await prisma.client.deleteMany({ where: { id: { in: createdClientIds } } });
    }
  });

  it('1. getPMTeamData().allEngineers includes every PM-pool user, once each, flagged with isPM', async () => {
    const { managers, allEngineers } = await getPMTeamData(directorPrincipal.companyId);
    expect(managers.length).toBeGreaterThan(0);

    const engineerIds = allEngineers.map((e) => e.id);
    const uniqueIds = new Set(engineerIds);
    expect(engineerIds.length).toBe(uniqueIds.size); // No duplicates

    for (const m of managers) {
      const match = allEngineers.find((e) => e.id === m.id);
      expect(match).toBeDefined();
      expect((match as any).isPM).toBe(true);
    }
  });

  it('2. createAutomationProject accepts a PM as a panel assignee', async () => {
    const rand = Math.floor(1000 + Math.random() * 8999);
    const client = await prisma.client.create({
      data: {
        companyId: directorPrincipal.companyId,
        name: `PM Panel Client ${rand}`,
        refNumber: `ACS-${rand}`,
      },
    });
    createdClientIds.push(client.id);

    const project = await createAutomationProject(directorPrincipal, {
      kind: 'WORK_ORDER',
      workOrderNo: `WO-PM-${rand}`,
      clientId: client.id,
      clientName: client.name,
      managerId: pmUser.id,
      scopes: [{ templateCode: 'PLC', quantity: 1 }],
      tasks: [
        {
          templateCode: 'PLC',
          unitIndex: 1,
          stepNumber: 1,
          title: 'PLC Hardware Configuration',
          assigneeId: pmUser.id,
          estimatedHours: 8,
        },
      ],
    });
    createdProjectIds.push(project.id);
    expect(project.id).toBeDefined();

    const member = await prisma.projectMember.findFirst({
      where: { projectId: project.id, userId: pmUser.id },
    });
    expect(member).not.toBeNull();

    const task = await prisma.task.findFirst({
      where: { projectId: project.id, type: 'PROJECT' },
      include: { assignments: true },
    });
    expect(task).toBeDefined();
    expect(task?.assignments[0]?.userId).toBe(pmUser.id);
  });

  it('3. autoAssignAutomationTeam can pick a PM for a panel and never assigns a Director', async () => {
    const res = await autoAssignAutomationTeam(directorPrincipal, {
      managerId: pmUser.id,
      tasks: [
        {
          templateCode: 'PLC',
          unitIndex: 1,
          stepNumber: 1,
          title: 'PLC Panel 1',
          recommendedSeniority: 'SENIOR',
          estimatedHours: 8,
        },
      ],
    });

    expect(res.assignments.length).toBe(1);
    const assignedId = res.assignments[0]?.assignedUserId;
    if (assignedId) {
      const assignedUser = await prisma.user.findUnique({
        where: { id: assignedId },
        include: { roleAssignments: { include: { role: true } } },
      });
      expect(assignedUser).toBeDefined();
      expect(assignedUser?.grade).not.toBe('DIRECTOR');
      expect(assignedUser?.grade).not.toBe('HEAD');
      const roleKeys = assignedUser?.roleAssignments.map((ra) => ra.role.key) ?? [];
      expect(roleKeys).not.toContain('DIRECTOR');
      expect(roleKeys).not.toContain('HEAD');
    }
  });

  it('4. autoAssignAutomationTeam returns PM when all subordinate engineers have 0 free hours', async () => {
    // Find all subordinates in pmUser's team
    const { teamsByPM } = await getPMTeamData(directorPrincipal.companyId);
    const teamSubordinateIds = (teamsByPM[pmUser.id] || []).filter((id) => id !== pmUser.id);

    // Create a temporary project with huge active assignments for all subordinates to exhaust their capacity
    const rand = Math.floor(1000 + Math.random() * 8999);
    const tempClient = await prisma.client.create({
      data: {
        companyId: directorPrincipal.companyId,
        name: `Exhaust Client ${rand}`,
        refNumber: `ACS-${rand}`,
      },
    });
    createdClientIds.push(tempClient.id);

    const tempProject = await prisma.project.create({
      data: {
        companyId: directorPrincipal.companyId,
        code: `PRJ-EXH-${rand}`,
        name: `Exhaust Capacity Project ${rand}`,
        managerId: pmUser.id,
        clientId: tempClient.id,
        clientName: tempClient.name,
        status: 'IN_PROGRESS',
      },
    });
    createdProjectIds.push(tempProject.id);

    for (let i = 0; i < teamSubordinateIds.length; i++) {
      const subId = teamSubordinateIds[i]!;
      await prisma.task.create({
        data: {
          projectId: tempProject.id,
          code: `EXH-${rand}-${i}`,
          title: `Exhaust Task ${i}`,
          createdById: directorPrincipal.userId,
          status: 'IN_PROGRESS',
          percentComplete: 0,
          plannedStart: new Date(),
          plannedEnd: new Date(Date.now() + 30 * 86400000),
          assignments: {
            create: {
              userId: subId,
              status: 'ACTIVE',
              allocatedHours: 500, // exhausts all freeHours
            },
          },
        },
      });
    }

    const res = await autoAssignAutomationTeam(directorPrincipal, {
      managerId: pmUser.id,
      tasks: [
        {
          templateCode: 'PLC',
          unitIndex: 1,
          stepNumber: 1,
          title: 'PLC Panel 1',
          recommendedSeniority: 'SENIOR',
          estimatedHours: 8,
        },
      ],
    });

    expect(res.assignments.length).toBe(1);
    // Subordinates are fully booked, so the PM themself is assigned
    expect(res.assignments[0]?.assignedUserId).toBe(pmUser.id);
  });
});
