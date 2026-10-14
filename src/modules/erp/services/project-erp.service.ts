import type { Prisma } from '@prisma/client';
import { prisma } from '@/core/db/prisma';
import { NotFoundError } from '@/core/rbac/errors';
import type { Principal } from '@/core/rbac/types';
import { D, type Dec, sum, ZERO } from '../domain/money';
import { canRead } from './access';
import { systemWarehouseId } from './setup';

/**
 * What ERP holds for one PM project, for the read-only Materials panel on the project page:
 * per item, requested → ordered → received → issued, plus the orders and invoices. Quantities
 * are shown to anyone who can see the project; money only to people who can read the ERP area
 * it comes from.
 */

interface Row {
  itemId: string;
  requested: Dec;
  ordered: Dec;
  received: Dec;
  issued: Dec;
  issuedValue: Dec;
  receivedValue: Dec;
}

export async function projectMaterials(p: Principal, projectId: string) {
  const project = await prisma.project.findFirst({ where: { id: projectId, companyId: p.companyId }, select: { id: true } });
  if (!project) throw new NotFoundError('Project not found.');
  const settings = await prisma.erpSettings.findUnique({ where: { companyId: p.companyId }, select: { id: true } });
  if (!settings) return null; // ERP never used: no panel.
  const wip = await systemWarehouseId(p.companyId, 'WIP');
  const [mr, po, pr, issues, orders, invoices, workOrders] = await Promise.all([
    prisma.erpMaterialRequestLine.groupBy({ by: ['itemId'], where: { request: { projectId, status: 'SUBMITTED' } }, _sum: { qty: true } }),
    prisma.erpPurchaseOrderLine.groupBy({ by: ['itemId'], where: { order: { projectId, status: 'SUBMITTED' } }, _sum: { qty: true } }),
    prisma.erpPurchaseReceiptLine.groupBy({ by: ['itemId'], where: { receipt: { projectId, status: 'SUBMITTED' } }, _sum: { qty: true, amount: true } }),
    // Issued = stock that left a store (not Work In Progress) for this project on a stock entry.
    prisma.erpStockLedger.groupBy({ by: ['itemId'], where: { companyId: p.companyId, projectId, isCancelled: false, voucherType: 'Stock Entry', qtyChange: { lt: 0 }, warehouseId: { not: wip } }, _sum: { qtyChange: true, valueChange: true } }),
    prisma.erpSalesOrder.findMany({ where: { companyId: p.companyId, projectId, status: { not: 'CANCELLED' } }, select: { id: true, number: true, status: true, grandTotal: true, woNumber: true } }),
    prisma.erpSalesInvoice.findMany({ where: { companyId: p.companyId, projectId, status: 'SUBMITTED' }, select: { grandTotal: true, outstandingAmount: true, isReturn: true } }),
    prisma.erpWorkOrder.findMany({ where: { companyId: p.companyId, projectId, status: { not: 'CANCELLED' } }, select: { id: true, number: true, qty: true, producedQty: true, status: true } }),
  ]);
  const rows = new Map<string, Row>();
  const row = (itemId: string) => {
    let r = rows.get(itemId);
    if (!r) rows.set(itemId, (r = { itemId, requested: ZERO, ordered: ZERO, received: ZERO, issued: ZERO, issuedValue: ZERO, receivedValue: ZERO }));
    return r;
  };
  for (const x of mr) row(x.itemId).requested = D(x._sum.qty);
  for (const x of po) row(x.itemId).ordered = D(x._sum.qty);
  for (const x of pr) Object.assign(row(x.itemId), { received: D(x._sum.qty), receivedValue: D(x._sum.amount) });
  for (const x of issues) Object.assign(row(x.itemId), { issued: D(x._sum.qtyChange).negated(), issuedValue: D(x._sum.valueChange).negated() });
  const items = await prisma.erpItem.findMany({ where: { id: { in: [...rows.keys()] } }, select: { id: true, code: true, name: true, uom: true } });
  const byId = new Map(items.map((i) => [i.id, i]));
  const showStockMoney = canRead(p, 'stock') || canRead(p, 'buying');
  const showSales = canRead(p, 'selling') || canRead(p, 'accounts');
  const signed = (rows: typeof invoices, pick: (r: (typeof invoices)[number]) => Prisma.Decimal) => sum(rows, (r) => D(pick(r)).times(r.isReturn ? -1 : 1));
  return {
    items: [...rows.values()].map((r) => ({ ...r, item: byId.get(r.itemId) })).sort((a, b) => (a.item?.code ?? '').localeCompare(b.item?.code ?? '')),
    issuedValue: showStockMoney ? sum([...rows.values()], (r) => r.issuedValue) : null,
    receivedValue: showStockMoney ? sum([...rows.values()], (r) => r.receivedValue) : null,
    orders: orders.map((o) => ({ ...o, grandTotal: showSales ? o.grandTotal : null })),
    billed: showSales ? signed(invoices, (r) => r.grandTotal) : null,
    outstanding: showSales ? sum(invoices.filter((i) => !i.isReturn), (r) => r.outstandingAmount) : null,
    workOrders,
    canOpenErp: { stock: canRead(p, 'stock'), buying: canRead(p, 'buying'), selling: canRead(p, 'selling'), manufacturing: canRead(p, 'manufacturing'), accounts: canRead(p, 'accounts') },
  };
}
