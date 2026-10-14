import type { ErpAssetStatus, Prisma } from '@prisma/client';
import { prisma, type Tx } from '@/core/db/prisma';
import { audit } from '@/core/audit/audit';
import { DomainError, ForbiddenError, NotFoundError } from '@/core/rbac/errors';
import type { Principal } from '@/core/rbac/types';
import { straightLineSchedule } from '../domain/assets';
import { D, money, sum, ZERO } from '../domain/money';
import {
  assetCategorySchema,
  assetMoveSchema,
  assetSchema,
  type AssetCategoryInput,
  type AssetInput,
  type AssetMoveInput,
  type Raw,
} from '../validation';
import { canManage, manageArea, readArea, userNames } from './access';
import { itemByCode } from './item.service';
import { cancelPostings, postGl, type Voucher } from './posting';
import { nextNumber, SERIES } from './series';

/**
 * Asset register (ERPNext Assets): categories, assets, straight-line monthly depreciation,
 * movements and scrapping. Submitting an asset posts nothing: its purchase is booked on a
 * purchase invoice to the fixed-asset account (or, for assets owned before go-live, in the
 * opening balances). Depreciation rows post Dr Depreciation, Cr Accumulated Depreciation;
 * scrapping posts Dr Accumulated Depreciation + Dr Gain/Loss on Asset Disposal, Cr the
 * asset's fixed-asset account. Cancelling reverses everything the asset posted.
 */

export const ASSET_STATUS_LABEL: Record<ErpAssetStatus, string> = { DRAFT: 'Draft', SUBMITTED: 'In use', SCRAPPED: 'Scrapped', CANCELLED: 'Cancelled' };
const DEPRECIATION = 'Asset Depreciation';
const DISPOSAL = 'Asset Disposal';

/** Depreciation is posted by whoever looks after assets, or by accounts. */
export function canPostDepreciation(p: Principal) {
  return canManage(p, 'assets') || canManage(p, 'accounts');
}

// ---------------------------------------------------------------- categories

export async function fixedAssetAccounts(companyId: string) {
  return prisma.erpAccount.findMany({ where: { companyId, accountType: 'FIXED_ASSET', isGroup: false, isActive: true }, select: { id: true, code: true, name: true }, orderBy: { code: 'asc' } });
}

export async function listCategories(p: Principal) {
  await readArea(p, 'assets');
  const [rows, accounts, counts] = await Promise.all([
    prisma.erpAssetCategory.findMany({ where: { companyId: p.companyId }, orderBy: { name: 'asc' } }),
    prisma.erpAccount.findMany({ where: { companyId: p.companyId, accountType: 'FIXED_ASSET' }, select: { id: true, name: true } }),
    prisma.erpAsset.groupBy({ by: ['categoryId'], where: { companyId: p.companyId, status: { in: ['DRAFT', 'SUBMITTED'] } }, _count: true }),
  ]);
  const account = new Map(accounts.map((a) => [a.id, a.name]));
  const count = new Map(counts.map((c) => [c.categoryId, c._count]));
  return rows.map((r) => ({ ...r, accountName: account.get(r.fixedAssetAccountId) ?? '—', assets: count.get(r.id) ?? 0 }));
}

export async function categoryOptions(companyId: string) {
  return prisma.erpAssetCategory.findMany({ where: { companyId, isActive: true }, select: { id: true, name: true, usefulLifeMonths: true }, orderBy: { name: 'asc' } });
}

async function assertFixedAssetAccount(companyId: string, accountId: string) {
  const a = await prisma.erpAccount.findFirst({ where: { id: accountId, companyId, accountType: 'FIXED_ASSET', isGroup: false } });
  if (!a) throw new DomainError('Pick a fixed-asset account (under Fixed Assets).');
  return a.id;
}

