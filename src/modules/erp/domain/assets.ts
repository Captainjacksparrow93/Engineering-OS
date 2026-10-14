import type { ErpMaintenanceFrequency, Prisma } from '@prisma/client';
import { D, type Dec, money, ZERO } from './money';

export interface ScheduleInput {
  grossValue: Prisma.Decimal.Value;
  salvageValue: Prisma.Decimal.Value;
  usefulLifeMonths: number;
  availableForUseDate: Date;
  /** Existing assets: depreciation already booked before go-live, and for how many months. */
  openingAccumulated?: Prisma.Decimal.Value;
  openingMonths?: number;
}

export interface ScheduleRow {
  seq: number;
  scheduleDate: Date;
  amount: Dec;
  accumulated: Dec;
}

/** Last day of the month `offset` months after `from` (UTC dates). */
export function monthEnd(from: Date, offset = 0): Date {
  return new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + offset + 1, 0));
}

/**
 * Straight-line monthly depreciation (ERPNext "Straight Line", monthly frequency): what is
 * left to depreciate (gross − salvage − opening) spread evenly over the months left, booked
 * at each month end from the month the asset is ready for use. The last row takes the
 * rounding, so the schedule always lands exactly on the salvage value.
 */
export function straightLineSchedule(input: ScheduleInput): ScheduleRow[] {
  const opening = money(D(input.openingAccumulated));
  const openingMonths = Math.max(0, input.openingMonths ?? 0);
  const depreciable = money(D(input.grossValue).minus(D(input.salvageValue)).minus(opening));
  const months = input.usefulLifeMonths - openingMonths;
  if (months <= 0 || depreciable.lessThanOrEqualTo(0)) return [];
  const each = money(depreciable.dividedBy(months));
  const rows: ScheduleRow[] = [];
  let booked: Dec = ZERO;
  for (let i = 0; i < months; i++) {
    const amount = i === months - 1 ? depreciable.minus(booked) : each;
    booked = booked.plus(amount);
    rows.push({ seq: i + 1, scheduleDate: monthEnd(input.availableForUseDate, openingMonths + i), amount, accumulated: opening.plus(booked) });
  }
  return rows;
}

export const FREQUENCY_LABEL: Record<ErpMaintenanceFrequency, string> = {
  WEEKLY: 'Weekly',
  MONTHLY: 'Monthly',
  QUARTERLY: 'Every 3 months',
  HALF_YEARLY: 'Every 6 months',
  YEARLY: 'Yearly',
};

/** The next due date after a job done on `from`. Month steps clamp to the month's last day. */
export function nextDue(from: Date, frequency: ErpMaintenanceFrequency): Date {
  if (frequency === 'WEEKLY') return new Date(from.getTime() + 7 * 86_400_000);
  const months = { MONTHLY: 1, QUARTERLY: 3, HALF_YEARLY: 6, YEARLY: 12 }[frequency];
  const target = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + months, 1));
  const last = monthEnd(target).getUTCDate();
  return new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(from.getUTCDate(), last)));
}

/** Hours between two moments, two places. */
export function hoursBetween(from: Date, to: Date): Dec {
  return money(D(Math.max(0, to.getTime() - from.getTime())).dividedBy(3_600_000));
}
