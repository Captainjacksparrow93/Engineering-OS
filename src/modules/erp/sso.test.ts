import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { buildPass, rolesFor, verifyPass } from './sso';

describe('SSO Pass & Roles Unit Tests', () => {
  const vectorPath = path.resolve(__dirname, '../../../erp/acs_erp/acs_erp/tests/pass_vector.json');
  const vector = JSON.parse(fs.readFileSync(vectorPath, 'utf8'));

  describe('rolesFor', () => {
    it('maps DIRECTOR to full ERP management roles including System Manager', () => {
      const roles = rolesFor(['DIRECTOR']);
      expect(roles).toEqual([
        'System Manager',
        'Sales Manager',
        'Sales User',
        'Sales Master Manager',
        'Purchase Manager',
        'Purchase User',
        'Purchase Master Manager',
        'Stock Manager',
        'Stock User',
        'Item Manager',
        'Delivery Manager',
        'Delivery User',
        'Accounts Manager',
        'Accounts User',
        'Manufacturing Manager',
        'Manufacturing User',
        'Quality Manager',
        'Maintenance Manager',
        'Maintenance User',
        'Fleet Manager',
        'Support Team',
      ]);
    });

    it('maps SUPER_ADMIN to full ERP management roles', () => {
      const roles = rolesFor(['SUPER_ADMIN']);
      expect(roles).toContain('System Manager');
      expect(roles).toContain('Sales Manager');
      expect(roles).toContain('Accounts Manager');
      expect(roles).toHaveLength(21);
    });

    it('maps SALES_HEAD to every module role without System Manager', () => {
      const roles = rolesFor(['SALES_HEAD']);
      expect(roles).not.toContain('System Manager');
      expect(roles).toContain('Sales Manager');
      expect(roles).toContain('Purchase Manager');
      expect(roles).toContain('Stock Manager');
      expect(roles).toContain('Accounts Manager');
      expect(roles).toContain('Manufacturing Manager');
      expect(roles).toContain('Quality Manager');
      expect(roles).toContain('Maintenance Manager');
      expect(roles).toHaveLength(20);
    });

    it('returns empty array for roles without ERP access', () => {
      expect(rolesFor(['PROJECT_MANAGER'])).toEqual([]);
      expect(rolesFor(['SENIOR_ENGINEER'])).toEqual([]);
      expect(rolesFor(['JUNIOR_ENGINEER'])).toEqual([]);
      expect(rolesFor(['DEPARTMENT_HEAD'])).toEqual([]);
      expect(rolesFor([])).toEqual([]);
    });

    it('gives DIRECTOR precedence when combined with SALES_HEAD', () => {
      const roles = rolesFor(['SALES_HEAD', 'DIRECTOR']);
      expect(roles).toContain('System Manager');
      expect(roles).toContain('Stock Manager');
    });
  });

  describe('buildPass format and shared vector', () => {
    it('matches the shared test vector exactly', () => {
      const { secret, payload, pass } = vector;
      const generated = buildPass(
        {
          email: payload.email,
          name: payload.name,
          roles: payload.roles,
        },
        payload.act,
        secret,
        payload.iat,
        payload.nonce
      );
      expect(generated).toBe(pass);
    });

    it('verifies the shared test vector', () => {
      const { secret, pass, payload } = vector;
      const verified = verifyPass(pass, secret, payload.iat + 10);
      expect(verified).toEqual(payload);
    });

    it('produces expected format with default timestamp and random nonce', () => {
      const secret = 'test-secret-at-least-32-characters-long';
      const token = buildPass(
        {
          email: 'test@example.com',
          name: 'Test User',
          roles: ['Sales User'],
        },
        'login',
        secret
      );

      const parts = token.split('.');
      expect(parts.length).toBe(2);

      const decoded = verifyPass(token, secret);
      expect(decoded.v).toBe(1);
      expect(decoded.act).toBe('login');
      expect(decoded.email).toBe('test@example.com');
      expect(decoded.name).toBe('Test User');
      expect(decoded.roles).toEqual(['Sales User']);
      expect(decoded.nonce).toMatch(/^[0-9a-f]{32}$/);
      expect(decoded.exp).toBe(decoded.iat + 30);
    });

    it('rejects tampered signature', () => {
      const { secret, pass, payload } = vector;
      const parts = pass.split('.');
      const tampered = parts[0] + '.invalid_sig';
      expect(() => verifyPass(tampered, secret, payload.iat + 10)).toThrow();
    });

    it('rejects expired token', () => {
      const { secret, pass, payload } = vector;
      expect(() => verifyPass(pass, secret, payload.exp + 10)).toThrow(/expired/i);
    });
  });
});
