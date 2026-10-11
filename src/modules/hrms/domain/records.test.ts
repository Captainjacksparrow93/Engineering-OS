import { describe, expect, it } from 'vitest';
import { anniversaryYears, dayString, isSameMonth, mask, missingDetails, parseDay, safeFileName, sniffDocumentType, yearsBetween } from './records';
import { personalSchema, statutorySchema } from '../validation';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe('HR record helpers', () => {
  it('masks all but the last four characters', () => {
    expect(mask('ABCDE1234F')).toBe('••••••234F');
    expect(mask('123456789012')).toBe('••••••••9012');
    expect(mask('12')).toBe('••••');
    expect(mask(null)).toBeNull();
  });

  it('recognises PDF, PNG and JPEG by their first bytes only', () => {
    expect(sniffDocumentType(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]))).toBe('application/pdf');
    expect(sniffDocumentType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]))).toBe('image/png');
    expect(sniffDocumentType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffDocumentType(new TextEncoder().encode('<html><script>'))).toBeNull();
  });

  it('cleans file names for download headers', () => {
    expect(safeFileName('Offer "letter"; v2.pdf')).toBe('Offer _letter_ v2.pdf');
    expect(safeFileName('"";')).toBe('_');
  });

  it('counts completed years and anniversaries', () => {
    expect(yearsBetween(d('1990-10-12'), d('2026-10-11'))).toBe(35);
    expect(yearsBetween(d('1990-10-11'), d('2026-10-11'))).toBe(36);
    expect(anniversaryYears(d('2020-10-30'), d('2026-10-01'))).toBe(6);
    expect(isSameMonth(d('1990-10-30'), d('2026-10-01'))).toBe(true);
    expect(isSameMonth(d('1990-11-01'), d('2026-10-01'))).toBe(false);
  });

  it('round-trips calendar days', () => {
    expect(dayString(parseDay('2026-02-28'))).toBe('2026-02-28');
    expect(parseDay(null)).toBeNull();
    expect(dayString(null)).toBe('');
  });

  it('lists missing key details', () => {
    expect(missingDetails(null)).toEqual(['Joining date', 'Date of birth', 'Emergency contact', 'PAN', 'Bank account']);
    expect(missingDetails({ dateOfJoining: d('2020-01-01'), dateOfBirth: d('1990-01-01'), emergencyPhone: '9825012345', pan: 'ABCDE1234F', bankAccountNo: '123456' })).toEqual([]);
  });

  it('validates and normalises statutory codes', () => {
    expect(statutorySchema.parse({ pan: 'abcde1234f', bankIfsc: 'hdfc0001234', aadhaar: '1234 5678 9012' })).toMatchObject({ pan: 'ABCDE1234F', bankIfsc: 'HDFC0001234', aadhaar: '123456789012', uan: null });
    expect(statutorySchema.safeParse({ pan: 'ABC123' }).success).toBe(false);
    expect(statutorySchema.safeParse({ bankIfsc: 'HDFC1001234' }).success).toBe(false);
  });

  it('clears blank personal fields and rejects bad ones', () => {
    expect(personalSchema.parse({ personalEmail: '', bloodGroup: 'O+' })).toMatchObject({ personalEmail: null, bloodGroup: 'O+' });
    expect(personalSchema.safeParse({ personalEmail: 'not-an-email' }).success).toBe(false);
    expect(personalSchema.safeParse({ bloodGroup: 'Z+' }).success).toBe(false);
    expect(personalSchema.safeParse({ dateOfBirth: '2026-13-40' }).success).toBe(false);
  });
});
