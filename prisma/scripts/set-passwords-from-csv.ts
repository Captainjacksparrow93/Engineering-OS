/**
 * One-off: set each person's password from a CSV with a header row containing
 * `Email` and `Password` columns (other columns are ignored).
 *
 *   CSV_PATH=./technical-department-logins.csv npx tsx prisma/scripts/set-passwords-from-csv.ts
 */
import bcrypt from 'bcryptjs';
import { readFileSync } from 'fs';
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
  const path = process.env.CSV_PATH;
  if (!path) throw new Error('Set CSV_PATH.');
  const [header, ...lines] = readFileSync(path, 'utf8').split(/\r?\n/).filter((l) => l.trim());
  const columns = parseLine(header).map((c) => c.trim().toLowerCase());
  const emailAt = columns.indexOf('email');
  const passwordAt = columns.indexOf('password');
  if (emailAt < 0 || passwordAt < 0) throw new Error('CSV needs Email and Password columns.');

  let updated = 0;
  for (const line of lines) {
    const cells = parseLine(line);
    const email = cells[emailAt]?.trim().toLowerCase();
    const password = cells[passwordAt]?.trim();
    if (!email || !password || password.length < 8) { console.warn(`Skipped: ${email ?? line}`); continue; }
    const result = await prisma.user.updateMany({ where: { email }, data: { passwordHash: await bcrypt.hash(password, 12) } });
    if (result.count === 0) console.warn(`No account for ${email}`);
    updated += result.count;
  }
  console.log(`Updated ${updated} of ${lines.length} accounts.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
