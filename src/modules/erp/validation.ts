import { z } from 'zod';
import { Prisma } from '@prisma/client';

/** Shared field builders for ERP forms. Raw form strings in, typed values out. */

/** What a service accepts: the typed input, or the raw form fields (zod parses either). */
export type Raw<T> = T | Record<string, string>;

export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

export const requiredText = (label: string, max = 140) => z.string({ required_error: `Enter ${label}.` }).trim().min(1, `Enter ${label}.`).max(max, `${label[0]!.toUpperCase()}${label.slice(1)} is too long.`);

export const isoDate = (label = 'a date') => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, `Pick ${label}.`).transform((s) => new Date(`${s}T00:00:00.000Z`));
export const optionalDate = z
  .string()
  .optional()
  .nullable()
  .transform((s, ctx) => {
    if (!s) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      ctx.addIssue({ code: 'custom', message: 'Pick a valid date.' });
      return z.NEVER;
    }
    return new Date(`${s}T00:00:00.000Z`);
  });

const decimalish = (label: string) =>
  z.union([z.string(), z.number()]).transform((v, ctx) => {
    const s = String(v).trim().replaceAll(',', '');
    if (!/^-?\d+(\.\d+)?$/.test(s)) {
      ctx.addIssue({ code: 'custom', message: `Enter ${label} as a number.` });
      return z.NEVER;
    }
    return new Prisma.Decimal(s);
  });

export const positiveDecimal = (label: string) => decimalish(label).refine((d) => d.greaterThan(0), `${label[0]!.toUpperCase()}${label.slice(1)} must be more than zero.`);
export const nonNegativeDecimal = (label: string) => decimalish(label).refine((d) => d.greaterThanOrEqualTo(0), `${label[0]!.toUpperCase()}${label.slice(1)} can't be negative.`);
export const optionalDecimal = (label: string) =>
  z
    .union([z.string(), z.number()])
    .optional()
    .nullable()
    .transform((v, ctx) => {
      if (v === null || v === undefined || String(v).trim() === '') return null;
      const s = String(v).trim().replaceAll(',', '');
      if (!/^\d+(\.\d+)?$/.test(s)) {
        ctx.addIssue({ code: 'custom', message: `Enter ${label} as a number.` });
        return z.NEVER;
      }
      return new Prisma.Decimal(s);
    });

export const checkbox = z
  .union([z.boolean(), z.string()])
  .optional()
  .nullable()
  .transform((v) => v === true || v === 'on' || v === 'true');

export const id = (label: string) => z.string({ required_error: `Pick ${label}.` }).trim().min(1, `Pick ${label}.`);
export const optionalId = optionalText(40);

// -------------------------------------------------------------------- masters

export const itemSchema = z.object({
  code: requiredText('an item code', 60).transform((s) => s.toUpperCase()),
  name: requiredText('the item name', 200),
  description: optionalText(2000),
  itemGroup: optionalText(80).transform((s) => s ?? 'General'),
  uom: optionalText(20).transform((s) => s ?? 'Nos'),
  make: optionalText(80),
  makerPartNo: optionalText(80),
  hsnCode: optionalText(12),
  gstRate: optionalDecimal('the GST rate'),
  isStockItem: checkbox,
  isPurchaseItem: checkbox,
  isSalesItem: checkbox,
  standardRate: optionalDecimal('the selling rate'),
  reorderLevel: optionalDecimal('the reorder level'),
  reorderQty: optionalDecimal('the reorder quantity'),
  leadTimeDays: z
    .union([z.string(), z.number()])
    .optional()
    .nullable()
    .transform((v) => (v === null || v === undefined || String(v).trim() === '' ? null : Math.max(0, Math.round(Number(v)) || 0))),
  defaultWarehouseId: optionalId,
});
export type ItemInput = z.input<typeof itemSchema>;

export const warehouseSchema = z.object({ name: requiredText('the warehouse name', 80) });

// -------------------------------------------------------------------- stock

export const STOCK_PURPOSES = ['MATERIAL_RECEIPT', 'MATERIAL_ISSUE', 'MATERIAL_TRANSFER'] as const;

export const stockEntrySchema = z.object({
  purpose: z.enum(STOCK_PURPOSES, { message: 'Pick what this entry is for.' }),
  postingDate: isoDate('the posting date'),
  fromWarehouseId: optionalId,
  toWarehouseId: optionalId,
  projectId: optionalId,
  remarks: optionalText(500),
});
export type StockEntryInput = z.input<typeof stockEntrySchema>;

export const stockLineSchema = z.object({
  itemCode: requiredText('an item code', 60).transform((s) => s.toUpperCase()),
  qty: positiveDecimal('the quantity'),
  rate: optionalDecimal('the rate'),
  fromWarehouseId: optionalId,
  toWarehouseId: optionalId,
});
export type StockLineInput = z.input<typeof stockLineSchema>;

export const reconciliationSchema = z.object({
  purpose: z.enum(['OPENING', 'ADJUSTMENT'], { message: 'Pick opening stock or a stock count.' }),
  postingDate: isoDate('the posting date'),
  remarks: optionalText(500),
});
export type ReconciliationInput = z.input<typeof reconciliationSchema>;