export async function createCategory(p: Principal, input: Raw<AssetCategoryInput>) {
  await manageArea(p, 'assets');
  const data = assetCategorySchema.parse(input);
  const clash = await prisma.erpAssetCategory.findUnique({ where: { companyId_name: { companyId: p.companyId, name: data.name } } });
  if (clash) throw new DomainError(`A category called ${data.name} already exists.`);
  const row = await prisma.erpAssetCategory.create({ data: { companyId: p.companyId, name: data.name, usefulLifeMonths: data.usefulLifeMonths, fixedAssetAccountId: await assertFixedAssetAccount(p.companyId, data.fixedAssetAccountId) } });
  await audit({ actorId: p.userId, module: 'erp', action: 'erp.asset_category.created', entityType: 'ErpAssetCategory', entityId: row.id, diff: { name: row.name } });
  return row;
}

export async function updateCategory(p: Principal, id: string, input: Raw<AssetCategoryInput>) {
  await manageArea(p, 'assets');
  const data = assetCategorySchema.parse(input);
  const row = await prisma.erpAssetCategory.findFirst({ where: { id, companyId: p.companyId } });
  if (!row) throw new NotFoundError('Category not found.');
  const clash = await prisma.erpAssetCategory.findFirst({ where: { companyId: p.companyId, name: data.name, id: { not: id } } });
  if (clash) throw new DomainError(`A category called ${data.name} already exists.`);
  return prisma.erpAssetCategory.update({ where: { id }, data: { name: data.name, usefulLifeMonths: data.usefulLifeMonths, fixedAssetAccountId: await assertFixedAssetAccount(p.companyId, data.fixedAssetAccountId) } });
}

// ---------------------------------------------------------------- assets

export async function listAssets(p: Principal, f: { status?: string | null; categoryId?: string | null; q?: string | null } = {}) {
  await readArea(p, 'assets');
  const q = f.q?.trim();
  const rows = await prisma.erpAsset.findMany({
    where: {
      companyId: p.companyId,
      ...(f.status ? { status: f.status as ErpAssetStatus } : { status: { not: 'CANCELLED' } }),
      ...(f.categoryId ? { categoryId: f.categoryId } : {}),
      ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { number: { contains: q, mode: 'insensitive' } }, { serialNo: { contains: q, mode: 'insensitive' } }, { location: { contains: q, mode: 'insensitive' } }] } : {}),
    },
    orderBy: { number: 'desc' },
    take: 500,
  });
  const [categories, posted] = await Promise.all([
    prisma.erpAssetCategory.findMany({ where: { companyId: p.companyId }, select: { id: true, name: true } }),
    prisma.erpDepreciationEntry.groupBy({ by: ['assetId'], where: { assetId: { in: rows.map((r) => r.id) }, postedAt: { not: null } }, _sum: { amount: true } }),
  ]);
  const cat = new Map(categories.map((c) => [c.id, c.name]));
  const dep = new Map(posted.map((d) => [d.assetId, D(d._sum.amount)]));
  return rows.map((r) => ({ ...r, categoryName: cat.get(r.categoryId) ?? '—', bookValue: r.status === 'SCRAPPED' ? ZERO : money(D(r.grossValue).minus(D(r.openingAccumulated)).minus(dep.get(r.id) ?? ZERO)) }));
}

export async function assetOptions(companyId: string) {
  return prisma.erpAsset.findMany({ where: { companyId, status: 'SUBMITTED' }, select: { id: true, number: true, name: true, location: true }, orderBy: { name: 'asc' } });
}

