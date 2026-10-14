import type { SalesQuote, SalesQuoteLine } from '@prisma/client';
import { prisma, type Tx } from '@/core/db/prisma';
import { audit } from '@/core/audit/audit';
import type { Principal } from '@/core/rbac/types';
import { panelTotals } from '@/modules/sales/domain/pricing';
import { D, money } from '../domain/money';
import { recomputeSalesOrder } from './sales-order.service';
import { nextCode, nextNumber, SERIES } from './series';
import { ensureErpSetup, systemWarehouseId } from './setup';

/**
 * Where Sales, PM and ERP selling meet:
 * - every active checklist template (PLC, SCADA, HMI…) is a sellable panel item, so an order
 *   line's item code is the panel type PM builds;
 * - a won deal becomes a draft sales order from its accepted quote (plan 021 idea, native).
 */

export const FREIGHT_ITEM = 'FREIGHT';
export const PANEL_GROUP = 'Panels';

export async function ensurePanelItems(companyId: string, tx: Tx = prisma) {
  await ensureErpSetup(companyId);
  const templates = await tx.checklistTemplate.findMany({ where: { isActive: true }, select: { code: true, name: true } });
  const fg = await systemWarehouseId(companyId, 'FINISHED_GOODS', tx);
  const settings = await tx.erpSettings.findUnique({ where: { companyId }, select: { defaultGstRate: true } });
  await tx.erpItem.createMany({
    data: [
      ...templates.map((t) => ({ companyId, code: t.code, name: `${t.name} panel`, itemGroup: PANEL_GROUP, isStockItem: true, isPurchaseItem: false, isSalesItem: true, defaultWarehouseId: fg, gstRate: settings?.defaultGstRate ?? 18 })),
      { companyId, code: FREIGHT_ITEM, name: 'Freight and forwarding', itemGroup: 'Services', isStockItem: false, isPurchaseItem: false, isSalesItem: true, gstRate: settings?.defaultGstRate ?? 18 },
    ],
    skipDuplicates: true,
  });
}

/** The ERP customer for a Sales account: matched by name, else created (linked to its PM client by ACS ref). */
export async function customerForAccount(tx: Tx, p: Principal, account: { name: string; clientRef: string | null; city: string | null }) {
  const existing = await tx.erpParty.findUnique({ where: { companyId_kind_name: { companyId: p.companyId, kind: 'CUSTOMER', name: account.name } } });
  if (existing) return existing;
  const client = account.clientRef ? await tx.client.findFirst({ where: { companyId: p.companyId, refNumber: account.clientRef } }) : null;
  const party = await tx.erpParty.create({
    data: { companyId: p.companyId, kind: 'CUSTOMER', code: await nextCode(tx, p.companyId, SERIES.customer), name: account.name, city: account.city, clientId: client?.id ?? null },
  });
  if (client && !client.erpCustomer) await tx.client.update({ where: { id: client.id }, data: { erpCustomer: party.code } });
  await audit({ actorId: p.userId, module: 'erp', action: 'erp.customer.created', entityType: 'ErpParty', entityId: party.id, diff: { name: party.name, from: 'sales account' } }, tx);
  return party;
}

/**
 * Won deal → draft sales order. One line per quote panel group: the item is the checklist
 * template the group's name starts with ("PLC Panel 1" → PLC), at the group's price after the
 * quote discount; freight becomes a FREIGHT line. A Director or the Sales Head checks the
 * draft (dates, WO) and submits it; then New project can pick it.
 */
export async function createOrderFromDeal(
  tx: Tx,
  p: Principal,
  deal: { id: string; code: string; accountId: string },
  quote: SalesQuote & { lines: SalesQuoteLine[] },
  woNumber: string | null,
  orderDate: Date,
) {
  await ensurePanelItems(p.companyId, tx);
  const account = await tx.salesAccount.findUniqueOrThrow({ where: { id: deal.accountId } });
  const customer = await customerForAccount(tx, p, account);
  const items = await tx.erpItem.findMany({ where: { companyId: p.companyId, itemGroup: PANEL_GROUP, isActive: true }, select: { id: true, code: true, defaultWarehouseId: true } });
  const freight = await tx.erpItem.findUniqueOrThrow({ where: { companyId_code: { companyId: p.companyId, code: FREIGHT_ITEM } } });
  const fg = await systemWarehouseId(p.companyId, 'FINISHED_GOODS', tx);
  const stores = await systemWarehouseId(p.companyId, 'STORES', tx);
  const wo = woNumber && /^\d+$/.test(woNumber) ? woNumber : null;
  const woFree = wo ? !(await tx.erpSalesOrder.findFirst({ where: { companyId: p.companyId, woNumber: wo, status: { not: 'CANCELLED' } }, select: { id: true } })) && !(await tx.project.findFirst({ where: { workOrderNo: wo }, select: { id: true } })) : false;

  const so = await tx.erpSalesOrder.create({
    data: {
      companyId: p.companyId,
      number: await nextNumber(tx, p.companyId, SERIES.salesOrder, orderDate),
      customerId: customer.id,
      orderDate,
      woNumber: woFree ? wo : null,
      dealId: deal.id,
      quotationRef: `${quote.number} R${quote.revision}`,
      terms: quote.terms || null,
      remarks: `Won deal ${deal.code}${wo && !woFree ? `. WO ${wo} is already in use: set a new one.` : ''}`,
      createdById: p.userId,
    },
  });

  const discount = D(quote.discountPct);
  const groups = panelTotals(quote.lines.map((l) => ({ panel: l.panel, qty: D(l.qty).toNumber(), unitCost: D(l.unitCost).toNumber(), marginPct: D(l.marginPct).toNumber() })));
  const lines = groups.map((g, n) => {
    const code = g.panel.trim().split(/\s+/)[0]?.toUpperCase() ?? '';
    const item = items.find((i) => i.code === code) ?? items[0];
    const rate = money(D(g.amount).times(D(100).minus(discount)).dividedBy(100));
    return { orderId: so.id, itemId: item!.id, description: g.panel, qty: D(1), rate, amount: rate, gstRate: quote.gstPct, warehouseId: item?.defaultWarehouseId ?? fg, sortOrder: n };
  });
  if (D(quote.freight).greaterThan(0)) lines.push({ orderId: so.id, itemId: freight.id, description: 'Freight and forwarding', qty: D(1), rate: money(quote.freight), amount: money(quote.freight), gstRate: quote.gstPct, warehouseId: stores, sortOrder: lines.length });
  if (lines.length) await tx.erpSalesOrderLine.createMany({ data: lines });
  await recomputeSalesOrder(tx, so.id);
  await audit({ actorId: p.userId, module: 'erp', action: 'erp.sales_order.from_deal', entityType: 'ErpSalesOrder', entityId: so.id, diff: { number: so.number, deal: deal.code, quote: so.quotationRef } }, tx);
  return so;
}
