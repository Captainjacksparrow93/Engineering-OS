import type { Prisma } from '@prisma/client';
import { prisma, type Tx } from '@/core/db/prisma';
import { audit } from '@/core/audit/audit';
import { DomainError, NotFoundError } from '@/core/rbac/errors';
import type { Principal } from '@/core/rbac/types';
import { D, ZERO } from '../domain/money';
import { itemSchema, warehouseSchema, type ItemInput, type Raw } from '../validation';
import { manageArea, readArea } from './access';
import { getSettings } from './setup';

/**
 * Item master and warehouses (ERPNext Item, Warehouse). The ERP item is the company's one
 * item master; a Sales catalogue item with the same code is kept in step, so Sales quotes
 * and ERP documents talk about the same part.
 */

// ---------------------------------------------------------------- items

export interface ItemFilter {
  q?: string | null;
  group?: string | null;
  includeInactive?: boolean;
  /** Only stock / purchase / sales items. */
  kind?: 'stock' | 'purchase' | 'sales';
}

export async function listItems(p: Principal, f: ItemFilter = {}) {
  await readArea(p, 'stock');
  const q = f.q?.trim();
  const where: Prisma.ErpItemWhereInput = {
    companyId: p.companyId,
    ...(f.includeInactive ? {} : { isActive: true }),
    ...(f.group ? { itemGroup: f.group } : {}),
    ...(f.kind === 'stock' ? { isStockItem: true } : f.kind === 'purchase' ? { isPurchaseItem: true } : f.kind === 'sales' ? { isSalesItem: true } : {}),
    ...(q
      ? { OR: [{ code: { contains: q, mode: 'insensitive' } }, { name: { contains: q, mode: 'insensitive' } }, { makerPartNo: { contains: q, mode: 'insensitive' } }, { make: { contains: q, mode: 'insensitive' } }] }
      : {}),
  };
  const items = await prisma.erpItem.findMany({ where, orderBy: { code: 'asc' }, take: 500, include: { bins: { select: { actualQty: true, stockValue: true } } } });
  return items.map(({ bins, ...item }) => ({
    ...item,
    stockQty: bins.reduce((a, b) => a.plus(b.actualQty), ZERO),
    stockValue: bins.reduce((a, b) => a.plus(b.stockValue), ZERO),
  }));
}

export async function itemGroups(companyId: string): Promise<string[]> {
  const rows = await prisma.erpItem.findMany({ where: { companyId }, distinct: ['itemGroup'], select: { itemGroup: true }, orderBy: { itemGroup: 'asc' } });
  return rows.map((r) => r.itemGroup);
}

/** Lightweight item list for pickers (code, name, uom, rates). */
export async function itemOptions(companyId: string, kind?: ItemFilter['kind']) {
  return prisma.erpItem.findMany({
    where: { companyId, isActive: true, ...(kind === 'stock' ? { isStockItem: true } : kind === 'purchase' ? { isPurchaseItem: true } : kind === 'sales' ? { isSalesItem: true } : {}) },
    select: { id: true, code: true, name: true, uom: true, standardRate: true, lastPurchaseRate: true, gstRate: true, isStockItem: true },
    orderBy: { code: 'asc' },
    take: 2000,
  });
}

export async function getItem(p: Principal, itemId: string) {
  await readArea(p, 'stock');
  const item = await prisma.erpItem.findFirst({
    where: { id: itemId, companyId: p.companyId },
    include: { bins: { include: { warehouse: { select: { id: true, name: true } } }, orderBy: { warehouse: { name: 'asc' } } } },
  });
  if (!item) throw new NotFoundError('Item not found.');
  const ledger = await prisma.erpStockLedger.findMany({ where: { itemId, isCancelled: false }, orderBy: { seq: 'desc' }, take: 50 });
  return { item, ledger };
}