export async function getAsset(p: Principal, id: string) {
  await readArea(p, 'assets');
  const asset = await prisma.erpAsset.findFirst({
    where: { id, companyId: p.companyId },
    include: { depreciation: { orderBy: { seq: 'asc' } }, movements: { orderBy: [{ movedAt: 'desc' }, { createdAt: 'desc' }] } },
  });
  if (!asset) throw new NotFoundError('Asset not found.');
  const [category, item, supplier, invoice, workstation, logs, schedules] = await Promise.all([
    prisma.erpAssetCategory.findUnique({ where: { id: asset.categoryId } }),
    asset.itemId ? prisma.erpItem.findUnique({ where: { id: asset.itemId }, select: { id: true, code: true, name: true } }) : null,
    asset.supplierId ? prisma.erpParty.findUnique({ where: { id: asset.supplierId }, select: { id: true, name: true } }) : null,
    asset.purchaseInvoiceId ? prisma.erpPurchaseInvoice.findUnique({ where: { id: asset.purchaseInvoiceId }, select: { id: true, number: true } }) : null,
    asset.workstationId ? prisma.erpWorkstation.findUnique({ where: { id: asset.workstationId }, select: { id: true, name: true } }) : null,
    prisma.erpMaintenanceLog.findMany({ where: { assetId: id }, orderBy: { reportedAt: 'desc' }, take: 50 }),
    prisma.erpMaintenanceSchedule.findMany({ where: { assetId: id }, orderBy: { nextDueDate: 'asc' } }),
  ]);
  const people = await userNames([asset.custodianId, asset.createdById, ...schedules.map((s) => s.assignedToId), ...logs.map((l) => l.doneById ?? l.assignedToId)]);
  const posted = sum(asset.depreciation.filter((d) => d.postedAt), (d) => d.amount);
  const accumulated = money(D(asset.openingAccumulated).plus(posted));
  return { asset, category, item, supplier, invoice, workstation, logs, schedules, people, accumulated, bookValue: asset.status === 'SCRAPPED' ? ZERO : money(D(asset.grossValue).minus(accumulated)) };
}

async function resolveAsset(companyId: string, data: ReturnType<typeof assetSchema.parse>, tx: Tx) {
  const category = await tx.erpAssetCategory.findFirst({ where: { id: data.categoryId, companyId, isActive: true } });
  if (!category) throw new DomainError('Pick an active asset category.');
  const item = data.itemCode ? await itemByCode(companyId, data.itemCode, tx) : null;
  const [custodian, workstation, supplier] = await Promise.all([
    data.custodianId ? tx.user.findFirst({ where: { id: data.custodianId, companyId } }) : null,
    data.workstationId ? tx.erpWorkstation.findFirst({ where: { id: data.workstationId, companyId } }) : null,
    data.supplierId ? tx.erpParty.findFirst({ where: { id: data.supplierId, companyId, kind: 'SUPPLIER' } }) : null,
  ]);
  if (data.custodianId && !custodian) throw new DomainError('Pick an employee as the custodian.');
  if (data.workstationId && !workstation) throw new DomainError('Pick a workstation.');
  if (data.supplierId && !supplier) throw new DomainError('Pick a supplier.');
  let invoiceId: string | null = null;
  let supplierId = supplier?.id ?? null;
  if (data.purchaseInvoiceNo) {
    const inv = await tx.erpPurchaseInvoice.findFirst({ where: { companyId, number: data.purchaseInvoiceNo.trim().toUpperCase(), status: 'SUBMITTED' } });
    if (!inv) throw new DomainError(`No submitted purchase invoice ${data.purchaseInvoiceNo.trim().toUpperCase()}.`);
    invoiceId = inv.id;
    supplierId ??= inv.supplierId;
  }
  const usefulLifeMonths = data.usefulLifeMonths ?? category.usefulLifeMonths;
  if (data.openingMonths >= usefulLifeMonths && data.openingMonths > 0) throw new DomainError('The months already depreciated must be fewer than the useful life.');
  if (data.openingAccumulated && data.openingAccumulated.greaterThan(D(data.grossValue).minus(D(data.salvageValue)))) throw new DomainError('The depreciation already booked can’t be more than the value less salvage.');
  return {
    name: data.name,
    categoryId: category.id,
    itemId: item?.id ?? null,
    serialNo: data.serialNo,
    location: data.location,
    custodianId: custodian?.id ?? null,
    workstationId: workstation?.id ?? null,
    supplierId,
    purchaseInvoiceId: invoiceId,
    isExisting: data.isExisting,
    purchaseDate: data.purchaseDate,
    availableForUseDate: data.availableForUseDate ?? data.purchaseDate,
    grossValue: money(data.grossValue),
    salvageValue: money(D(data.salvageValue)),
    usefulLifeMonths,
    openingAccumulated: data.isExisting ? money(D(data.openingAccumulated)) : ZERO,
    openingMonths: data.isExisting ? data.openingMonths : 0,
    maintenanceRequired: data.maintenanceRequired,
    notes: data.notes,
  } satisfies Omit<Prisma.ErpAssetUncheckedCreateInput, 'companyId' | 'number' | 'createdById'>;
}

