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
