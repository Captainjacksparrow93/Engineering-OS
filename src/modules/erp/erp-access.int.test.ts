import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/core/db/prisma';
import { loadPrincipal } from '@/core/rbac/principal';
import { GET } from '@/app/erp/open/route';
import { verifyPass } from './sso';
import { setUserStatus } from '@/modules/admin/services/admin.service';

// Mock getPrincipal to control authentication per test case
vi.mock('@/core/auth/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/auth/session')>();
  return {
    ...actual,
    getPrincipal: vi.fn(),
  };
});

describe('ERP Access Integration Tests', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.ERPNEXT_PUBLIC_URL = 'http://127.0.0.1:8080';
    process.env.ERPNEXT_URL = 'http://127.0.0.1:8080';
    process.env.ERP_SSO_SECRET = 'test-sso-secret-at-least-32-chars-long-123456';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  describe('GET /erp/open', () => {
    it('redirects to /login when there is no session', async () => {
      const { getPrincipal } = await import('@/core/auth/session');
      vi.mocked(getPrincipal).mockResolvedValue(null);

      const request = new NextRequest('http://localhost:3000/erp/open');
      const response = await GET(request);

      expect(response.status).toBe(307); // or 302/307 redirect
      expect(response.headers.get('location')).toContain('/login');
    });

    it('returns 403 for an Engineer without erp.access', async () => {
      const engineer = await prisma.user.findFirst({
        where: { employeeCode: 'ACS-0065' }, // Sahil Patil (Junior Engineer)
      });
      expect(engineer).not.toBeNull();
      const engineerPrincipal = await loadPrincipal(engineer!.id);
      expect(engineerPrincipal).not.toBeNull();

      const { getPrincipal } = await import('@/core/auth/session');
      vi.mocked(getPrincipal).mockResolvedValue(engineerPrincipal);

      const request = new NextRequest('http://localhost:3000/erp/open');
      const response = await GET(request);

      expect(response.status).toBe(403);
    });

    it('returns 200 HTML with auto-submitting POST form and valid pass for Director', async () => {
      const director = await prisma.user.findFirst({
        where: { employeeCode: 'ACS-0004' }, // Shaktikumar Vasava (Director)
      });
      expect(director).not.toBeNull();
      const directorPrincipal = await loadPrincipal(director!.id);
      expect(directorPrincipal).not.toBeNull();

      const { getPrincipal } = await import('@/core/auth/session');
      vi.mocked(getPrincipal).mockResolvedValue(directorPrincipal);

      const request = new NextRequest('http://localhost:3000/erp/open');
      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('referrer-policy')).toBe('no-referrer');

      const html = await response.text();
      expect(html).toContain('http://127.0.0.1:8080/api/method/acs_erp.sso.login');
      expect(html).toContain('name="pass"');

      // Extract pass from hidden input
      const match = html.match(/name="pass"\s+value="([^"]+)"/);
      expect(match).not.toBeNull();
      const pass = match![1];

      // Verify the pass using secret
      const payload = verifyPass(pass, process.env.ERP_SSO_SECRET!);
      expect(payload.email).toBe(director!.email);
      expect(payload.act).toBe('login');
      expect(payload.roles).toContain('System Manager');
      expect(payload.roles).toContain('Sales Manager');
    });
  });

  describe('Permission grants after migration', () => {
    it('grants erp.access to DIRECTOR, SALES_HEAD, and SUPER_ADMIN and nobody else', async () => {
      const erpPermission = await prisma.permission.findUnique({
        where: { key: 'erp.access' },
        include: {
          roles: {
            include: { role: true },
          },
        },
      });

      expect(erpPermission).not.toBeNull();
      const roleKeys = erpPermission!.roles.map((rp) => rp.role.key).sort();
      expect(roleKeys).toEqual(['DIRECTOR', 'SALES_HEAD', 'SUPER_ADMIN'].sort());
    });
  });

  describe('setUserStatus: disable on deactivate', () => {
    it('succeeds and audits status change even when ERPNext is unreachable', async () => {
      // Find admin to act as principal
      const admin = await prisma.user.findFirst({
        where: { employeeCode: 'ACS-0001' },
      });
      expect(admin).not.toBeNull();
      const adminPrincipal = await loadPrincipal(admin!.id);
      expect(adminPrincipal).not.toBeNull();

      // Find target user (e.g., ACS-0075 Multani Munaf)
      const target = await prisma.user.findFirst({
        where: { employeeCode: 'ACS-0075' },
      });
      expect(target).not.toBeNull();

      // Point ERPNEXT_URL to an unreachable port to simulate outage
      process.env.ERPNEXT_URL = 'http://127.0.0.1:59999';

      // Setting status to EXITED should not throw
      const updated = await setUserStatus(adminPrincipal!, target!.id, 'EXITED');
      expect(updated.status).toBe('EXITED');

      // Verify audit trail logged the change
      const auditLog = await prisma.auditLog.findFirst({
        where: {
          entityType: 'User',
          entityId: target!.id,
          action: 'user.status_changed',
        },
        orderBy: { createdAt: 'desc' },
      });
      expect(auditLog).not.toBeNull();

      // Restore status to ACTIVE
      await setUserStatus(adminPrincipal!, target!.id, 'ACTIVE');
    });
  });
});