export async function createAsset(p: Principal, input: Raw<AssetInput>) {
  await manageArea(p, 'assets');
  const data = assetSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const fields = await resolveAsset(p.companyId, data, tx);
    const number = await nextNumber(tx, p.companyId, SERIES.asset, data.purchaseDate);
    const row = await tx.erpAsset.create({ data: { ...fields, companyId: p.companyId, number, createdById: p.userId } });
    await audit({ actorId: p.userId, module: 'erp', action: 'erp.asset.created', entityType: 'ErpAsset', entityId: row.id, diff: { number, name: row.name, grossValue: row.grossValue.toFixed(2) } }, tx);
    return row;
  });
}

async function lockAsset(tx: Tx, p: Principal, id: string) {
  const asset = await tx.erpAsset.findFirst({ where: { id, companyId: p.companyId } });
  if (!asset) throw new NotFoundError('Asset not found.');
  return asset;
}

export async function updateAsset(p: Principal, id: string, input: Raw<AssetInput>) {
  await manageArea(p, 'assets');
  const data = assetSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const asset = await lockAsset(tx, p, id);
    if (asset.status !== 'DRAFT') throw new DomainError('Only a draft asset can be edited. Use Move for location and custodian.');
    return tx.erpAsset.update({ where: { id }, data: await resolveAsset(p.companyId, data, tx) });
  });
}

export async function deleteAsset(p: Principal, id: string) {
  await manageArea(p, 'assets');
  return prisma.$transaction(async (tx) => {
    const asset = await lockAsset(tx, p, id);
    if (asset.status !== 'DRAFT') throw new DomainError('Only a draft asset can be deleted. Cancel it instead.');
    await tx.erpAsset.delete({ where: { id } });
  });
}

/** Submit: the asset is in use and gets its depreciation schedule. */
export async function submitAsset(p: Principal, id: string) {
  await manageArea(p, 'assets');
  return prisma.$transaction(async (tx) => {
    const asset = await lockAsset(tx, p, id);
    if (!asset.purchaseInvoiceId && !asset.isExisting) throw new DomainError('Link the purchase invoice that bought it, or mark it as an existing asset (in the opening balances).');
    const moved = await tx.erpAsset.updateMany({ where: { id, status: 'DRAFT' }, data: { status: 'SUBMITTED', submittedAt: new Date() } });
    if (moved.count === 0) throw new DomainError('This asset is already submitted.');
    const rows = straightLineSchedule(asset);
    if (rows.length) await tx.erpDepreciationEntry.createMany({ data: rows.map((r) => ({ assetId: id, seq: r.seq, scheduleDate: r.scheduleDate, amount: r.amount, accumulated: r.accumulated })) });
    await audit({ actorId: p.userId, module: 'erp', action: 'erp.asset.submitted', entityType: 'ErpAsset', entityId: id, diff: { number: asset.number, months: rows.length } }, tx);
  });
}

const depVoucher = (companyId: string, asset: { number: string }, row: { id: string; seq: number; scheduleDate: Date }): Voucher => ({ companyId, type: DEPRECIATION, id: row.id, no: `${asset.number}-D${String(row.seq).padStart(3, '0')}`, postingDate: row.scheduleDate });

async function postRows(tx: Tx, p: Principal, asset: { id: string; number: string; name: string }, rows: Array<{ id: string; seq: number; scheduleDate: Date; amount: Prisma.Decimal }>) {
  for (const row of rows) {
    await postGl(tx, depVoucher(p.companyId, asset, row), [
      { account: 'DEPRECIATION', debit: row.amount, againstType: 'Asset', againstId: asset.id, remarks: `Depreciation: ${asset.name}` },
      { account: 'ACCUMULATED_DEPRECIATION', credit: row.amount, againstType: 'Asset', againstId: asset.id, remarks: `Depreciation: ${asset.name}` },
    ]);
    await tx.erpDepreciationEntry.update({ where: { id: row.id }, data: { postedAt: new Date(), postedById: p.userId } });
  }
}

