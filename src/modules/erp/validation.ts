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
  inspectionBeforePurchase: checkbox,
  inspectionBeforeDelivery: checkbox,
  qualityTemplateId: optionalId,
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
  projectsFromSalesOrders: checkbox,
  salesTerms: optionalText(4000).transform((s) => s ?? ''),
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

// -------------------------------------------------------------------- selling

const woNumber = optionalText(20).refine((s) => !s || /^\d+$/.test(s), 'A WO number is digits only.');

export const salesOrderSchema = z.object({
  customerId: id('a customer'),
  orderDate: isoDate('the order date'),
  deliveryDate: optionalDate,
  poNo: optionalText(80),
  woNumber,
  terms: optionalText(4000),
  remarks: optionalText(500),
});
export type SalesOrderInput = z.input<typeof salesOrderSchema>;

/** Fields that may change after submit (ERPNext "allow on submit"); PM follows them. */
export const submittedOrderSchema = z.object({
  deliveryDate: optionalDate,
  poNo: optionalText(80),
  woNumber,
});
export type SubmittedOrderInput = z.input<typeof submittedOrderSchema>;

export const salesLineSchema = z.object({
  itemCode: requiredText('an item code', 60).transform((s) => s.toUpperCase()),
  qty: positiveDecimal('the quantity'),
  rate: optionalDecimal('the rate'),
  deliveryDate: optionalDate,
  warehouseId: optionalId,
  description: optionalText(500),
});
export type SalesLineInput = z.input<typeof salesLineSchema>;

export const salesLineEditSchema = z.object({
  qty: positiveDecimal('the quantity'),
  rate: optionalDecimal('the rate'),
  deliveryDate: optionalDate,
});
export type SalesLineEditInput = z.input<typeof salesLineEditSchema>;

export const deliveryNoteSchema = z.object({
  postingDate: isoDate('the delivery date'),
  transporter: optionalText(120),
  vehicleNo: optionalText(30),
  lrNo: optionalText(40),
  remarks: optionalText(500),
});
export type DeliveryNoteInput = z.input<typeof deliveryNoteSchema>;

export const salesInvoiceSchema = z.object({
  postingDate: isoDate('the invoice date'),
  dueDate: optionalDate,
  poNo: optionalText(80),
  remarks: optionalText(500),
});
export type SalesInvoiceInput = z.input<typeof salesInvoiceSchema>;

export const incomeLineSchema = z.object({
  description: requiredText('what is being billed', 300),
  accountId: id('an income account'),
  qty: positiveDecimal('the quantity'),
  rate: nonNegativeDecimal('the rate'),
  gstRate: nonNegativeDecimal('the GST rate'),
});
export type IncomeLineInput = z.input<typeof incomeLineSchema>;

// -------------------------------------------------------------------- manufacturing

export const workstationSchema = z.object({
  name: requiredText('the workstation name', 80),
  hourRate: nonNegativeDecimal('the hourly rate'),
  capacity: z
    .union([z.string(), z.number()])
    .optional()
    .nullable()
    .transform((v) => Math.max(1, Math.round(Number(v ?? 1)) || 1)),
  description: optionalText(500),
});
export type WorkstationInput = z.input<typeof workstationSchema>;

export const bomSchema = z.object({
  itemCode: requiredText('the item to make', 60).transform((s) => s.toUpperCase()),
  qty: positiveDecimal('the quantity made'),
  projectId: optionalId,
  remarks: optionalText(500),
});
export type BomInput = z.input<typeof bomSchema>;

export const bomItemSchema = z.object({
  itemCode: requiredText('an item code', 60).transform((s) => s.toUpperCase()),
  qty: positiveDecimal('the quantity'),
});
export type BomItemInput = z.input<typeof bomItemSchema>;

export const bomOperationSchema = z.object({
  operation: requiredText('the operation', 80),
  workstationId: id('a workstation'),
  timeMinutes: positiveDecimal('the time in minutes'),
});
export type BomOperationInput = z.input<typeof bomOperationSchema>;

export const workOrderSchema = z.object({
  itemCode: requiredText('the item to make', 60).transform((s) => s.toUpperCase()),
  qty: positiveDecimal('the quantity'),
  bomId: optionalId,
  plannedStart: optionalDate,
  expectedEnd: optionalDate,
  projectId: optionalId,
  remarks: optionalText(500),
});
export type WorkOrderInput = z.input<typeof workOrderSchema>;

export const qtySchema = z.object({ qty: positiveDecimal('the quantity') });

