import { randomUUID } from 'node:crypto';
import type { ErpPartyType } from '@prisma/client';
import type { Tx } from '@/core/db/prisma';
import { DomainError } from '@/core/rbac/errors';
import type { SystemAccount } from '../domain/chart';
import { D, Dec, formatQty, money, ZERO } from '../domain/money';
import { applyMove, type BinState, type Move } from '../domain/valuation';

/**
 * The posting engine: the only writer of the stock ledger, bins and the general ledger.
 * Callers run it inside the submit/cancel transaction of their document, so a document
 * and its postings land (or fail) together.
 */

export interface Voucher {
  companyId: string;
  type: string;
  id: string;
  no: string;
  postingDate: Date;
  projectId?: string | null;
}

export interface StockMoveInput {
  itemId: string;
  warehouseId: string;
  /** Signed: positive in, negative out. For `set`, the counted quantity. */
  qty: Dec;
  /** Incoming rate (qty > 0). Ignored for outgoing stock, which leaves at the average. */
  rate?: Dec;
  /** Exact value in (transfers): the value that left the source bin. */
  value?: Dec;
  /** Stock reconciliation: replace the position with `qty` at `rate`. */
  set?: boolean;
  lineId?: string;
  projectId?: string | null;
}

export interface PostedMove {
  valueChange: Dec;
  rate: Dec;
  qtyChange: Dec;
  /** False for non-stock items, which move nothing. */
  posted: boolean;
}

interface LockedBin {
  id: string;
  actualQty: Dec;
  stockValue: Dec;
  valuationRate: Dec;
}

const binKey = (itemId: string, warehouseId: string) => `${itemId}|${warehouseId}`;

async function lockBins(tx: Tx, companyId: string, pairs: Array<{ itemId: string; warehouseId: string }>) {
  const unique = [...new Map(pairs.map((p) => [binKey(p.itemId, p.warehouseId), p])).values()].sort((a, b) =>
    binKey(a.itemId, a.warehouseId).localeCompare(binKey(b.itemId, b.warehouseId)),
  );
  const bins = new Map<string, LockedBin>();
  // Sorted order: two submits touching the same bins always lock them in the same order.
  for (const p of unique) {
    await tx.$executeRaw`
      INSERT INTO "erp_bins" ("id", "companyId", "itemId", "warehouseId", "updatedAt")
      VALUES (${randomUUID()}, ${companyId}, ${p.itemId}, ${p.warehouseId}, now())
      ON CONFLICT ("itemId", "warehouseId") DO NOTHING`;
    const rows = await tx.$queryRaw<LockedBin[]>`
      SELECT "id", "actualQty", "stockValue", "valuationRate" FROM "erp_bins"
      WHERE "itemId" = ${p.itemId} AND "warehouseId" = ${p.warehouseId} FOR UPDATE`;
    const row = rows[0]!;
    bins.set(binKey(p.itemId, p.warehouseId), { id: row.id, actualQty: D(row.actualQty), stockValue: D(row.stockValue), valuationRate: D(row.valuationRate) });
  }
  return bins;
}

async function shortageError(tx: Tx, itemId: string, warehouseId: string, available: Dec, needed: Dec) {
  const [item, wh] = await Promise.all([
    tx.erpItem.findUnique({ where: { id: itemId }, select: { code: true } }),
    tx.erpWarehouse.findUnique({ where: { id: warehouseId }, select: { name: true } }),
  ]);
  return new DomainError(
    `Not enough ${item?.code ?? 'stock'} in ${wh?.name ?? 'the warehouse'}: ${formatQty(available)} available, ${formatQty(needed)} needed.`,
  );
}

async function assertBooksOpen(tx: Tx, companyId: string, postingDate: Date) {
  const settings = await tx.erpSettings.findUnique({ where: { companyId }, select: { booksClosedUpTo: true } });
  if (settings?.booksClosedUpTo && postingDate <= settings.booksClosedUpTo) {
    throw new DomainError(`The books are closed up to ${settings.booksClosedUpTo.toISOString().slice(0, 10)}. Use a later posting date.`);
  }
}

