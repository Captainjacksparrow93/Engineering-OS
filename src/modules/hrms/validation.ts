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
