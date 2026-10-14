import type { Prisma } from '@prisma/client';
import { prisma } from '@/core/db/prisma';
import type { Principal } from '@/core/rbac/types';
import { D, Dec, ZERO } from '../domain/money';
import { readArea } from './access';

/** Stock reports (ERPNext Stock Balance, Stock Ledger, Stock Projected Qty / reorder). */

export async function stockBalance(p: Principal, f: { warehouseId?: string | null; group?: string | null; q?: string | null } = {}) {
  await readArea(p, 'stock');
  const q = f.q?.trim();
  const bins = await prisma.erpBin.findMany({
    where: {
      companyId: p.companyId,
      ...(f.warehouseId ? { warehouseId: f.warehouseId } : {}),
      item: {
        ...(f.group ? { itemGroup: f.group } : {}),
        ...(q ? { OR: [{ code: { contains: q, mode: 'insensitive' } }, { name: { contains: q, mode: 'insensitive' } }] } : {}),
      },
      OR: [{ actualQty: { not: 0 } }, { reservedQty: { not: 0 } }, { orderedQty: { not: 0 } }, { requestedQty: { not: 0 } }, { plannedQty: { not: 0 } }],
    },
    include: { item: { select: { id: true, code: true, name: true, uom: true, itemGroup: true } }, warehouse: { select: { id: true, name: true } } },
    orderBy: [{ item: { code: 'asc' } }, { warehouse: { name: 'asc' } }],
    take: 2000,
  });
  const rows = bins.map((b) => ({ ...b, projectedQty: projected(b) }));
  return { rows, totalValue: rows.reduce((a, r) => a.plus(r.stockValue), ZERO) };
}

/** ERPNext projected qty: actual + ordered + requested + planned − reserved. */
export function projected(b: { actualQty: Prisma.Decimal.Value; orderedQty: Prisma.Decimal.Value; requestedQty: Prisma.Decimal.Value; plannedQty: Prisma.Decimal.Value; reservedQty: Prisma.Decimal.Value }): Dec {
  return D(b.actualQty).plus(D(b.orderedQty)).plus(D(b.requestedQty)).plus(D(b.plannedQty)).minus(D(b.reservedQty));
}

export async function stockLedger(p: Principal, f: { itemId?: string | null; warehouseId?: string | null; from: Date; to: Date; projectId?: string | null }) {
  await readArea(p, 'stock');
  const rows = await prisma.erpStockLedger.findMany({
    where: {
      companyId: p.companyId,
      isCancelled: false,
      postingDate: { gte: f.from, lte: f.to },
      ...(f.itemId ? { itemId: f.itemId } : {}),
      ...(f.warehouseId ? { warehouseId: f.warehouseId } : {}),
      ...(f.projectId ? { projectId: f.projectId } : {}),
    },
    orderBy: { seq: 'desc' },
    take: 1000,
  });
  const [items, warehouses] = await Promise.all([
    prisma.erpItem.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.itemId))] } }, select: { id: true, code: true, name: true } }),
    prisma.erpWarehouse.findMany({ where: { companyId: p.companyId }, select: { id: true, name: true } }),
  ]);
  return { rows, items: new Map(items.map((i) => [i.id, i])), warehouses: new Map(warehouses.map((w) => [w.id, w.name])) };
}

/** Items whose projected quantity (all warehouses) is at or below their reorder level. */
export async function reorderList(p: Principal) {
  await readArea(p, 'stock');
  const items = await prisma.erpItem.findMany({
    where: { companyId: p.companyId, isActive: true, isStockItem: true, reorderLevel: { not: null } },
    include: { bins: true },
    orderBy: { code: 'asc' },
  });
  return items
    .map(({ bins, ...item }) => {
      const actual = bins.reduce((a, b) => a.plus(b.actualQty), ZERO);
      const proj = bins.reduce((a, b) => a.plus(projected(b)), ZERO);
      const level = D(item.reorderLevel);
      const suggested = D(item.reorderQty).greaterThan(0) ? D(item.reorderQty) : level.minus(proj);
      return { ...item, actualQty: actual, projectedQty: proj, suggestedQty: suggested };
    })
    .filter((r) => r.projectedQty.lessThanOrEqualTo(D(r.reorderLevel)));
}

/** Stock value per warehouse and in total; the GL Stock In Hand balance it should equal. */
export async function stockSummary(p: Principal) {
  await readArea(p, 'stock');
  const [byWarehouse, stockAccount] = await Promise.all([
    prisma.erpBin.groupBy({ by: ['warehouseId'], where: { companyId: p.companyId }, _sum: { stockValue: true } }),
    prisma.erpAccount.findUnique({ where: { companyId_systemKey: { companyId: p.companyId, systemKey: 'STOCK_IN_HAND' } }, select: { id: true } }),
  ]);
  const gl = stockAccount
    ? await prisma.erpGlEntry.aggregate({ where: { accountId: stockAccount.id, isCancelled: false }, _sum: { debit: true, credit: true } })
    : null;
  const stockValue = byWarehouse.reduce((a, r) => a.plus(D(r._sum.stockValue)), ZERO);
  const glValue = gl ? D(gl._sum.debit).minus(D(gl._sum.credit)) : ZERO;
  return { byWarehouse, stockValue, glValue };
}
