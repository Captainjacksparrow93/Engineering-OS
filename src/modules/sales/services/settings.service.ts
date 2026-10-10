import { prisma, type Tx } from '@/core/db/prisma';
import { audit } from '@/core/audit/audit';
import { assertCan } from '@/core/rbac/guard';
import type { Principal } from '@/core/rbac/types';
import { PRICE_SOURCES, type PriceSource } from '../domain/pricing';
import { settingsSchema, type SettingsInput } from '../validation';
import { assertSalesRead, num } from './access';

export interface SalesConfig {
  targetMarginPct: number;
  minMarginPct: number;
  gstPct: number;
  priceStaleDays: number;
  pricePriority: PriceSource[];
  quoteValidityDays: number;
  followUpDays: number;
  terms: string;
}

export const DEFAULT_TERMS = [
  '1. Prices are ex-works, in Indian Rupees.',
  '2. GST is charged as shown, at the rate in force on the invoice date.',
  '3. Payment: 30% advance with the purchase order, balance before dispatch.',
  '4. Delivery: 6–8 weeks from approved drawings and receipt of the advance.',
  '5. Warranty: 12 months from commissioning or 18 months from dispatch, whichever is earlier.',
  '6. This offer is valid until the date shown above.',
].join('\n');

export const DEFAULT_CONFIG: SalesConfig = {
  targetMarginPct: 20,
  minMarginPct: 12,
  gstPct: 18,
  priceStaleDays: 90,
  pricePriority: ['PURCHASE', 'PRICE_LIST', 'BOM_COST'],
  quoteValidityDays: 30,
  followUpDays: 7,
  terms: DEFAULT_TERMS,
};

/** Company sales settings with defaults. No permission check: internal use by other sales services. */
export async function loadSalesConfig(companyId: string, tx: Tx = prisma): Promise<SalesConfig> {
  const row = await tx.salesSettings.findUnique({ where: { companyId } });
  if (!row) return DEFAULT_CONFIG;
  return {
    targetMarginPct: num(row.targetMarginPct),
    minMarginPct: num(row.minMarginPct),
    gstPct: num(row.gstPct),
    priceStaleDays: row.priceStaleDays,
    pricePriority: row.pricePriority.filter((s): s is PriceSource => (PRICE_SOURCES as readonly string[]).includes(s)),
    quoteValidityDays: row.quoteValidityDays,
    followUpDays: row.followUpDays,
    terms: row.terms || DEFAULT_TERMS,
  };
}

export async function getSalesSettings(principal: Principal): Promise<SalesConfig> {
  assertSalesRead(principal);
  return loadSalesConfig(principal.companyId);
}

export async function updateSalesSettings(principal: Principal, input: SettingsInput): Promise<SalesConfig> {
  assertCan(principal, 'sales.settings.manage');
  const data = settingsSchema.parse(input);
  const before = await loadSalesConfig(principal.companyId);
  await prisma.$transaction(async (tx) => {
    await tx.salesSettings.upsert({
      where: { companyId: principal.companyId },
      create: { companyId: principal.companyId, ...data },
      update: data,
    });
    await audit(
      { actorId: principal.userId, module: 'sales', action: 'sales.settings.updated', entityType: 'SalesSettings', entityId: principal.companyId, diff: { before: { ...before, terms: undefined }, after: { ...data, terms: undefined } } },
      tx,
    );
  });
  return loadSalesConfig(principal.companyId);
}
