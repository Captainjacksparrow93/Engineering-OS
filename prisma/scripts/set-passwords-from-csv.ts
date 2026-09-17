/**
 * Set each person's password from a CSV with a header row containing
 * `Email` and `Password` columns (other columns are ignored).
 *
 *   npx tsx prisma/scripts/set-passwords-from-csv.ts            (uses prisma/data/logins.csv)
 *   CSV_PATH=./other.csv npx tsx prisma/scripts/set-passwords-from-csv.ts
 *
 * Runs on every container start. Accounts whose password already matches are skipped.
 */
import bcrypt from 'bcryptjs';
import { existsSync, readFileSync } from 'fs';
import { prisma } from '../../src/core/db/prisma';

function parseLine(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted && ch === '"' && line[i + 1] === '"') { cell += '"'; i++; }
    else if (ch === '"') quoted = !quoted;
    else if (ch === ',' && !quoted) { cells.push(cell); cell = ''; }
    else cell += ch;
  }
  cells.push(cell);
  return cells;
}

async function main() {
  const path = process.env.CSV_PATH ?? 'prisma/data/logins.csv';
  if (!existsSync(path)) { console.log(`No password file at ${path}; skipping.`); return; }
  const [header, ...lines] = readFileSync(path, 'utf8').replace(/^FEFF/, '').split(/\r?\n/).filter((l) => l.trim());
  const columns = parseLine(header).map((c) => c.trim().toLowerCase());
  const emailAt = columns.indexOf('email');
  const passwordAt = columns.indexOf('password');
  if (emailAt < 0 || passwordAt < 0) throw new Error('CSV needs Email and Password columns.');

  let updated = 0;
  for (const line of lines) {
    const cells = parseLine(line);
    const email = cells[emailAt]?.trim().toLowerCase();
    const password = cells[passwordAt]?.trim();
    if (!email || !password || password.length < 8 || password.startsWith('(')) { console.warn(`Skipped a row without a usable password${email ? ` (${email})` : ''}`); continue; }
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true, passwordHash: true } });
    if (!user) { console.warn(`No account for ${email}`); continue; }
    if (await bcrypt.compare(password, user.passwordHash)) continue;
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(password, 12) } });
    updated += 1;
  }
  console.log(`Passwords: updated ${updated}, ${lines.length - updated} already set or skipped.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
