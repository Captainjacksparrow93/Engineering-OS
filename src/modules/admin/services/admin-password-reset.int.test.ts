import { describe, it, expect } from 'vitest';
import { prisma } from '@/core/db/prisma';
import { loadPrincipal } from '@/core/rbac/principal';
import { verifyPassword, passwordIssues, generateSecurePassword } from '@/core/auth/password';
import { resetUserPassword } from './admin.service';
import { ForbiddenError, DomainError } from '@/core/rbac/errors';

describe('Admin Service: resetUserPassword (#8)', () => {
  it('generateSecurePassword satisfies passwordIssues', () => {
    for (let i = 0; i < 20; i++) {
      const pwd = generateSecurePassword();
      expect(pwd.length).toBeGreaterThanOrEqual(10);
      expect(passwordIssues(pwd)).toEqual([]);
    }
  });

  it('rejects weak password with DomainError', async () => {
    const directorUser = await prisma.user.findFirst({ where: { employeeCode: 'ACS-0004' } });
    expect(directorUser).not.toBeNull();
    const directorPrincipal = await loadPrincipal(directorUser!.id);
    expect(directorPrincipal).not.toBeNull();

    const targetUser = await prisma.user.findFirst({ where: { employeeCode: 'ACS-0077' } });
    expect(targetUser).not.toBeNull();

    await expect(
      resetUserPassword(directorPrincipal!, targetUser!.id, 'weak')
    ).rejects.toThrow(DomainError);
  });

  it('forbids password reset for all system roles except DIRECTOR and SUPER_ADMIN', async () => {
    const targetUser = await prisma.user.findFirst({ where: { employeeCode: 'ACS-0077' } });
    expect(targetUser).not.toBeNull();

    // Map through engineers / PMs who are active
    const nonDirectorUsers = await prisma.user.findMany({
      where: {
        employeeCode: { in: ['ACS-0063', 'ACS-0074', 'ACS-0077', 'ACS-0067', 'ACS-0062'] },
      },
    });

    for (const u of nonDirectorUsers) {
      const principal = await loadPrincipal(u.id);
      if (!principal) continue;
      // If principal doesn't have admin.user.password.reset, must throw ForbiddenError
      await expect(
        resetUserPassword(principal, targetUser!.id, 'ValidPassword123!')
      ).rejects.toThrow(ForbiddenError);
    }
  });

  it('allows Director to reset password, updates hash, verifies login, and audits without password', async () => {
    const directorUser = await prisma.user.findFirst({ where: { employeeCode: 'ACS-0004' } });
    expect(directorUser).not.toBeNull();
    const directorPrincipal = await loadPrincipal(directorUser!.id);
    expect(directorPrincipal).not.toBeNull();

    const targetUser = await prisma.user.findFirst({ where: { employeeCode: 'ACS-0076' } }); // Ridhhi
    expect(targetUser).not.toBeNull();

    const oldHash = targetUser!.passwordHash;
    const newPassword = generateSecurePassword();

    const result = await resetUserPassword(directorPrincipal!, targetUser!.id, newPassword);
    expect(result.userId).toBe(targetUser!.id);

    // Verify hash changed and verifies
    const updatedUser = await prisma.user.findUnique({ where: { id: targetUser!.id } });
    expect(updatedUser!.passwordHash).not.toBe(oldHash);
    expect(await verifyPassword(newPassword, updatedUser!.passwordHash)).toBe(true);
    expect(await verifyPassword('WrongPassword123!', updatedUser!.passwordHash)).toBe(false);

    // Verify audit log
    const auditRow = await prisma.auditLog.findFirst({
      where: {
        action: 'user.password_reset',
        entityId: targetUser!.id,
      },
      orderBy: { createdAt: 'desc' },
    });

    expect(auditRow).not.toBeNull();
    expect(auditRow?.actorId).toBe(directorPrincipal!.userId);
    // Crucial safety check: plaintext password or hash must NEVER be in diff
    const diffStr = JSON.stringify(auditRow?.diff);
    expect(diffStr).not.toContain(newPassword);
    expect(diffStr).not.toContain(updatedUser!.passwordHash);
  });
});