/** Posts stock movements in order and returns each one's value change (signed). */
export async function postStock(tx: Tx, v: Voucher, moves: StockMoveInput[]): Promise<PostedMove[]> {
  await assertBooksOpen(tx, v.companyId, v.postingDate);
  const items = await tx.erpItem.findMany({ where: { id: { in: [...new Set(moves.map((m) => m.itemId))] } }, select: { id: true, isStockItem: true } });
  const stockItems = new Set(items.filter((i) => i.isStockItem).map((i) => i.id));
  const live = moves.filter((m) => stockItems.has(m.itemId));
  const bins = await lockBins(tx, v.companyId, live);
  const settings = await tx.erpSettings.findUnique({ where: { companyId: v.companyId }, select: { allowNegativeStock: true } });

  const results: PostedMove[] = [];
  for (const m of moves) {
    if (!stockItems.has(m.itemId)) {
      results.push({ valueChange: ZERO, rate: D(m.rate), qtyChange: ZERO, posted: false });
      continue;
    }
    const bin = bins.get(binKey(m.itemId, m.warehouseId))!;
    const state: BinState = { qty: bin.actualQty, value: bin.stockValue, rate: bin.valuationRate };
    const move: Move = m.set
      ? { kind: 'set', qty: m.qty, rate: D(m.rate) }
      : m.value !== undefined
        ? { kind: 'value', qty: m.qty, value: m.value }
        : { kind: 'move', qty: m.qty, rate: m.rate };
    const r = applyMove(state, move);
    if (r.after.qty.lessThan(0) && !settings?.allowNegativeStock) {
      throw await shortageError(tx, m.itemId, m.warehouseId, state.qty, r.qtyChange.negated());
    }
    await tx.erpStockLedger.create({
      data: {
        companyId: v.companyId,
        itemId: m.itemId,
        warehouseId: m.warehouseId,
        postingDate: v.postingDate,
        qtyChange: r.qtyChange,
        rate: r.rate,
        valueChange: r.valueChange,
        qtyAfter: r.after.qty,
        valuationRate: r.after.rate,
        stockValue: r.after.value,
        voucherType: v.type,
        voucherId: v.id,
        voucherNo: v.no,
        voucherLineId: m.lineId ?? null,
        projectId: m.projectId ?? v.projectId ?? null,
      },
    });
    await tx.erpBin.update({ where: { id: bin.id }, data: { actualQty: r.after.qty, stockValue: r.after.value, valuationRate: r.after.rate } });
    bin.actualQty = r.after.qty;
    bin.stockValue = r.after.value;
    bin.valuationRate = r.after.rate;
    results.push({ valueChange: r.valueChange, rate: r.rate, qtyChange: r.qtyChange, posted: true });
  }
  return results;
}

export interface GlRow {
  account: SystemAccount | { id: string };
  debit?: Dec;
  credit?: Dec;
  partyType?: ErpPartyType | null;
  partyId?: string | null;
  projectId?: string | null;
  againstType?: string | null;
  againstId?: string | null;
  remarks?: string | null;
}

/** Largest rounding difference absorbed by the Round Off account. Anything bigger is a bug. */
const ROUND_OFF_LIMIT = new Dec(1);

