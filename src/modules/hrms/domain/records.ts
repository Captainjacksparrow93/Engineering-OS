/**
 * Pure HR helpers: masking, file sniffing and the date maths behind the HR overview.
 * Dates are `@db.Date` values, i.e. UTC midnight of the calendar day.
 */

/** `ABCDE1234F` → `••••••234F`. Short values are fully hidden. */
export function mask(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.length <= 4) return '••••';
  return `${'•'.repeat(Math.min(value.length - 4, 8))}${value.slice(-4)}`;
}

const SIGNATURES: Array<{ type: string; bytes: number[] }> = [
  { type: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  { type: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { type: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
];

/** The real type from the file's first bytes; null when it is not a PDF, PNG or JPEG. */
export function sniffDocumentType(bytes: Uint8Array): string | null {
  return SIGNATURES.find((s) => s.bytes.every((b, i) => bytes[i] === b))?.type ?? null;
}

/** Safe for a Content-Disposition header: letters, digits, dot, dash, underscore, space. */
export function safeFileName(name: string): string {
  const cleaned = name.replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 100);
  return cleaned || 'document';
}

/** True when `date` falls in the same calendar month as `today` (any year). */
export function isSameMonth(date: Date | null | undefined, today: Date): boolean {
  return !!date && date.getUTCMonth() === today.getUTCMonth();
}

/** Completed years from `from` to `today`. */
export function yearsBetween(from: Date, today: Date): number {
  let years = today.getUTCFullYear() - from.getUTCFullYear();
  const beforeAnniversary =
    today.getUTCMonth() < from.getUTCMonth() || (today.getUTCMonth() === from.getUTCMonth() && today.getUTCDate() < from.getUTCDate());
  if (beforeAnniversary) years -= 1;
  return years;
}

/** Years an employee completes this calendar year on their joining anniversary. */
export function anniversaryYears(dateOfJoining: Date, today: Date): number {
  return today.getUTCFullYear() - dateOfJoining.getUTCFullYear();
}

/** `2026-10-11` → UTC-midnight Date (the `@db.Date` convention). */
export function parseDay(value: string | null): Date | null {
  return value ? new Date(`${value}T00:00:00.000Z`) : null;
}

/** UTC-midnight Date → `2026-10-11` for `<input type="date">`. */
export function dayString(date: Date | null | undefined): string {
  return date ? date.toISOString().slice(0, 10) : '';
}

/** Key details an HR record should have; returns the labels of those missing. */
export function missingDetails(
  profile: {
    dateOfJoining: Date | null;
    dateOfBirth: Date | null;
    emergencyPhone: string | null;
    pan: string | null;
    bankAccountNo: string | null;
  } | null,
): string[] {
  const missing: string[] = [];
  if (!profile?.dateOfJoining) missing.push('Joining date');
  if (!profile?.dateOfBirth) missing.push('Date of birth');
  if (!profile?.emergencyPhone) missing.push('Emergency contact');
  if (!profile?.pan) missing.push('PAN');
  if (!profile?.bankAccountNo) missing.push('Bank account');
  return missing;
}
