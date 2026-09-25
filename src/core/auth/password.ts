import bcrypt from 'bcryptjs';

const ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * Minimum policy for an industrial deployment where accounts are handed out by an
 * admin: length beats character-class gymnastics, but keep one of each to satisfy
 * the customer's IT policy.
 */
export function passwordIssues(plain: string): string[] {
  const issues: string[] = [];
  if (plain.length < 10) issues.push('Use at least 10 characters.');
  if (!/[a-z]/.test(plain)) issues.push('Include a lowercase letter.');
  if (!/[A-Z]/.test(plain)) issues.push('Include an uppercase letter.');
  if (!/[0-9]/.test(plain)) issues.push('Include a digit.');
  return issues;
}

export function generateSecurePassword(length = 14): string {
  const lowers = 'abcdefghijkmnopqrstuvwxyz';
  const uppers = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  const specials = '!@#$%&*';
  const all = lowers + uppers + digits + specials;

  const chars = [
    lowers[Math.floor(Math.random() * lowers.length)]!,
    uppers[Math.floor(Math.random() * uppers.length)]!,
    digits[Math.floor(Math.random() * digits.length)]!,
    specials[Math.floor(Math.random() * specials.length)]!,
  ];

  for (let i = chars.length; i < length; i++) {
    chars.push(all[Math.floor(Math.random() * all.length)]!);
  }

  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }

  return chars.join('');
}

