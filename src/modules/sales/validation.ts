import { z } from 'zod';
import { PRICE_SOURCES } from './domain/pricing';

const text = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));
const pct = z.coerce.number().min(-100).max(95);
const money = z.coerce.number().min(0).max(1e11);
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-10-31.')
  .transform((s) => new Date(`${s}T00:00:00Z`));
const optionalDate = z
  .union([isoDate, z.literal(''), z.null(), z.undefined()])
  .transform((d) => (d instanceof Date ? d : null));

export const settingsSchema = z
  .object({
    targetMarginPct: z.coerce.number().min(0).max(60),
    minMarginPct: z.coerce.number().min(0).max(60),
    gstPct: z.coerce.number().min(0).max(40),
    priceStaleDays: z.coerce.number().int().min(1).max(3650),
    pricePriority: z.array(z.enum(PRICE_SOURCES)).min(1).max(3),
    quoteValidityDays: z.coerce.number().int().min(1).max(365),
    followUpDays: z.coerce.number().int().min(1).max(90),
    terms: text(5000),
  })
  .refine((s) => s.minMarginPct <= s.targetMarginPct, { message: 'The minimum margin cannot be above the target margin.', path: ['minMarginPct'] })
  .refine((s) => new Set(s.pricePriority).size === s.pricePriority.length, { message: 'List each price source once.', path: ['pricePriority'] });

export const itemSchema = z.object({
  code: text(60).min(1, 'Enter an item code.').transform((s) => s.toUpperCase()),
  name: text(200).min(2, 'Enter an item name.'),
  make: optionalText(80),
  makerPartNo: optionalText(80),
  category: optionalText(80),
  uom: text(20).min(1).default('Nos'),
  erpItemCode: optionalText(140),
});

export const priceSchema = z
  .object({
    itemId: z.string().min(1),
    source: z.enum(PRICE_SOURCES),
    rate: money.optional().nullable(),
    listPrice: money.optional().nullable(),
    discountPct: z.coerce.number().min(0).max(100).optional().nullable(),
    supplier: optionalText(120),
    reference: optionalText(120),
    effectiveDate: isoDate,
  })
  .refine((p) => (p.rate ?? 0) > 0 || (p.listPrice ?? 0) > 0, { message: 'Enter a rate, or a list price and discount.', path: ['rate'] });

export const accountSchema = z.object({
  name: text(160).min(2, 'Enter the client name.'),
  city: optionalText(80),
  industry: optionalText(80),
  clientRef: optionalText(20),
  notes: optionalText(2000),
});

export const relationshipSchema = z.object({
  strategic: z.boolean(),
  paymentDelayDays: z.coerce.number().int().min(0).max(720).optional().nullable(),
  customerSince: optionalDate,
});

export const contactSchema = z.object({
  name: text(120).min(2, 'Enter the contact name.'),
  email: z
    .string()
    .trim()
    .max(160)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null))
    .pipe(z.string().email('Enter a valid email.').nullable()),
  phone: optionalText(40),
  designation: optionalText(80),
});

export const dealSchema = z
  .object({
    title: text(200).min(3, 'Enter a short deal title.'),
    accountId: z.string().optional().nullable(),
    newAccountName: optionalText(160),
    contactId: optionalText(40),
    value: money.optional().nullable(),
    expectedCloseDate: optionalDate,
    source: optionalText(80),
    notes: optionalText(4000),
    ownerId: optionalText(40),
  })
  .refine((d) => d.accountId || d.newAccountName, { message: 'Pick a client or type a new one.', path: ['accountId'] });

export const dealUpdateSchema = z.object({
  title: text(200).min(3, 'Enter a short deal title.'),
  contactId: optionalText(40),
  value: money.optional().nullable(),
  expectedCloseDate: optionalDate,
  source: optionalText(80),
  notes: optionalText(4000),
  ownerId: optionalText(40),
});

export const OPEN_STAGES = ['LEAD', 'QUALIFIED', 'QUOTED', 'NEGOTIATION'] as const;

export const closeDealSchema = z
  .object({
    outcome: z.enum(['WON', 'LOST']),
    lostReason: optionalText(500),
    erpSalesOrder: optionalText(140),
    woNumber: optionalText(60),
  })
  .refine((c) => c.outcome === 'WON' || c.lostReason, { message: 'Say why the deal was lost.', path: ['lostReason'] });

export const activitySchema = z.object({
  type: z.enum(['NOTE', 'CALL', 'MEETING', 'EMAIL', 'FOLLOW_UP']),
  note: text(2000).min(2, 'Write a short note.'),
  dueAt: optionalDate,
});

export const lineSchema = z
  .object({
    panel: text(80).min(1, 'Name the panel.'),
    itemId: optionalText(40),
    description: optionalText(300),
    uom: optionalText(20),
    qty: z.coerce.number().positive('Quantity must be above 0.').max(1e6),
    unitCost: money.optional().nullable(),
    marginPct: pct.optional().nullable(),
  })
  .refine((l) => l.itemId || (l.description && (l.unitCost ?? -1) >= 0), {
    message: 'Pick a catalogue item, or type a description and unit cost.',
    path: ['description'],
  });

export const lineUpdateSchema = z.object({
  panel: text(80).min(1).optional(),
  description: text(300).min(1).optional(),
  qty: z.coerce.number().positive('Quantity must be above 0.').max(1e6).optional(),
  marginPct: pct.optional(),
  unitPrice: money.optional(),
  unitCost: money.optional(),
});

export const quoteTermsSchema = z.object({
  discountPct: z.coerce.number().min(0).max(50),
  freight: money,
  validUntil: isoDate,
  terms: text(5000),
  showLineItems: z.boolean(),
});

export type SettingsInput = z.input<typeof settingsSchema>;