/** Depreciation due: unposted rows up to a date, for every asset in use. */
export async function depreciationDue(p: Principal, upTo: Date) {
  await readArea(p, 'assets');
  const rows = await prisma.erpDepreciationEntry.findMany({
    where: { postedAt: null, scheduleDate: { lte: upTo }, asset: { companyId: p.companyId, status: 'SUBMITTED' } },
    include: { asset: { select: { id: true, number: true, name: true } } },
    orderBy: [{ scheduleDate: 'asc' }, { seq: 'asc' }],
  });
  return { rows: rows.length, assets: new Set(rows.map((r) => r.assetId)).size, amount: sum(rows, (r) => r.amount), list: rows };
}

/** Post every unposted depreciation row dated on or before `upTo` (one asset, or all). */
export async function postDepreciation(p: Principal, upTo: Date, assetId?: string | null) {
  if (!canPostDepreciation(p)) throw new ForbiddenError("You can't post depreciation.");
  await readArea(p, 'assets');
  return prisma.$transaction(
    async (tx) => {
      const assets = await tx.erpAsset.findMany({ where: { companyId: p.companyId, status: 'SUBMITTED', ...(assetId ? { id: assetId } : {}) }, select: { id: true, number: true, name: true } });
      let count = 0;
      let amount = ZERO;
      for (const asset of assets) {
        const rows = await tx.erpDepreciationEntry.findMany({ where: { assetId: asset.id, postedAt: null, scheduleDate: { lte: upTo } }, orderBy: { seq: 'asc' } });
        await postRows(tx, p, asset, rows);
        count += rows.length;
        amount = amount.plus(sum(rows, (r) => r.amount));
      }
      if (count) await audit({ actorId: p.userId, module: 'erp', action: 'erp.asset.depreciation_posted', entityType: 'ErpAsset', entityId: assetId ?? 'all', diff: { upTo: upTo.toISOString().slice(0, 10), rows: count, amount: amount.toFixed(2) } }, tx);
      return { count, amount };
    },
    { timeout: 60_000 },
  );
}

export async function moveAsset(p: Principal, id: string, input: Raw<AssetMoveInput>) {
  await manageArea(p, 'assets');
  const data = assetMoveSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const asset = await lockAsset(tx, p, id);
    if (asset.status !== 'SUBMITTED') throw new DomainError('Only an asset in use can be moved.');
    if (data.custodianId && !(await tx.user.findFirst({ where: { id: data.custodianId, companyId: p.companyId } }))) throw new DomainError('Pick an employee as the custodian.');
    if (data.location === asset.location && (data.custodianId ?? null) === asset.custodianId) throw new DomainError('Change the location or the custodian.');
    const names = await userNames([asset.custodianId, data.custodianId]);
    await tx.erpAssetMovement.create({
      data: { assetId: id, movedAt: data.movedAt, fromLocation: asset.location, toLocation: data.location, fromCustodian: asset.custodianId ? names.get(asset.custodianId) ?? null : null, toCustodian: data.custodianId ? names.get(data.custodianId) ?? null : null, note: data.note, createdById: p.userId },
    });
    await tx.erpAsset.update({ where: { id }, data: { location: data.location, custodianId: data.custodianId } });
  });
}

/**
 * Scrap: depreciation up to the scrap date is posted first, later rows are dropped, then the
 * asset leaves the books (Dr Accumulated Depreciation, Dr Gain/Loss on Asset Disposal for the
 * book value, Cr its fixed-asset account).
 */