const dateTime = (label: string) =>
  z.string({ required_error: `Pick ${label}.` }).transform((s, ctx) => {
    const d = new Date(/[zZ]|[+-]\d\d:\d\d$/.test(s) ? s : `${s}:00+05:30`);
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: 'custom', message: `Pick ${label}.` });
      return z.NEVER;
    }
    return d;
  });

export const jobCardLogSchema = z
  .object({
    fromTime: dateTime('the start time'),
    toTime: dateTime('the end time'),
    completedQty: optionalDecimal('the completed quantity'),
    note: optionalText(300),
  })
  .refine((v) => v.toTime > v.fromTime, { message: 'The end time must be after the start time.', path: ['toTime'] });
export type JobCardLogInput = z.input<typeof jobCardLogSchema>;

export const productionPlanSchema = z.object({
  postingDate: isoDate('the plan date'),
  warehouseId: optionalId,
  remarks: optionalText(500),
});
export type ProductionPlanInput = z.input<typeof productionPlanSchema>;

export const planItemSchema = z.object({
  itemCode: requiredText('an item code', 60).transform((s) => s.toUpperCase()),
  qty: positiveDecimal('the quantity'),
  plannedStart: optionalDate,
});
export type PlanItemInput = z.input<typeof planItemSchema>;

// -------------------------------------------------------------------- quality

export const qualityTemplateSchema = z.object({ name: requiredText('the template name', 80) });

export const qualityParameterSchema = z
  .object({
    name: requiredText('the parameter', 120),
    kind: z.enum(['NUMERIC', 'TEXT', 'CHECK'], { message: 'Pick the kind of reading.' }),
    minValue: optionalDecimal('the minimum'),
    maxValue: optionalDecimal('the maximum'),
    acceptanceValue: optionalText(120),
  })
  .refine((v) => !v.minValue || !v.maxValue || v.minValue.lessThanOrEqualTo(v.maxValue), { message: 'The minimum is above the maximum.', path: ['maxValue'] });
export type QualityParameterInput = z.input<typeof qualityParameterSchema>;

export const inspectionSchema = z.object({
  type: z.enum(['INCOMING', 'IN_PROCESS', 'OUTGOING'], { message: 'Pick the inspection type.' }),
  itemCode: requiredText('the item', 60).transform((s) => s.toUpperCase()),
  inspectionDate: isoDate('the inspection date'),
  sampleSize: optionalDecimal('the sample size'),
  referenceType: z.preprocess((v) => (v === '' ? null : v), z.enum(['Purchase Receipt', 'Delivery Note', 'Work Order']).optional().nullable()),
  referenceId: optionalId,
  referenceLineId: optionalId,
  remarks: optionalText(500),
});
export type InspectionInput = z.input<typeof inspectionSchema>;

export const readingSchema = z.object({ parameter: requiredText('the parameter', 120), value: optionalText(120) });

export const NC_SOURCES = ['INCOMING', 'IN_PROCESS', 'FINAL', 'CUSTOMER_COMPLAINT', 'INTERNAL_AUDIT', 'SUPPLIER'] as const;
export const nonConformanceSchema = z.object({
  title: requiredText('a short title', 160),
  description: requiredText('what went wrong', 4000),
  source: z.enum(NC_SOURCES, { message: 'Pick where it was found.' }),
  severity: z.enum(['MINOR', 'MAJOR', 'CRITICAL'], { message: 'Pick the severity.' }),
  itemCode: optionalText(60).transform((s) => (s ? s.toUpperCase() : null)),
  supplierId: optionalId,
  customerId: optionalId,
  projectId: optionalId,
  ownerId: optionalId,
  dueDate: optionalDate,
});
export type NonConformanceInput = z.input<typeof nonConformanceSchema>;

export const capaSchema = z.object({
  rootCause: optionalText(4000),
  correction: optionalText(4000),
  correctiveAction: optionalText(4000),
  preventiveAction: optionalText(4000),
  ownerId: optionalId,
  dueDate: optionalDate,
});
export type CapaInput = z.input<typeof capaSchema>;

export const DOC_CATEGORIES = ['DRAWING', 'PROCEDURE', 'WORK_INSTRUCTION', 'TEST_REPORT', 'FORM', 'MANUAL', 'OTHER'] as const;
export const qualityDocumentSchema = z.object({
  code: requiredText('a document code', 40).transform((s) => s.toUpperCase()),
  title: requiredText('the title', 200),
  category: z.enum(DOC_CATEGORIES, { message: 'Pick the document type.' }),
  projectId: optionalId,
  itemCode: optionalText(60).transform((s) => (s ? s.toUpperCase() : null)),
  needsCustomerApproval: checkbox,
});
export type QualityDocumentInput = z.input<typeof qualityDocumentSchema>;

// -------------------------------------------------------------------- assets + maintenance

