import { describe, it, expect } from 'vitest';
import { SYSTEM_ROLES } from './permissions';

describe('SALES_HEAD System Role (#2)', () => {
  it('defines SALES_HEAD in SYSTEM_ROLES with view-only permissions', () => {
    const role = SYSTEM_ROLES.SALES_HEAD;
    expect(role).toBeDefined();
    expect(role.name).toBe('Sales Head');

    // Expected read permissions
    expect(role.permissions).toContain('pm.project.read');
    expect(role.permissions).toContain('pm.project.read.all');
    expect(role.permissions).toContain('pm.task.read');
    expect(role.permissions).toContain('pm.resource.read');
    expect(role.permissions).toContain('pm.report.read');

    // Must NOT have oversight (no notification floods)
    expect(role.permissions).not.toContain('pm.oversight');

    // Must NOT have any mutating or approval permissions
    const mutatingVerbs = ['create', 'update', 'delete', 'cancel', 'assign', 'manage', 'approve', 'log', 'review'];
    for (const perm of role.permissions) {
      for (const verb of mutatingVerbs) {
        expect(perm).not.toContain(`.${verb}`);
      }
    }
  });
});