/** Finds an active item by code, for document lines. */
export async function itemByCode(companyId: string, code: string, tx: Tx = prisma) {
  const item = await tx.erpItem.findUnique({ where: { companyId_code: { companyId, code: code.trim().toUpperCase() } } });
  if (!item) throw new DomainError(`No item with code ${code.trim().toUpperCase()}. Add it under Items first.`);
  if (!item.isActive) throw new DomainError(`${item.code} is inactive.`);
  return item;
}

async function assertTemplate(companyId: string, templateId: string | null | undefined, tx: Tx) {
  if (!templateId) return null;
  const t = await tx.erpQualityTemplate.findFirst({ where: { id: templateId, companyId }, select: { id: true } });
  if (!t) throw new DomainError('That inspection template was not found.');
  return t.id;
}

async function assertWarehouse(companyId: string, warehouseId: string | null | undefined, tx: Tx = prisma) {
  if (!warehouseId) return null;
  const wh = await tx.erpWarehouse.findFirst({ where: { id: warehouseId, companyId }, select: { id: true, isActive: true, name: true } });
  if (!wh) throw new DomainError('That warehouse was not found.');
  if (!wh.isActive) throw new DomainError(`${wh.name} is inactive.`);
  return wh.id;
}
export { assertWarehouse };

/** Keeps the Sales catalogue item with the same code in step with the ERP item. */
async function syncSalesCatalogue(tx: Tx, companyId: string, item: { code: string; name: string; make: string | null; makerPartNo: string | null; itemGroup: string; uom: string; isActive: boolean; isSalesItem: boolean; isPurchaseItem: boolean }) {
  const existing = await tx.salesItem.findUnique({ where: { companyId_code: { companyId, code: item.code } }, select: { id: true } });
  const data = { name: item.name, make: item.make, makerPartNo: item.makerPartNo, category: item.itemGroup, uom: item.uom, erpItemCode: item.code, isActive: item.isActive };
  if (existing) await tx.salesItem.update({ where: { id: existing.id }, data });
  // Quotes price purchased parts and sellable items; services used only in-house stay out.
  else if (item.isSalesItem || item.isPurchaseItem) await tx.salesItem.create({ data: { companyId, code: item.code, ...data } });
}

export async function createItem(p: Principal, input: Raw<ItemInput>) {
  await manageArea(p, 'stock');
  const data = itemSchema.parse(input);
  const settings = await getSettings(p.companyId);
  return prisma.$transaction(async (tx) => {
    const clash = await tx.erpItem.findUnique({ where: { companyId_code: { companyId: p.companyId, code: data.code } }, select: { id: true } });
    if (clash) throw new DomainError(`Item code ${data.code} is already used.`);
    const item = await tx.erpItem.create({
      data: {
        companyId: p.companyId,
        ...data,
        gstRate: data.gstRate ?? settings.defaultGstRate,
        defaultWarehouseId: await assertWarehouse(p.companyId, data.defaultWarehouseId, tx),
        qualityTemplateId: await assertTemplate(p.companyId, data.qualityTemplateId, tx),
      },
    });
    await syncSalesCatalogue(tx, p.companyId, item);
    await audit({ actorId: p.userId, module: 'erp', action: 'erp.item.created', entityType: 'ErpItem', entityId: item.id, diff: { code: item.code } }, tx);
    return item;
  });
}

export async function updateItem(p: Principal, itemId: string, input: Raw<ItemInput>) {
  await manageArea(p, 'stock');
  const data = itemSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const before = await tx.erpItem.findFirst({ where: { id: itemId, companyId: p.companyId } });
    if (!before) throw new NotFoundError('Item not found.');
    if (data.code !== before.code) throw new DomainError("An item's code can't change. Add a new item instead.");
    if (before.isStockItem && !data.isStockItem) {
      const moved = await tx.erpStockLedger.count({ where: { itemId, isCancelled: false } });
      if (moved > 0) throw new DomainError(`${before.code} has stock movements, so it must stay a stock item.`);
    }
    const item = await tx.erpItem.update({
      where: { id: itemId },
      data: { ...data, gstRate: data.gstRate ?? before.gstRate, defaultWarehouseId: await assertWarehouse(p.companyId, data.defaultWarehouseId, tx), qualityTemplateId: await assertTemplate(p.companyId, data.qualityTemplateId, tx) },
    });
    await syncSalesCatalogue(tx, p.companyId, item);
    await audit({ actorId: p.userId, module: 'erp', action: 'erp.item.updated', entityType: 'ErpItem', entityId: item.id, diff: { code: item.code } }, tx);
    return item;
  });
}

