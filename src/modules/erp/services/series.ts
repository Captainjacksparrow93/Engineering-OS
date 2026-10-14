import type { Tx } from '@/core/db/prisma';

/**
 * Document numbers, ERPNext style: `PUR-ORD-2026-00042`. The counter row is bumped with an
 * atomic upsert inside the caller's transaction, so numbers are unique and gap-free.
 */
export const SERIES = {
  stockEntry: 'MAT-STE-',
  reconciliation: 'MAT-RECO-',
  materialRequest: 'MAT-MR-',
  supplierQuotation: 'PUR-SQTN-',
  purchaseOrder: 'PUR-ORD-',
  purchaseReceipt: 'MAT-PRE-',
  purchaseInvoice: 'ACC-PINV-',
  salesOrder: 'SAL-ORD-',
  deliveryNote: 'MAT-DN-',
  salesInvoice: 'ACC-SINV-',
  payment: 'ACC-PAY-',
  journal: 'ACC-JV-',
  workOrder: 'MFG-WO-',
  jobCard: 'MFG-JC-',
  productionPlan: 'MFG-PP-',
  bom: 'BOM-',
  inspection: 'MAT-QA-',
  nonConformance: 'QMS-NC-',
  asset: 'ACC-ASS-',
  maintenance: 'MNT-LOG-',
  customer: 'CUST-',
  supplier: 'SUP-',
} as const;

export async function nextNumber(tx: Tx, companyId: string, prefix: string, date: Date = new Date()): Promise<string> {
  const year = date.getUTCFullYear();
  const key = `${prefix}${year}-`;
  const rows = await tx.$queryRaw<Array<{ current: number }>>`
    INSERT INTO "erp_series" ("companyId", "prefix", "current") VALUES (${companyId}, ${key}, 1)
    ON CONFLICT ("companyId", "prefix") DO UPDATE SET "current" = "erp_series"."current" + 1
    RETURNING "current"`;
  return `${key}${String(rows[0]!.current).padStart(5, '0')}`;
}

/** Master codes without a year: CUST-00042. */
export async function nextCode(tx: Tx, companyId: string, prefix: string): Promise<string> {
  const rows = await tx.$queryRaw<Array<{ current: number }>>`
    INSERT INTO "erp_series" ("companyId", "prefix", "current") VALUES (${companyId}, ${prefix}, 1)
    ON CONFLICT ("companyId", "prefix") DO UPDATE SET "current" = "erp_series"."current" + 1
    RETURNING "current"`;
  return `${prefix}${String(rows[0]!.current).padStart(5, '0')}`;
}
