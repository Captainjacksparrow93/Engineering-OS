import { describe, it, expect } from 'vitest';
import { prisma } from '@/core/db/prisma';
import { loadPrincipal } from '@/core/rbac/principal';
import { ForbiddenError } from '@/core/rbac/errors';
import { createAutomationProject } from './automation-project.service';
import { assignTask, deleteTask } from './task.service';
import { requestProjectHandover } from './handover.service';
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
});