export async function setItemActive(p: Principal, itemId: string, isActive: boolean) {
  await manageArea(p, 'stock');
  return prisma.$transaction(async (tx) => {
    const item = await tx.erpItem.findFirst({ where: { id: itemId, companyId: p.companyId } });
    if (!item) throw new NotFoundError('Item not found.');
    const updated = await tx.erpItem.update({ where: { id: itemId }, data: { isActive } });
    await syncSalesCatalogue(tx, p.companyId, updated);
    await audit({ actorId: p.userId, module: 'erp', action: isActive ? 'erp.item.activated' : 'erp.item.deactivated', entityType: 'ErpItem', entityId: itemId }, tx);
    return updated;
  });
}

// ---------------------------------------------------------------- warehouses

export async function listWarehouses(p: Principal) {
  await readArea(p, 'stock');
  const rows = await prisma.erpWarehouse.findMany({ where: { companyId: p.companyId }, orderBy: [{ isActive: 'desc' }, { name: 'asc' }], include: { bins: { select: { stockValue: true, actualQty: true } } } });
  return rows.map(({ bins, ...w }) => ({ ...w, stockValue: bins.reduce((a, b) => a.plus(b.stockValue), ZERO), itemCount: bins.filter((b) => !D(b.actualQty).isZero()).length }));
}

export async function warehouseOptions(companyId: string) {
  return prisma.erpWarehouse.findMany({ where: { companyId, isActive: true }, select: { id: true, name: true, systemKey: true }, orderBy: { name: 'asc' } });
}

export async function createWarehouse(p: Principal, input: { name: string }) {
  await manageArea(p, 'stock');
  const { name } = warehouseSchema.parse(input);
  const clash = await prisma.erpWarehouse.findUnique({ where: { companyId_name: { companyId: p.companyId, name } } });
  if (clash) throw new DomainError(`A warehouse called ${name} already exists.`);
  const wh = await prisma.erpWarehouse.create({ data: { companyId: p.companyId, name } });
  await audit({ actorId: p.userId, module: 'erp', action: 'erp.warehouse.created', entityType: 'ErpWarehouse', entityId: wh.id, diff: { name } });
  return wh;
}

export async function renameWarehouse(p: Principal, warehouseId: string, input: { name: string }) {
  await manageArea(p, 'stock');
  const { name } = warehouseSchema.parse(input);
  const wh = await prisma.erpWarehouse.findFirst({ where: { id: warehouseId, companyId: p.companyId } });
  if (!wh) throw new NotFoundError('Warehouse not found.');
  const clash = await prisma.erpWarehouse.findUnique({ where: { companyId_name: { companyId: p.companyId, name } } });
  if (clash && clash.id !== warehouseId) throw new DomainError(`A warehouse called ${name} already exists.`);
  return prisma.erpWarehouse.update({ where: { id: warehouseId }, data: { name } });
}

export async function setWarehouseActive(p: Principal, warehouseId: string, isActive: boolean) {
  await manageArea(p, 'stock');
  const wh = await prisma.erpWarehouse.findFirst({ where: { id: warehouseId, companyId: p.companyId } });
  if (!wh) throw new NotFoundError('Warehouse not found.');
  if (!isActive) {
    if (wh.systemKey) throw new DomainError(`${wh.name} is a default warehouse and can't be switched off.`);
    const held = await prisma.erpBin.count({ where: { warehouseId, actualQty: { not: 0 } } });
    if (held > 0) throw new DomainError(`${wh.name} still holds stock. Move it out first.`);
  }
  return prisma.erpWarehouse.update({ where: { id: warehouseId }, data: { isActive } });
}
