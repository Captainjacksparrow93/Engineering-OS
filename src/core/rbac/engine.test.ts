import { describe, expect, it } from 'vitest';
import { can, canAll, canAny, hasPermissionAnywhere } from './engine';
import type { Grant, Principal } from './types';

const principal = (grants: Grant[], overrides: Partial<Principal> = {}): Principal => ({
  userId: 'u1',
  companyId: 'c1',
  employeeCode: 'VS-0001',
  fullName: 'Test Person',
  email: 'test@example.com',
  grade: 'ENGINEER',
  departmentId: 'dept-elec',
  managerId: null,
  avatarColor: '#000',
  grants,
  coveredDepartmentIds: [],
  memberProjectIds: [],
  roleKeys: [],
  ...overrides,
});

describe('can', () => {
  it('denies by default', () => {
    expect(can(principal([]), 'pm.project.create')).toBe(false);
  });

  it('honours a global grant everywhere', () => {
    const p = principal([{ permission: 'pm.task.assign', scopeType: 'GLOBAL', scopeId: null }]);
    expect(can(p, 'pm.task.assign', { projectId: 'anything' })).toBe(true);
    expect(can(p, 'pm.task.assign')).toBe(true);
  });

  it('confines a project grant to that project', () => {
    const p = principal([{ permission: 'pm.task.assign', scopeType: 'PROJECT', scopeId: 'proj-1' }]);
    expect(can(p, 'pm.task.assign', { projectId: 'proj-1' })).toBe(true);
    expect(can(p, 'pm.task.assign', { projectId: 'proj-2' })).toBe(false);
  });

  it('applies a department grant across the covered subtree', () => {
    const p = principal([{ permission: 'pm.task.update', scopeType: 'DEPARTMENT', scopeId: 'dept-eng' }], {
      coveredDepartmentIds: ['dept-eng', 'dept-elec', 'dept-mech'],
    });
    expect(can(p, 'pm.task.update', { departmentId: 'dept-mech' })).toBe(true);
    expect(can(p, 'pm.task.update', { departmentId: 'dept-prod' })).toBe(false);
  });

  it('does not let a department grant answer a project-only question', () => {
    const p = principal([{ permission: 'pm.task.update', scopeType: 'DEPARTMENT', scopeId: 'dept-eng' }], {
      coveredDepartmentIds: ['dept-eng'],
    });
    expect(can(p, 'pm.task.update', { projectId: 'proj-1' })).toBe(false);
  });

  it('never confuses one permission for another', () => {
    const p = principal([{ permission: 'pm.task.read', scopeType: 'GLOBAL', scopeId: null }]);
    expect(can(p, 'pm.task.delete')).toBe(false);
  });
});

describe('canAny / canAll', () => {
  const p = principal([
    { permission: 'pm.task.read', scopeType: 'GLOBAL', scopeId: null },
    { permission: 'pm.progress.log', scopeType: 'PROJECT', scopeId: 'proj-1' },
  ]);

  it('canAny passes when one matches', () => {
    expect(canAny(p, ['pm.task.delete', 'pm.task.read'])).toBe(true);
  });

  it('canAll fails when one is out of scope', () => {
    expect(canAll(p, ['pm.task.read', 'pm.progress.log'], { projectId: 'proj-2' })).toBe(false);
    expect(canAll(p, ['pm.task.read', 'pm.progress.log'], { projectId: 'proj-1' })).toBe(true);
  });
});

describe('hasPermissionAnywhere', () => {
  it('is true for a narrowly scoped grant, so the nav link still renders', () => {
    const p = principal([{ permission: 'pm.resource.read', scopeType: 'PROJECT', scopeId: 'proj-1' }]);
    expect(hasPermissionAnywhere(p, 'pm.resource.read')).toBe(true);
    expect(can(p, 'pm.resource.read')).toBe(false);
  });
});
