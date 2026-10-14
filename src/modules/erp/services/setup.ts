import { prisma, type Tx } from '@/core/db/prisma';
import { ROOTS, STANDARD_CHART, STANDARD_WAREHOUSES, type SystemAccount } from '../domain/chart';

/**
 * A company's ERP starts on first use: settings, the standard chart of accounts and the
 * default warehouses. Idempotent (upserts on the natural keys), so it is safe to call from
 * every ERP entry point and safe if two requests race.
 */
const ready = new Set<string>();
const SYSTEM_KEY_COUNT = STANDARD_CHART.filter((r) => r.key).length;

export async function ensureErpSetup(companyId: string): Promise<void> {
  if (ready.has(companyId)) return;
  const [settings, keyed] = await Promise.all([
    prisma.erpSettings.findUnique({ where: { companyId }, select: { id: true } }),
    prisma.erpAccount.count({ where: { companyId, systemKey: { not: null } } }),
  ]);
  // A later release can add standard accounts; the upserts add only what is missing.
  if (!settings || keyed < SYSTEM_KEY_COUNT) await seedCompany(companyId);
  ready.add(companyId);
}

async function seedCompany(companyId: string) {
  await prisma.$transaction(async (tx) => {
    const ids = new Map<string, { id: string; rootType: (typeof ROOTS)[number]['rootType'] }>();
    for (const root of ROOTS) {
      const row = await tx.erpAccount.upsert({
        where: { companyId_code: { companyId, code: root.code } },
        create: { companyId, code: root.code, name: root.name, rootType: root.rootType, isGroup: true },
        update: {},
      });
      ids.set(root.code, { id: row.id, rootType: root.rootType });
    }
    for (const row of STANDARD_CHART) {
      const parent = ids.get(row.parent!)!;
      const created = await tx.erpAccount.upsert({
        where: { companyId_code: { companyId, code: row.code } },
        create: {
          companyId,
          code: row.code,
          name: row.name,
          rootType: parent.rootType,
          parentId: parent.id,
          isGroup: !!row.group,
          systemKey: row.key ?? null,
          accountType: row.type ?? null,
        },
        update: {},
      });
      ids.set(row.code, { id: created.id, rootType: parent.rootType });
    }
    for (const wh of STANDARD_WAREHOUSES) {
      await tx.erpWarehouse.upsert({
        where: { companyId_systemKey: { companyId, systemKey: wh.key } },
        create: { companyId, name: wh.name, systemKey: wh.key },
        update: {},
      });
    }
    await tx.erpSettings.upsert({ where: { companyId }, create: { companyId }, update: {} });
  });
}

export async function getSettings(companyId: string, tx: Tx = prisma) {
  await ensureErpSetup(companyId);
  return tx.erpSettings.findUniqueOrThrow({ where: { companyId } });
}

export async function systemAccountId(companyId: string, key: SystemAccount, tx: Tx = prisma): Promise<string> {
  const row = await tx.erpAccount.findUnique({ where: { companyId_systemKey: { companyId, systemKey: key } }, select: { id: true } });
  if (!row) throw new Error(`ERP account ${key} is missing for company ${companyId}`);
  return row.id;
}

export async function systemWarehouseId(companyId: string, key: 'STORES' | 'WIP' | 'FINISHED_GOODS' | 'REJECTED', tx: Tx = prisma): Promise<string> {
  const row = await tx.erpWarehouse.findUnique({ where: { companyId_systemKey: { companyId, systemKey: key } }, select: { id: true } });
  if (!row) throw new Error(`ERP warehouse ${key} is missing for company ${companyId}`);
  return row.id;
}

/** Tests only: forget which companies are set up (they delete and recreate data). */
export function resetSetupCache() {
  ready.clear();
}
