import { prisma } from '@/core/db/prisma';
import { audit } from '@/core/audit/audit';
import { hasPermissionAnywhere } from '@/core/rbac/engine';
import { ForbiddenError } from '@/core/rbac/errors';
import type { Principal } from '@/core/rbac/types';
import { settingsSchema, type SettingsInput, type Raw } from '../validation';
import { ensureErpSetup, getSettings } from './setup';

export const canManageSettings = (p: Principal) => hasPermissionAnywhere(p, 'erp.settings.manage');

export async function readSettings(p: Principal) {
  if (!hasPermissionAnywhere(p, 'erp.access')) throw new ForbiddenError("You don't have access to ERP.");
  return getSettings(p.companyId);
}

export async function updateSettings(p: Principal, input: Raw<SettingsInput>) {
  if (!canManageSettings(p)) throw new ForbiddenError("You can't change ERP settings.");
  await ensureErpSetup(p.companyId);
  const data = settingsSchema.parse(input);
  const settings = await prisma.erpSettings.update({ where: { companyId: p.companyId }, data });
  await audit({ actorId: p.userId, module: 'erp', action: 'erp.settings.updated', entityType: 'ErpSettings', entityId: settings.id, diff: { ...data, defaultGstRate: data.defaultGstRate.toFixed(2) } });
  return settings;
}

/** The chart of accounts as a flat list in tree order, with each account's depth. */
export async function chartOfAccounts(companyId: string) {
  await ensureErpSetup(companyId);
  const accounts = await prisma.erpAccount.findMany({ where: { companyId }, orderBy: { code: 'asc' } });
  const children = new Map<string | null, typeof accounts>();
  for (const a of accounts) children.set(a.parentId, [...(children.get(a.parentId) ?? []), a]);
  const out: Array<(typeof accounts)[number] & { depth: number }> = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const a of children.get(parentId) ?? []) {
      out.push({ ...a, depth });
      walk(a.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}