export const reconLineSchema = z.object({
  itemCode: requiredText('an item code', 60).transform((s) => s.toUpperCase()),
  warehouseId: id('a warehouse'),
  qty: nonNegativeDecimal('the counted quantity'),
  valuationRate: nonNegativeDecimal('the valuation rate'),
});
export type ReconLineInput = z.input<typeof reconLineSchema>;

export const settingsSchema = z.object({
  companyState: optionalText(60),
  defaultGstRate: nonNegativeDecimal('the default GST rate'),
  allowNegativeStock: checkbox,
});
export type SettingsInput = z.input<typeof settingsSchema>;

// -------------------------------------------------------------------- parties

export const partySchema = z.object({
  name: requiredText('the name', 160),
  gstin: optionalText(15).transform((s) => (s ? s.toUpperCase() : null)).refine((s) => !s || /^\d{2}[A-Z0-9]{13}$/.test(s), 'A GSTIN has 15 characters, starting with the 2-digit state code.'),
  pan: optionalText(10).transform((s) => (s ? s.toUpperCase() : null)).refine((s) => !s || /^[A-Z]{5}\d{4}[A-Z]$/.test(s), 'A PAN looks like ABCDE1234F.'),
  state: optionalText(60),
  address: optionalText(500),
  city: optionalText(80),
  pincode: optionalText(10),
  contactPerson: optionalText(120),
  email: optionalText(160).refine((s) => !s || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s), 'Enter a valid email address.'),
  phone: optionalText(30),
  paymentTermsDays: z
    .union([z.string(), z.number()])
    .optional()
    .nullable()
    .transform((v) => (v === null || v === undefined || String(v).trim() === '' ? 30 : Math.max(0, Math.round(Number(v)) || 0))),
  creditLimit: optionalDecimal('the credit limit'),
  notes: optionalText(1000),
});
export type PartyInput = z.input<typeof partySchema>;

// -------------------------------------------------------------------- buying

export const materialRequestSchema = z.object({
  purpose: z.enum(['PURCHASE', 'TRANSFER', 'ISSUE'], { message: 'Pick what the material is for.' }),
  requestDate: isoDate('the request date'),
  requiredBy: optionalDate,
  warehouseId: optionalId,
  projectId: optionalId,
  remarks: optionalText(500),
});
export type MaterialRequestInput = z.input<typeof materialRequestSchema>;

export const materialRequestLineSchema = z.object({
  itemCode: requiredText('an item code', 60).transform((s) => s.toUpperCase()),
  qty: positiveDecimal('the quantity'),
  warehouseId: optionalId,
  requiredBy: optionalDate,
});
export type MaterialRequestLineInput = z.input<typeof materialRequestLineSchema>;

export const supplierQuotationSchema = z.object({
  supplierId: id('a supplier'),
  quoteDate: isoDate('the quotation date'),
  validTill: optionalDate,
  materialRequestId: optionalId,
  supplierRef: optionalText(80),
  remarks: optionalText(500),
});
export type SupplierQuotationInput = z.input<typeof supplierQuotationSchema>;

export const priceLineSchema = z.object({
  itemCode: requiredText('an item code', 60).transform((s) => s.toUpperCase()),
  qty: positiveDecimal('the quantity'),
  rate: nonNegativeDecimal('the rate'),
  leadTimeDays: z
    .union([z.string(), z.number()])
    .optional()
    .nullable()
    .transform((v) => (v === null || v === undefined || String(v).trim() === '' ? null : Math.max(0, Math.round(Number(v)) || 0))),
  warehouseId: optionalId,
  scheduleDate: optionalDate,
  description: optionalText(500),
});
export type PriceLineInput = z.input<typeof priceLineSchema>;

export const lineEditSchema = z.object({
  qty: positiveDecimal('the quantity'),
  rate: optionalDecimal('the rate'),
  rejectedQty: optionalDecimal('the rejected quantity'),
});
export type LineEditInput = z.input<typeof lineEditSchema>;

export const purchaseOrderSchema = z.object({
  supplierId: id('a supplier'),
  orderDate: isoDate('the order date'),
  scheduleDate: optionalDate,
  projectId: optionalId,
  supplierRef: optionalText(80),
  terms: optionalText(4000),
  remarks: optionalText(500),
});
export type PurchaseOrderInput = z.input<typeof purchaseOrderSchema>;

export const purchaseReceiptSchema = z.object({
  postingDate: isoDate('the receipt date'),
  supplierDeliveryNote: optionalText(80),
  remarks: optionalText(500),
});
export type PurchaseReceiptInput = z.input<typeof purchaseReceiptSchema>;

export const purchaseInvoiceSchema = z.object({
  postingDate: isoDate('the posting date'),
  billNo: optionalText(60),
  billDate: optionalDate,
  dueDate: optionalDate,
  remarks: optionalText(500),
});
export type PurchaseInvoiceInput = z.input<typeof purchaseInvoiceSchema>;

export const expenseLineSchema = z.object({
  description: requiredText('what the charge is for', 300),
  accountId: id('an expense account'),
  qty: positiveDecimal('the quantity'),
  rate: nonNegativeDecimal('the rate'),
  gstRate: nonNegativeDecimal('the GST rate'),
});
export type ExpenseLineInput = z.input<typeof expenseLineSchema>;
