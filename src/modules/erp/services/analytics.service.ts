import { prisma } from '@/core/db/prisma';
import type { Principal } from '@/core/rbac/types';
import { fiscalYear } from '../domain/chart';
import { D, type Dec, sum, ZERO } from '../domain/money';
import { canRead, readArea } from './access';

/**
 * ERP analytics (ERPNext workspaces' number cards and charts): the ERP home's key figures per
 * area the person can read, monthly sales/purchase trends, and top customers, suppliers and
 * items. Invoice figures are net of GST, with credit/debit notes netted.
 */

const istToday = () => new Date(`${new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10)}T00:00:00.000Z`);

export interface Kpi {
  label: string;
  value: Dec | number;
  money?: boolean;
  href: string;
  warn?: boolean;
}

export async function erpHomeKpis(p: Principal): Promise<Kpi[]> {
  const companyId = p.companyId;
  const today = istToday();
  const fy = fiscalYear(today);
  const out: Kpi[] = [];
  const jobs: Array<Promise<void>> = [];
  if (canRead(p, 'selling')) {
    jobs.push(
      (async () => {
        const [sales, open] = await Promise.all([
          prisma.erpSalesInvoice.findMany({ where: { companyId, status: 'SUBMITTED', postingDate: { gte: fy.start, lte: today } }, select: { netTotal: true, isReturn: true } }),
          prisma.erpSalesOrder.count({ where: { companyId, status: 'SUBMITTED', isClosed: false, lines: { some: { deliveredQty: { lt: prisma.erpSalesOrderLine.fields.qty } } } } }),
        ]);
        out.push({ label: `Sales, ${fy.label}`, value: sum(sales, (s) => D(s.netTotal).times(s.isReturn ? -1 : 1)), money: true, href: '/erp/selling/invoices' });
        out.push({ label: 'Orders to deliver', value: open, href: '/erp/selling/orders?status=OPEN' });
      })(),
    );
  }
  if (canRead(p, 'buying')) {
    jobs.push(
      (async () => {
        const [buys, open] = await Promise.all([
          prisma.erpPurchaseInvoice.findMany({ where: { companyId, status: 'SUBMITTED', postingDate: { gte: fy.start, lte: today } }, select: { netTotal: true, isReturn: true } }),
          prisma.erpPurchaseOrder.count({ where: { companyId, status: 'SUBMITTED', isClosed: false, lines: { some: { receivedQty: { lt: prisma.erpPurchaseOrderLine.fields.qty } } } } }),
        ]);
        out.push({ label: `Purchases, ${fy.label}`, value: sum(buys, (s) => D(s.netTotal).times(s.isReturn ? -1 : 1)), money: true, href: '/erp/buying/invoices' });
        out.push({ label: 'Orders to receive', value: open, href: '/erp/buying/orders?status=OPEN' });
      })(),
    );
  }
  if (canRead(p, 'stock')) {
    jobs.push(
      (async () => {
        const [value, items] = await Promise.all([
          prisma.erpBin.aggregate({ where: { companyId }, _sum: { stockValue: true } }),
          prisma.erpItem.findMany({ where: { companyId, isActive: true, isStockItem: true, reorderLevel: { not: null } }, select: { id: true, reorderLevel: true } }),
        ]);
        const bins = items.length ? await prisma.erpBin.groupBy({ by: ['itemId'], where: { itemId: { in: items.map((i) => i.id) } }, _sum: { actualQty: true, orderedQty: true } }) : [];
        const have = new Map(bins.map((b) => [b.itemId, D(b._sum.actualQty).plus(D(b._sum.orderedQty))]));
        const low = items.filter((i) => (have.get(i.id) ?? ZERO).lessThan(D(i.reorderLevel))).length;
        out.push({ label: 'Stock value', value: D(value._sum.stockValue), money: true, href: '/erp/stock' });
        out.push({ label: 'Items to reorder', value: low, href: '/erp/stock/reports?view=reorder', warn: low > 0 });
      })(),
    );
  }
  if (canRead(p, 'manufacturing')) {
    jobs.push(
      prisma.erpWorkOrder.count({ where: { companyId, status: 'SUBMITTED', isStopped: false, producedQty: { lt: prisma.erpWorkOrder.fields.qty } } }).then((n) => {
        out.push({ label: 'Work orders running', value: n, href: '/erp/manufacturing/work-orders' });
      }),
    );
  }
  if (canRead(p, 'quality')) {
    jobs.push(
      prisma.erpNonConformance.count({ where: { companyId, status: { not: 'CLOSED' } } }).then((n) => {
        out.push({ label: 'Open non-conformances', value: n, href: '/erp/quality/non-conformances', warn: n > 0 });
      }),
    );
  }
  if (canRead(p, 'assets')) {
    jobs.push(
      Promise.all([
        prisma.erpMaintenanceLog.count({ where: { companyId, kind: 'BREAKDOWN', status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
        prisma.erpMaintenanceSchedule.count({ where: { companyId, isActive: true, nextDueDate: { lt: today } } }),
      ]).then(([down, overdue]) => {
        out.push({ label: 'Machines down', value: down, href: '/erp/assets/breakdowns', warn: down > 0 });
        out.push({ label: 'Maintenance overdue', value: overdue, href: '/erp/assets/maintenance?due=1', warn: overdue > 0 });
      }),
    );
  }
  if (canRead(p, 'accounts')) {
    jobs.push(
      Promise.all([
        prisma.erpSalesInvoice.aggregate({ where: { companyId, status: 'SUBMITTED', isReturn: false }, _sum: { outstandingAmount: true } }),
        prisma.erpPurchaseInvoice.aggregate({ where: { companyId, status: 'SUBMITTED', isReturn: false }, _sum: { outstandingAmount: true } }),
      ]).then(([r, pay]) => {
        out.push({ label: 'Receivable', value: D(r._sum.outstandingAmount), money: true, href: '/erp/accounts/reports/receivables' });
        out.push({ label: 'Payable', value: D(pay._sum.outstandingAmount), money: true, href: '/erp/accounts/reports/payables' });
      }),
    );
  }
  await Promise.all(jobs);
  const order = ['Sales', 'Orders to deliver', 'Purchases', 'Orders to receive', 'Stock value', 'Items to reorder', 'Work orders', 'Open non', 'Machines', 'Maintenance', 'Receivable', 'Payable'];
  return out.sort((a, b) => order.findIndex((o) => a.label.startsWith(o)) - order.findIndex((o) => b.label.startsWith(o)));
}

export interface MonthPoint {
  month: string;
  label: string;
  value: Dec;
}

/** Net sales or purchases per month for the last `months` months (this one included). */
export async function monthlyTrend(p: Principal, kind: 'sales' | 'purchases', months = 12): Promise<MonthPoint[]> {
  await readArea(p, kind === 'sales' ? 'selling' : 'buying');
  const today = istToday();
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - (months - 1), 1));
  const where = { companyId: p.companyId, status: 'SUBMITTED' as const, postingDate: { gte: start, lte: today } };
  const docs = kind === 'sales' ? await prisma.erpSalesInvoice.findMany({ where, select: { postingDate: true, netTotal: true, isReturn: true } }) : await prisma.erpPurchaseInvoice.findMany({ where, select: { postingDate: true, netTotal: true, isReturn: true } });
  const points: MonthPoint[] = Array.from({ length: months }, (_, i) => {
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
    return { month: d.toISOString().slice(0, 7), label: d.toLocaleString('en-IN', { month: 'short', timeZone: 'UTC' }), value: ZERO };
  });
  const byMonth = new Map(points.map((x) => [x.month, x]));
  for (const d of docs) {
    const pt = byMonth.get(d.postingDate.toISOString().slice(0, 7));
    if (pt) pt.value = pt.value.plus(D(d.netTotal).times(d.isReturn ? -1 : 1));
  }
  return points;
}

export interface Ranked {
  id: string;
  name: string;
  value: Dec;
  qty?: Dec;
}

/** Top customers or suppliers by net invoiced value in the fiscal year so far. */
export async function topParties(p: Principal, kind: 'CUSTOMER' | 'SUPPLIER', limit = 8): Promise<Ranked[]> {
  await readArea(p, kind === 'CUSTOMER' ? 'selling' : 'buying');
  const today = istToday();
  const fy = fiscalYear(today);
  const where = { companyId: p.companyId, status: 'SUBMITTED' as const, postingDate: { gte: fy.start, lte: today } };
  const rows =
    kind === 'CUSTOMER'
      ? (await prisma.erpSalesInvoice.findMany({ where, select: { customerId: true, netTotal: true, isReturn: true } })).map((r) => ({ partyId: r.customerId, v: D(r.netTotal).times(r.isReturn ? -1 : 1) }))
      : (await prisma.erpPurchaseInvoice.findMany({ where, select: { supplierId: true, netTotal: true, isReturn: true } })).map((r) => ({ partyId: r.supplierId, v: D(r.netTotal).times(r.isReturn ? -1 : 1) }));
  const totals = new Map<string, Dec>();
  for (const r of rows) totals.set(r.partyId, (totals.get(r.partyId) ?? ZERO).plus(r.v));
  const top = [...totals.entries()].sort((a, b) => b[1].comparedTo(a[1])).slice(0, limit);
  const parties = await prisma.erpParty.findMany({ where: { id: { in: top.map(([id]) => id) } }, select: { id: true, name: true } });
  const name = new Map(parties.map((x) => [x.id, x.name]));
  return top.map(([id, value]) => ({ id, name: name.get(id) ?? '—', value }));
}

/** Top items sold by net value in the fiscal year so far. */
export async function topItemsSold(p: Principal, limit = 8): Promise<Ranked[]> {
  await readArea(p, 'selling');
  const today = istToday();
  const fy = fiscalYear(today);
  const lines = await prisma.erpSalesInvoiceLine.findMany({ where: { itemId: { not: null }, invoice: { companyId: p.companyId, status: 'SUBMITTED', postingDate: { gte: fy.start, lte: today } } }, select: { itemId: true, amount: true, qty: true, invoice: { select: { isReturn: true } } } });
  const totals = new Map<string, { value: Dec; qty: Dec }>();
  for (const l of lines) {
    const sign = l.invoice.isReturn ? -1 : 1;
    const t = totals.get(l.itemId!) ?? { value: ZERO, qty: ZERO };
    totals.set(l.itemId!, { value: t.value.plus(D(l.amount).times(sign)), qty: t.qty.plus(D(l.qty).times(sign)) });
  }
  const top = [...totals.entries()].sort((a, b) => b[1].value.comparedTo(a[1].value)).slice(0, limit);
  const items = await prisma.erpItem.findMany({ where: { id: { in: top.map(([id]) => id) } }, select: { id: true, code: true, name: true } });
  const byId = new Map(items.map((i) => [i.id, `${i.code} ${i.name}`]));
  return top.map(([id, t]) => ({ id, name: byId.get(id) ?? '—', value: t.value, qty: t.qty }));
}
