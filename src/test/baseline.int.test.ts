import { describe, it, expect } from 'vitest';
import { prisma } from '@/core/db/prisma';
import { loadPrincipal } from '@/core/rbac/principal';

describe('Integration Test Baseline', () => {
  it('connects to real Postgres and verifies database connection', async () => {
    const userCount = await prisma.user.count();
    expect(userCount).toBeGreaterThan(0);
  });

  it('loads seeded principal for Director correctly', async () => {
    const directorUser = await prisma.user.findFirst({
      where: { employeeCode: 'ACS-0004' },
    });
    expect(directorUser).not.toBeNull();

    if (directorUser) {
      const principal = await loadPrincipal(directorUser.id);
      expect(principal).not.toBeNull();
      expect(principal?.employeeCode).toBe('ACS-0004');
      expect(principal?.roleKeys).toContain('DIRECTOR');
    }
  });
});
