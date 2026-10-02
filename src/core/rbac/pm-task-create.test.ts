import { describe, it, expect } from 'vitest';
import { SYSTEM_ROLES } from './permissions';
import { can } from './engine';
import type { Principal } from './types';

describe('PM and Assistant PM Task Creation Revocation (#4b)', () => {
  it('excludes pm.task.create and pm.task.adhoc.create from PROJECT_MANAGER and ASST_MANAGER system roles', () => {
    const pm = SYSTEM_ROLES.PROJECT_MANAGER;
    expect(pm.permissions).not.toContain('pm.task.create');
    expect(pm.permissions).not.toContain('pm.task.adhoc.create');

    const asst = SYSTEM_ROLES.ASST_MANAGER;
    expect(asst.permissions).not.toContain('pm.task.create');
    expect(asst.permissions).not.toContain('pm.task.adhoc.create');

    // Still retains read, update, assign, review, handover
    expect(pm.permissions).toContain('pm.task.read');
    expect(pm.permissions).toContain('pm.task.update');
    expect(pm.permissions).toContain('pm.task.assign');
    expect(pm.permissions).toContain('pm.progress.review');
    expect(pm.permissions).toContain('pm.handover.request');

    expect(asst.permissions).toContain('pm.task.read');
    expect(asst.permissions).toContain('pm.task.update');
    expect(asst.permissions).toContain('pm.task.assign');
    expect(asst.permissions).toContain('pm.progress.review');
    expect(asst.permissions).toContain('pm.handover.request');
  });

  it('keeps pm.task.create and pm.task.adhoc.create for TECHNICAL_HEAD and DIRECTOR', () => {
    const techHead = SYSTEM_ROLES.TECHNICAL_HEAD;
    expect(techHead.permissions).toContain('pm.task.create');
    expect(techHead.permissions).toContain('pm.task.adhoc.create');

    const director = SYSTEM_ROLES.DIRECTOR;
    expect(director.permissions).toContain('pm.task.create');
    expect(director.permissions).toContain('pm.task.adhoc.create');
  });

  it('denies pm.task.create and pm.task.adhoc.create to a Project Manager on their own project', () => {
    const pmPrincipal = {
      userId: 'user-pm-1',
      companyId: 'comp-1',
      departmentId: 'dept-tech',
      roleKeys: ['PROJECT_MANAGER'],
      grants: SYSTEM_ROLES.PROJECT_MANAGER.permissions.map((p) => ({
        permission: p,
        scopeType: 'PROJECT' as const,
        scopeId: 'proj-1',
      })),
      coveredDepartmentIds: ['dept-tech'],
      memberProjectIds: ['proj-1'],
    } as unknown as Principal;

    // 1. can() check returns false
    expect(can(pmPrincipal, 'pm.task.create', { projectId: 'proj-1', departmentId: 'dept-tech' })).toBe(false);
    expect(can(pmPrincipal, 'pm.task.adhoc.create', { projectId: 'proj-1', departmentId: 'dept-tech' })).toBe(false);

    // 2. PM can still assign and update tasks
    expect(can(pmPrincipal, 'pm.task.assign', { projectId: 'proj-1', departmentId: 'dept-tech' })).toBe(true);
    expect(can(pmPrincipal, 'pm.task.update', { projectId: 'proj-1', departmentId: 'dept-tech' })).toBe(true);
  });

  it('allows Technical Head to create tasks on the project', () => {
    const headPrincipal = {
      userId: 'user-head-1',
      companyId: 'comp-1',
      departmentId: 'dept-tech',
      roleKeys: ['TECHNICAL_HEAD'],
      grants: SYSTEM_ROLES.TECHNICAL_HEAD.permissions.map((p) => ({
        permission: p,
        scopeType: 'DEPARTMENT' as const,
        scopeId: 'dept-tech',
      })),
      coveredDepartmentIds: ['dept-tech'],
      memberProjectIds: [],
    } as unknown as Principal;

    expect(can(headPrincipal, 'pm.task.create', { projectId: 'proj-1', departmentId: 'dept-tech' })).toBe(true);
    expect(can(headPrincipal, 'pm.task.adhoc.create', { projectId: 'proj-1', departmentId: 'dept-tech' })).toBe(true);
  });

  it('evaluates canCreateTask and canCreateAdhocTask to false for PM principal', () => {
    const pmPrincipal = {
      userId: 'user-pm-1',
      companyId: 'comp-1',
      departmentId: 'dept-tech',
      roleKeys: ['PROJECT_MANAGER'],
      grants: SYSTEM_ROLES.PROJECT_MANAGER.permissions.map((p) => ({
        permission: p,
        scopeType: 'PROJECT' as const,
        scopeId: 'proj-1',
      })),
      coveredDepartmentIds: ['dept-tech'],
      memberProjectIds: ['proj-1'],
    } as unknown as Principal;

    const canCreate = can(pmPrincipal, 'pm.task.create', { projectId: 'proj-1', departmentId: 'dept-tech' });
    const canCreateAdhoc = can(pmPrincipal, 'pm.task.adhoc.create', { projectId: 'proj-1', departmentId: 'dept-tech' });

    expect(canCreate).toBe(false);
    expect(canCreateAdhoc).toBe(false);
  });
});
