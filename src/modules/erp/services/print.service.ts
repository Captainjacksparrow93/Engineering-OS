import type { Prisma } from '@prisma/client';
import { prisma } from '@/core/db/prisma';
import { NotFoundError } from '@/core/rbac/errors';
import type { Principal } from '@/core/rbac/types';
import { readArea } from './access';

/**
 * Printable ERP documents (purchase order, sales order, delivery note, sales invoice):
 * one normalised shape so a single letterhead template prints them all.
 */
export interface PrintDoc {
  title: string;
  number: string;
  status: string;
  company: { name: string; address: string | null; gstin: string | null };
  partyLabel: string;
  party: { name: string; address: string | null; city: string | null; state: string | null; gstin: string | null } | null;
  meta: Array<[string, string]>;
  lines: Array<{ description: string; hsn: string | null; qty: Prisma.Decimal; uom: string; rate: Prisma.Decimal | null; amount: Prisma.Decimal | null; gstRate: Prisma.Decimal | null }>;
  totals: { netTotal: Prisma.Decimal; cgst: Prisma.Decimal; sgst: Prisma.Decimal; igst: Prisma.Decimal; grandTotal: Prisma.Decimal } | null;
  terms: string | null;
}

export type PrintKind = 'purchase-order' | 'sales-order' | 'delivery-note' | 'sales-invoice';

const day = (d: Date | null | undefined) => (d ? d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—');

type Loader = (p: Principal, id: string) => Promise<PrintDoc>;
const loaders = new Map<PrintKind, Loader>();
export function registerPrint(kind: PrintKind, loader: Loader) {
  loaders.set(kind, loader);
}

export async function printDocument(p: Principal, kind: string, id: string): Promise<PrintDoc> {
  const loader = loaders.get(kind as PrintKind);
  if (!loader) throw new NotFoundError('Unknown document.');
  return loader(p, id);
}

export async function companyBlock(companyId: string) {
  const c = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { name: true, address: true, gstin: true } });
  return c;
}

export async function itemsFor(ids: string[]) {
  const items = await prisma.erpItem.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, name: true, uom: true, hsnCode: true } });
  return new Map(items.map((i) => [i.id, i]));
}

registerPrint('purchase-order', async (p, id) => {
  await readArea(p, 'buying');
  const po = await prisma.erpPurchaseOrder.findFirst({ where: { id, companyId: p.companyId }, include: { lines: { orderBy: { sortOrder: 'asc' } } } });
  if (!po) throw new NotFoundError('Purchase order not found.');
  const [company, supplier, items] = await Promise.all([companyBlock(p.companyId), prisma.erpParty.findUnique({ where: { id: po.supplierId } }), itemsFor(po.lines.map((l) => l.itemId))]);
  return {
    title: 'Purchase Order',
    number: po.number,
    status: po.status,
    company,
    partyLabel: 'Supplier',
    party: supplier,
    meta: [['Order date', day(po.orderDate)], ['Required by', day(po.scheduleDate)], ...(po.supplierRef ? [['Your ref.', po.supplierRef] as [string, string]] : [])],
    lines: po.lines.map((l) => {
      const item = items.get(l.itemId);
      return { description: `${item?.code ?? ''} ${l.description ?? item?.name ?? ''}`.trim(), hsn: item?.hsnCode ?? null, qty: l.qty, uom: item?.uom ?? 'Nos', rate: l.rate, amount: l.amount, gstRate: l.gstRate };
    }),
    totals: po,
    terms: po.terms,
  };
});
