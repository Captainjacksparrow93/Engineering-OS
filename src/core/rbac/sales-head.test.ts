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
    expect(role.permissions).toContain('pm.commissioning.read');
    expect(role.permissions).toContain('pm.template.read');

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

  it('can open every page a Technical Head can view, just not act on it', async () => {
    const { isReadOnly } = await import('./engine');
    const grants = SYSTEM_ROLES.SALES_HEAD.permissions.map((permission) => ({ permission, scopeType: 'GLOBAL' as const, scopeId: null }));
    expect(isReadOnly({ grants } as never)).toBe(true);
    for (const [manage, read] of [['pm.commissioning.manage', 'pm.commissioning.read'], ['pm.template.manage', 'pm.template.read']] as const) {
      for (const role of ['DIRECTOR', 'TECHNICAL_HEAD', 'SERVICE_HEAD'] as const) {
        if (SYSTEM_ROLES[role].permissions.includes(manage)) expect(SYSTEM_ROLES[role].permissions).toContain(read);
      }
    }
  });
});
