import { z } from 'zod';

/** Blank form fields clear the value: '' → null. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

/** Optional value that must match `pattern` when given; upper-cased first (PAN, IFSC). */
const optionalCode = (pattern: RegExp, message: string, upper = false) =>
  z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((v) => (v ? (upper ? v.toUpperCase() : v).replace(/\s+/g, '') : null))
    .refine((v) => v === null || pattern.test(v), message);

const optionalDate = (message: string) =>
  z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || (/^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(v).getTime())), message);

const optionalEnum = <T extends [string, ...string[]]>(values: T, message: string) =>
  z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((v) => (v ? v : null))
    .refine((v): v is T[number] | null => v === null || (values as readonly string[]).includes(v), message);

const phone = optionalCode(/^\+?[0-9][0-9-]{6,18}[0-9]$/, 'Enter a phone number, like 98250 12345.');

export const GENDERS = ['FEMALE', 'MALE', 'OTHER'] as const;
export const MARITAL_STATUSES = ['SINGLE', 'MARRIED', 'OTHER'] as const;
export const EMPLOYMENT_TYPES = ['PERMANENT', 'PROBATION', 'CONTRACT', 'INTERN', 'CONSULTANT'] as const;
export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;

/** What an employee may change about themselves. */
export const personalSchema = z.object({
  dateOfBirth: optionalDate('Enter a valid date of birth.'),
  gender: optionalEnum([...GENDERS], 'Pick a gender.'),
  maritalStatus: optionalEnum([...MARITAL_STATUSES], 'Pick a marital status.'),
  bloodGroup: optionalEnum([...BLOOD_GROUPS], 'Pick a blood group.'),
  personalEmail: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((v) => (v ? v.toLowerCase() : null))
    .refine((v) => v === null || z.string().email().safeParse(v).success, 'Enter a valid personal email.'),
  currentAddress: optionalText(400),
  permanentAddress: optionalText(400),
  emergencyName: optionalText(120),
  emergencyRelation: optionalText(60),
  emergencyPhone: phone,
});
export type PersonalInput = z.input<typeof personalSchema>;

/** Job terms: HR only. */
export const jobSchema = z.object({
  dateOfJoining: optionalDate('Enter a valid joining date.'),
  employmentType: optionalEnum([...EMPLOYMENT_TYPES], 'Pick an employment type.'),
  probationEndDate: optionalDate('Enter a valid probation end date.'),
  confirmationDate: optionalDate('Enter a valid confirmation date.'),
  workLocation: optionalText(120),
  biometricId: optionalText(30),
  noticePeriodDays: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((v) => (v ? Number(v) : null))
    .refine((v) => v === null || (Number.isInteger(v) && v >= 0 && v <= 365), 'Notice period is a whole number of days, 0 to 365.'),
});
export type JobInput = z.input<typeof jobSchema>;

/** Statutory and bank details: HR with `hr.sensitive.read` only. */
export const statutorySchema = z.object({
  pan: optionalCode(/^[A-Z]{5}[0-9]{4}[A-Z]$/, 'PAN is 10 characters, like ABCDE1234F.', true),
  aadhaar: optionalCode(/^\d{12}$/, 'Aadhaar is 12 digits.'),
  uan: optionalCode(/^\d{12}$/, 'UAN is 12 digits.'),
  esicNumber: optionalCode(/^\d{10,17}$/, 'ESIC number is 10 to 17 digits.'),
  bankName: optionalText(120),
  bankAccountNo: optionalCode(/^\d{6,18}$/, 'Account number is 6 to 18 digits.'),
  bankIfsc: optionalCode(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'IFSC is 11 characters, like HDFC0001234.', true),
});
export type StatutoryInput = z.input<typeof statutorySchema>;

export const DOCUMENT_CATEGORIES = [
  'OFFER_LETTER',
  'APPOINTMENT_LETTER',
  'ID_PROOF',
  'ADDRESS_PROOF',
  'EDUCATION',
  'EXPERIENCE',
  'BANK',
  'CONTRACT',
  'LETTER',
  'POLICY',
  'OTHER',
] as const;

export const MAX_DOCUMENT_BYTES = 3 * 1024 * 1024;