const months = (label: string) =>
  z.union([z.string(), z.number()]).transform((v, ctx) => {
    const n = Number(String(v).trim());
    if (!Number.isInteger(n) || n < 0 || n > 1200) {
      ctx.addIssue({ code: 'custom', message: `Enter ${label} as whole months.` });
      return z.NEVER;
    }
    return n;
  });

export const assetCategorySchema = z.object({
  name: requiredText('the category name', 80),
  usefulLifeMonths: months('the useful life').refine((n) => n > 0, 'The useful life must be at least one month.'),
  fixedAssetAccountId: id('the fixed-asset account'),
});
export type AssetCategoryInput = z.input<typeof assetCategorySchema>;

export const assetSchema = z
  .object({
    name: requiredText('the asset name', 160),
    categoryId: id('a category'),
    itemCode: optionalText(60).transform((s) => (s ? s.toUpperCase() : null)),
    serialNo: optionalText(80),
    location: optionalText(120),
    custodianId: optionalId,
    workstationId: optionalId,
    supplierId: optionalId,
    purchaseInvoiceNo: optionalText(40),
    isExisting: checkbox,
    purchaseDate: isoDate('the purchase date'),
    availableForUseDate: optionalDate,
    grossValue: positiveDecimal('the purchase value'),
    salvageValue: optionalDecimal('the salvage value'),
    usefulLifeMonths: z.union([z.string(), z.number()]).optional().nullable().transform((v) => (v === null || v === undefined || String(v).trim() === '' ? null : Number(v))),
    openingAccumulated: optionalDecimal('the depreciation already booked'),
    openingMonths: z.union([z.string(), z.number()]).optional().nullable().transform((v) => (v === null || v === undefined || String(v).trim() === '' ? 0 : Number(v))),
    maintenanceRequired: checkbox,
    notes: optionalText(2000),
  })
  .superRefine((a, ctx) => {
    if (a.usefulLifeMonths !== null && (!Number.isInteger(a.usefulLifeMonths) || a.usefulLifeMonths <= 0)) ctx.addIssue({ code: 'custom', path: ['usefulLifeMonths'], message: 'Enter the useful life as whole months.' });
    if (!Number.isInteger(a.openingMonths) || a.openingMonths < 0) ctx.addIssue({ code: 'custom', path: ['openingMonths'], message: 'Enter the months already depreciated as a whole number.' });
    if (a.salvageValue && a.salvageValue.greaterThanOrEqualTo(a.grossValue)) ctx.addIssue({ code: 'custom', path: ['salvageValue'], message: 'The salvage value must be less than the purchase value.' });
    if (!a.isExisting && (a.openingAccumulated?.greaterThan(0) || a.openingMonths > 0)) ctx.addIssue({ code: 'custom', path: ['openingAccumulated'], message: 'Only an existing asset can carry depreciation booked before go-live.' });
    if (a.availableForUseDate && a.availableForUseDate < a.purchaseDate) ctx.addIssue({ code: 'custom', path: ['availableForUseDate'], message: 'The asset can’t be in use before it was bought.' });
  });
export type AssetInput = z.input<typeof assetSchema>;

export const assetMoveSchema = z.object({
  movedAt: isoDate('the date'),
  location: optionalText(120),
  custodianId: optionalId,
  note: optionalText(500),
});
export type AssetMoveInput = z.input<typeof assetMoveSchema>;

export const maintenanceScheduleSchema = z.object({
  assetId: id('an asset'),
  task: requiredText('the task', 200),
  frequency: z.enum(['WEEKLY', 'MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY'], { message: 'Pick how often.' }),
  nextDueDate: isoDate('the first due date'),
  assignedToId: optionalId,
  checklist: optionalText(4000),
});
export type MaintenanceScheduleInput = z.input<typeof maintenanceScheduleSchema>;

export const maintenanceDoneSchema = z.object({
  doneOn: isoDate('the date it was done'),
  actionTaken: optionalText(4000),
  cost: optionalDecimal('the cost'),
  downtimeHours: optionalDecimal('the downtime'),
});
export type MaintenanceDoneInput = z.input<typeof maintenanceDoneSchema>;

export const breakdownSchema = z.object({
  assetId: id('an asset'),
  description: requiredText('what went wrong', 4000),
  assignedToId: optionalId,
});
export type BreakdownInput = z.input<typeof breakdownSchema>;

export const repairDoneSchema = z.object({
  actionTaken: requiredText('what was done', 4000),
  cost: optionalDecimal('the cost'),
  downtimeHours: optionalDecimal('the downtime'),
});
export type RepairDoneInput = z.input<typeof repairDoneSchema>;
