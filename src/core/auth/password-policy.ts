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

function getRandomInt(max: number): number {
  if (max <= 1) return 0;
  // Rejection sampling to avoid modulo bias over Uint32
  const threshold = Math.floor(0x100000000 / max) * max;
  const buf = new Uint32Array(1);
  while (true) {
    crypto.getRandomValues(buf);
    if (buf[0]! < threshold) {
      return buf[0]! % max;
    }
  }
}

export function generateSecurePassword(length = 14): string {
  const lowers = 'abcdefghijkmnopqrstuvwxyz';
  const uppers = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  const specials = '!@#$%&*';
  const all = lowers + uppers + digits + specials;

  const chars = [
    lowers[getRandomInt(lowers.length)]!,
    uppers[getRandomInt(uppers.length)]!,
    digits[getRandomInt(digits.length)]!,
    specials[getRandomInt(specials.length)]!,
  ];

  for (let i = chars.length; i < length; i++) {
    chars.push(all[getRandomInt(all.length)]!);
  }

  for (let i = chars.length - 1; i > 0; i--) {
    const j = getRandomInt(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }

  return chars.join('');
}