export const documentSchema = z.object({
  /** Null for a company policy. */
  userId: optionalText(40),
  category: z.enum(DOCUMENT_CATEGORIES, { message: 'Pick a document type.' }),
  title: z.string().trim().min(2, 'Give the document a title.').max(120),
  visibleToEmployee: z.boolean().default(true),
});
/** Raw form input; the schema checks the category is one of `DOCUMENT_CATEGORIES`. */
export type DocumentInput = Omit<z.input<typeof documentSchema>, 'category'> & { category: string };

export interface UploadedFile {
  name: string;
  type: string;
  bytes: Uint8Array;
}

export const directoryFilterSchema = z.object({
  q: optionalText(80),
  departmentId: optionalText(40),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'EXITED', 'ALL']).default('ACTIVE'),
});
export type DirectoryFilter = z.input<typeof directoryFilterSchema>;

// ---------------------------------------------------------------- phase 2: time

const day = (message: string) => z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, message).refine((v) => !Number.isNaN(new Date(v).getTime()), message);
const clock = (message: string) => z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d$/, message);
const note = optionalText(300);

export const leaveRequestSchema = z.object({
  leaveTypeId: z.string().trim().min(1, 'Pick a leave type.'),
  startDate: day('Pick the first day of leave.'),
  endDate: day('Pick the last day of leave.'),
  halfDay: z.boolean().default(false),
  reason: z.string().trim().min(3, 'Say briefly why you need the leave.').max(300),
});
export type LeaveRequestInput = z.input<typeof leaveRequestSchema>;

export const decisionSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT'], { message: 'Approve or reject.' }),
  note,
});
/** Raw form input; the schema checks the decision. */
export type DecisionInput = { decision: string; note?: string | null };

export const regularisationSchema = z.object({
  date: day('Pick the day to correct.'),
  inTime: clock('Enter the time you came in, like 09:30.'),
  outTime: clock('Enter the time you left, like 18:30.'),
  reason: z.string().trim().min(3, 'Say what happened (forgot to punch, site visit, machine down).').max(300),
});
export type RegularisationInput = z.input<typeof regularisationSchema>;

export const leaveTypeSchema = z.object({
  id: optionalText(40),
  code: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9]{0,9}$/, 'Code is 1 to 10 letters or digits, like CL.'),
  name: z.string().trim().min(2, 'Name the leave type.').max(60),
  annualDays: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((v) => (v ? Number(v) : null))
    .refine((v) => v === null || (Number.isFinite(v) && v >= 0 && v <= 365 && Number.isInteger(v * 2)), 'Days a year: 0 to 365, in half days. Leave blank for no limit.'),
  paid: z.boolean(),
  allowHalfDay: z.boolean(),
  active: z.boolean(),
});
export type LeaveTypeInput = z.input<typeof leaveTypeSchema>;

export const allocationSchema = z.object({
  userId: z.string().trim().min(1, 'Pick an employee.'),
  leaveTypeId: z.string().trim().min(1, 'Pick a leave type.'),
  year: z.coerce.number().int().min(2000).max(2100),
  days: z.coerce.number().min(0, 'Days cannot be negative.').max(365).refine((v) => Number.isInteger(v * 2), 'Use whole or half days.'),
  note,
});
/** Raw form input; numbers may arrive as strings and are coerced. */
export type AllocationInput = Omit<z.input<typeof allocationSchema>, 'year' | 'days'> & { year: string | number; days: string | number };

export const holidaySchema = z.object({
  date: day('Pick the holiday date.'),
  name: z.string().trim().min(2, 'Name the holiday.').max(80),
});
export type HolidayInput = z.input<typeof holidaySchema>;

export const shiftSchema = z
  .object({
    shiftStart: clock('Enter the shift start, like 09:30.'),
    graceMinutes: z.coerce.number().int().min(0).max(120, 'Grace is 0 to 120 minutes.'),
    fullDayHours: z.coerce.number().min(1).max(16).refine((v) => Number.isInteger(v * 4), 'Use quarter hours, like 8 or 7.5.'),
    halfDayHours: z.coerce.number().min(0.5).max(12).refine((v) => Number.isInteger(v * 4), 'Use quarter hours, like 4.'),
  })
  .refine((v) => v.halfDayHours < v.fullDayHours, { message: 'A half day must be shorter than a full day.', path: ['halfDayHours'] });
/** Raw form input; numbers may arrive as strings and are coerced. */
export type ShiftInput = { shiftStart: string; graceMinutes: string | number; fullDayHours: string | number; halfDayHours: string | number };
