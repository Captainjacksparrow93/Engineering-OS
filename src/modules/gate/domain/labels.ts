import type { GateHostReply, GateVisitSource, GateVisitStatus } from '@prisma/client';

export const REPLY_LABEL: Record<GateHostReply, string> = {
  COMING: 'Coming down',
  WAIT: 'Ask them to wait',
  UNAVAILABLE: 'Not available',
};

export const STATUS_LABEL: Record<GateVisitStatus, string> = {
  EXPECTED: 'Expected',
  CHECKED_IN: 'At reception',
  CHECKED_OUT: 'Left',
  CANCELLED: 'Cancelled',
};

export const SOURCE_LABEL: Record<GateVisitSource, string> = {
  DESK: 'Front desk',
  HOST: 'Employee',
  WALK_IN: 'Walk-in',
};

/** "Rahul Shah (ABC Ltd)" */
export function visitorLabel(v: { visitorName: string; visitorCompany: string | null }): string {
  return v.visitorCompany ? `${v.visitorName} (${v.visitorCompany})` : v.visitorName;
}
