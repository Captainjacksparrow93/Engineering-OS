import type { ErpQualityParamKind, Prisma } from '@prisma/client';

export interface ReadingSpec {
  kind: ErpQualityParamKind;
  minValue: Prisma.Decimal | null;
  maxValue: Prisma.Decimal | null;
  acceptanceValue: string | null;
}

const PASS = new Set(['pass', 'ok', 'yes', 'y', 'on', 'true', 'accepted']);
const FAIL = new Set(['fail', 'no', 'n', 'off', 'false', 'rejected', 'not ok']);

/**
 * Does a recorded value meet its parameter? Null when nothing usable was recorded yet.
 * NUMERIC: within min/max (either bound optional). TEXT: equals the acceptance value
 * (case-insensitive), or anything non-empty when none is set. CHECK: pass/fail words.
 */
export function evaluateReading(spec: ReadingSpec, raw: string | null | undefined): boolean | null {
  const value = (raw ?? '').trim();
  if (!value) return null;
  if (spec.kind === 'NUMERIC') {
    const n = Number(value.replaceAll(',', ''));
    if (!Number.isFinite(n)) return null;
    if (spec.minValue !== null && n < spec.minValue.toNumber()) return false;
    if (spec.maxValue !== null && n > spec.maxValue.toNumber()) return false;
    return true;
  }
  if (spec.kind === 'TEXT') return spec.acceptanceValue ? value.toLowerCase() === spec.acceptanceValue.trim().toLowerCase() : true;
  const v = value.toLowerCase();
  if (PASS.has(v)) return true;
  if (FAIL.has(v)) return false;
  return null;
}

/** Human description of what passes, for the inspection sheet. */
export function acceptanceText(spec: ReadingSpec): string {
  if (spec.kind === 'NUMERIC') {
    if (spec.minValue !== null && spec.maxValue !== null) return `${spec.minValue.toString()} to ${spec.maxValue.toString()}`;
    if (spec.minValue !== null) return `at least ${spec.minValue.toString()}`;
    if (spec.maxValue !== null) return `at most ${spec.maxValue.toString()}`;
    return 'any number';
  }
  if (spec.kind === 'TEXT') return spec.acceptanceValue ? `"${spec.acceptanceValue}"` : 'any note';
  return 'Pass';
}
