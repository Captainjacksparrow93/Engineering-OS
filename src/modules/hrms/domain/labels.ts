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
