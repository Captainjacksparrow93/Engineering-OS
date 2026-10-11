import type { HrDocumentCategory, HrEmploymentType, HrGender, HrMaritalStatus } from '@prisma/client';

export const EMPLOYMENT_TYPE_LABEL: Record<HrEmploymentType, string> = {
  PERMANENT: 'Permanent',
  PROBATION: 'On probation',
  CONTRACT: 'Contract',
  INTERN: 'Intern',
  CONSULTANT: 'Consultant',
};

export const GENDER_LABEL: Record<HrGender, string> = { FEMALE: 'Female', MALE: 'Male', OTHER: 'Other' };

export const MARITAL_LABEL: Record<HrMaritalStatus, string> = { SINGLE: 'Single', MARRIED: 'Married', OTHER: 'Other' };

export const DOCUMENT_CATEGORY_LABEL: Record<HrDocumentCategory, string> = {
  OFFER_LETTER: 'Offer letter',
  APPOINTMENT_LETTER: 'Appointment letter',
  ID_PROOF: 'ID proof',
  ADDRESS_PROOF: 'Address proof',
  EDUCATION: 'Education certificate',
  EXPERIENCE: 'Experience letter',
  BANK: 'Bank proof',
  CONTRACT: 'Contract',
  LETTER: 'HR letter',
  POLICY: 'Policy',
  OTHER: 'Other',
};

export const USER_STATUS_LABEL = { ACTIVE: 'Active', SUSPENDED: 'Suspended', EXITED: 'Exited' } as const;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const LEAVE_STATUS_LABEL = {
  PENDING_MANAGER: 'Waiting for manager',
  PENDING_HEAD: 'Waiting for department head',
  APPROVED: 'Approved',
  REJECTED: 'Not approved',
  CANCELLED: 'Cancelled',
} as const;

export const LEAVE_STATUS_BADGE = {
  PENDING_MANAGER: 'badge-outline',
  PENDING_HEAD: 'badge-outline',
  APPROVED: 'badge-success',
  REJECTED: 'badge-error',
  CANCELLED: 'badge-neutral',
} as const;

export const DAY_STATUS_LABEL = {
  PRESENT: 'Present',
  HALF_DAY: 'Half day',
  ABSENT: 'Absent',
  LEAVE: 'On leave',
  HALF_LEAVE: 'Half-day leave',
  HOLIDAY: 'Holiday',
  WEEKLY_OFF: 'Sunday',
  NO_DATA: '',
  MISSED_PUNCH: 'Missed punch',
} as const;

export const DAY_STATUS_BADGE = {
  PRESENT: 'badge-success',
  HALF_DAY: 'badge-outline',
  ABSENT: 'badge-error',
  LEAVE: 'badge-ink',
  HALF_LEAVE: 'badge-ink',
  HOLIDAY: 'badge-neutral',
  WEEKLY_OFF: 'badge-neutral',
  NO_DATA: 'badge-neutral',
  MISSED_PUNCH: 'badge-error',
} as const;

/** `2026-10` → `October 2026` */
export function monthLabel(month: string): string {
  return new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00Z`));
}