/** Posts a balanced set of GL rows. Zero rows are dropped; a debit-credit pair nets per row. */
export async function postGl(tx: Tx, v: Voucher, rows: GlRow[]): Promise<void> {
  await assertBooksOpen(tx, v.companyId, v.postingDate);
  const keys = [...new Set(rows.map((r) => r.account).filter((a): a is SystemAccount => typeof a === 'string'))];
  const keyed = await tx.erpAccount.findMany({ where: { companyId: v.companyId, systemKey: { in: keys } }, select: { id: true, systemKey: true } });
  const byKey = new Map(keyed.map((a) => [a.systemKey!, a.id]));

  const lines = rows
    .map((r) => {
      const net = money(D(r.debit).minus(D(r.credit)));
      const accountId = typeof r.account === 'string' ? byKey.get(r.account) : r.account.id;
      if (!accountId) throw new Error(`ERP account ${String(r.account)} is missing`);
      return { ...r, accountId, debit: net.greaterThan(0) ? net : ZERO, credit: net.lessThan(0) ? net.negated() : ZERO };
    })
    .filter((r) => !r.debit.isZero() || !r.credit.isZero());
  if (lines.length === 0) return;

  const ids = [...new Set(lines.map((l) => l.accountId))];
  const accounts = await tx.erpAccount.findMany({ where: { id: { in: ids }, companyId: v.companyId }, select: { id: true, isGroup: true, name: true } });
  if (accounts.length !== ids.length) throw new DomainError('An account on this document does not belong to your company.');
  const group = accounts.find((a) => a.isGroup);
  if (group) throw new DomainError(`${group.name} is a group account. Pick an account under it.`);

  const diff = lines.reduce((acc, l) => acc.plus(l.debit).minus(l.credit), ZERO);
  if (!diff.isZero()) {
    if (diff.abs().greaterThan(ROUND_OFF_LIMIT)) throw new Error(`Unbalanced voucher ${v.type} ${v.no}: debit − credit = ${diff.toFixed(2)}`);
    const roundOff = await tx.erpAccount.findUniqueOrThrow({ where: { companyId_systemKey: { companyId: v.companyId, systemKey: 'ROUND_OFF' } }, select: { id: true } });
    lines.push({
      account: 'ROUND_OFF',
      accountId: roundOff.id,
      debit: diff.lessThan(0) ? diff.negated() : ZERO,
      credit: diff.greaterThan(0) ? diff : ZERO,
      remarks: 'Rounding',
    });
  }

  await tx.erpGlEntry.createMany({
    data: lines.map((l) => ({
      companyId: v.companyId,
      postingDate: v.postingDate,
      accountId: l.accountId,
      debit: l.debit,
      credit: l.credit,
      partyType: l.partyType ?? null,
      partyId: l.partyId ?? null,
      projectId: l.projectId ?? v.projectId ?? null,
      voucherType: v.type,
      voucherId: v.id,
      voucherNo: v.no,
      againstType: l.againstType ?? null,
      againstId: l.againstId ?? null,
      remarks: l.remarks ?? null,
    })),
  });
}

/**
 * Cancels a voucher's postings, ERPNext style: reversing stock and GL rows are added at
 * the original posting date and both sides are flagged cancelled. Refused when the stock
 * it brought in has already been used.
 */
export async function cancelPostings(tx: Tx, v: Voucher): Promise<void> {
  await assertBooksOpen(tx, v.companyId, v.postingDate);
  const sles = await tx.erpStockLedger.findMany({
    where: { voucherType: v.type, voucherId: v.id, isCancelled: false },
    orderBy: { seq: 'desc' },
  });
  if (sles.length > 0) {
    await postStock(
      tx,
      v,
      sles.map((s) => ({ itemId: s.itemId, warehouseId: s.warehouseId, qty: D(s.qtyChange).negated(), value: D(s.valueChange).negated(), lineId: s.voucherLineId ?? undefined, projectId: s.projectId })),
    );
    await tx.erpStockLedger.updateMany({ where: { voucherType: v.type, voucherId: v.id }, data: { isCancelled: true } });
  }

  const gls = await tx.erpGlEntry.findMany({ where: { voucherType: v.type, voucherId: v.id, isCancelled: false } });
  if (gls.length > 0) {
    await tx.erpGlEntry.createMany({
      data: gls.map((g) => ({
        companyId: g.companyId,
        postingDate: g.postingDate,
        accountId: g.accountId,
        debit: g.credit,
        credit: g.debit,
        partyType: g.partyType,
        partyId: g.partyId,
        projectId: g.projectId,
        voucherType: g.voucherType,
        voucherId: g.voucherId,
        voucherNo: g.voucherNo,
        againstType: g.againstType,
        againstId: g.againstId,
        remarks: `Cancelled: ${g.remarks ?? v.no}`,
        isCancelled: true,
      })),
    });
    await tx.erpGlEntry.updateMany({ where: { voucherType: v.type, voucherId: v.id }, data: { isCancelled: true } });
  }
}

type BinCounter = 'reservedQty' | 'orderedQty' | 'requestedQty' | 'plannedQty';

/** Adjusts a projected-quantity counter (reserved, ordered, requested, planned) on a bin. */
export async function adjustBin(tx: Tx, companyId: string, itemId: string, warehouseId: string, field: BinCounter, delta: Dec): Promise<void> {
  if (delta.isZero()) return;
  await tx.erpBin.upsert({
    where: { itemId_warehouseId: { itemId, warehouseId } },
    create: { companyId, itemId, warehouseId, [field]: delta },
    update: { [field]: { increment: delta } },
  });
}

/** Sum of stock value moved by a voucher (from its ledger rows). */
export function stockValueOf(moves: PostedMove[]): Dec {
  return moves.reduce((acc, m) => acc.plus(m.valueChange), ZERO);
}