export async function scrapAsset(p: Principal, id: string, input: { date: string; note?: string | null }) {
  await manageArea(p, 'assets');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date ?? '')) throw new DomainError('Pick the scrap date.');
  const date = new Date(`${input.date}T00:00:00.000Z`);
  return prisma.$transaction(async (tx) => {
    const asset = await lockAsset(tx, p, id);
    if (asset.status !== 'SUBMITTED') throw new DomainError('Only an asset in use can be scrapped.');
    if (date < asset.availableForUseDate) throw new DomainError('The scrap date can’t be before the asset was in use.');
    const lastPosted = await tx.erpDepreciationEntry.findFirst({ where: { assetId: id, postedAt: { not: null } }, orderBy: { seq: 'desc' } });
    if (lastPosted && lastPosted.scheduleDate > date) throw new DomainError('Depreciation is already posted after that date. Pick a later scrap date.');
    const due = await tx.erpDepreciationEntry.findMany({ where: { assetId: id, postedAt: null, scheduleDate: { lte: date } }, orderBy: { seq: 'asc' } });
    await postRows(tx, p, asset, due);
    await tx.erpDepreciationEntry.deleteMany({ where: { assetId: id, postedAt: null } });
    const category = await tx.erpAssetCategory.findUniqueOrThrow({ where: { id: asset.categoryId } });
    const posted = await tx.erpDepreciationEntry.aggregate({ where: { assetId: id }, _sum: { amount: true } });
    const accumulated = money(D(asset.openingAccumulated).plus(D(posted._sum.amount)));
    const bookValue = money(D(asset.grossValue).minus(accumulated));
    await postGl(tx, { companyId: p.companyId, type: DISPOSAL, id, no: asset.number, postingDate: date }, [
      { account: 'ACCUMULATED_DEPRECIATION', debit: accumulated, againstType: 'Asset', againstId: id, remarks: `Scrapped: ${asset.name}` },
      { account: 'ASSET_DISPOSAL', debit: bookValue, againstType: 'Asset', againstId: id, remarks: `Scrapped: ${asset.name}` },
      { account: { id: category.fixedAssetAccountId }, credit: asset.grossValue, againstType: 'Asset', againstId: id, remarks: `Scrapped: ${asset.name}` },
    ]);
    await tx.erpAsset.update({ where: { id }, data: { status: 'SCRAPPED', disposalDate: date, disposalNote: input.note?.trim() || null } });
    await tx.erpMaintenanceSchedule.updateMany({ where: { assetId: id }, data: { isActive: false } });
    await audit({ actorId: p.userId, module: 'erp', action: 'erp.asset.scrapped', entityType: 'ErpAsset', entityId: id, diff: { number: asset.number, date: input.date, bookValue: bookValue.toFixed(2) } }, tx);
  });
}

/** Cancel: reverses the disposal and every posted depreciation row; the schedule is dropped. */
export async function cancelAsset(p: Principal, id: string) {
  await manageArea(p, 'assets');
  return prisma.$transaction(async (tx) => {
    const asset = await lockAsset(tx, p, id);
    if (asset.status !== 'SUBMITTED' && asset.status !== 'SCRAPPED') throw new DomainError('Only a submitted asset can be cancelled.');
    if (asset.status === 'SCRAPPED') await cancelPostings(tx, { companyId: p.companyId, type: DISPOSAL, id, no: asset.number, postingDate: asset.disposalDate! });
    const posted = await tx.erpDepreciationEntry.findMany({ where: { assetId: id, postedAt: { not: null } }, orderBy: { seq: 'desc' } });
    for (const row of posted) await cancelPostings(tx, depVoucher(p.companyId, asset, row));
    await tx.erpDepreciationEntry.deleteMany({ where: { assetId: id, postedAt: null } });
    await tx.erpAsset.update({ where: { id }, data: { status: 'CANCELLED' } });
    await tx.erpMaintenanceSchedule.updateMany({ where: { assetId: id }, data: { isActive: false } });
    await audit({ actorId: p.userId, module: 'erp', action: 'erp.asset.cancelled', entityType: 'ErpAsset', entityId: id, diff: { number: asset.number, reversedRows: posted.length } }, tx);
  });
}
