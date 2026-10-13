import { D, Dec, money, rate4, ZERO } from './money';

/** One item in one warehouse. */
export interface BinState {
  qty: Dec;
  value: Dec;
  rate: Dec;
}

export type Move =
  /** In (qty > 0) at `rate`, or out (qty < 0) at the current valuation rate. */
  | { kind: 'move'; qty: Dec; rate?: Dec }
  /** Exact value change: reversals and transfers in, so value is never re-rounded. */
  | { kind: 'value'; qty: Dec; value: Dec }
  /** Stock reconciliation: the counted qty and rate replace the position. */
  | { kind: 'set'; qty: Dec; rate: Dec };

export interface MoveResult {
  after: BinState;
  qtyChange: Dec;
  valueChange: Dec;
  /** The rate this movement happened at. */
  rate: Dec;
}

/**
 * Moving-average valuation (ERPNext "Moving Average"):
 * - incoming stock is added at its own rate and the average is recomputed;
 * - outgoing stock leaves at the current average, and emptying a bin takes its whole value,
 *   so no rounding residue is ever left behind.
 */
export function applyMove(bin: BinState, move: Move): MoveResult {
  if (move.kind === 'set') {
    const value = money(move.qty.times(move.rate));
    const after = { qty: move.qty, value, rate: move.qty.isZero() ? bin.rate : rate4(move.rate) };
    return { after, qtyChange: move.qty.minus(bin.qty), valueChange: value.minus(bin.value), rate: rate4(move.rate) };
  }

  const qty = move.qty;
  let valueChange: Dec;
  let rate: Dec;
  if (move.kind === 'value') {
    valueChange = move.value;
    rate = qty.isZero() ? bin.rate : rate4(move.value.dividedBy(qty).abs());
  } else if (qty.greaterThan(0)) {
    rate = rate4(D(move.rate));
    valueChange = money(qty.times(rate));
  } else {
    rate = bin.rate;
    valueChange = qty.negated().equals(bin.qty) ? bin.value.negated() : money(qty.times(bin.rate));
  }

  const newQty = bin.qty.plus(qty);
  const newValue = newQty.isZero() ? ZERO : bin.value.plus(valueChange);
  if (newQty.isZero()) valueChange = bin.value.negated();
  const newRate = newQty.greaterThan(0) ? rate4(newValue.dividedBy(newQty)) : bin.rate.isZero() ? rate : bin.rate;
  return { after: { qty: newQty, value: newValue, rate: newRate }, qtyChange: qty, valueChange, rate };
}

export const emptyBin = (): BinState => ({ qty: ZERO, value: ZERO, rate: ZERO });
