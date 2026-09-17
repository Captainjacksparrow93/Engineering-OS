/**
 * One-off: move accounts that still use the OLD default password to the NEW default.
 * Accounts whose password was changed by the person are left untouched.
 *
 *   OLD_PASSWORD='ChangeMe@2026!' NEW_PASSWORD='ACSengi@2026' npx tsx prisma/scripts/update-default-password.ts
 *
 * Seeding is create-only, so changing SEED_PASSWORD alone never affects existing accounts.
 */
import bcrypt from 'bcryptjs';
import { prisma } from '../../src/core/db/prisma';

async function main() {
  const oldPassword = process.env.OLD_PASSWORD;
  const newPassword = process.env.NEW_PASSWORD;
  if (!oldPassword || !newPassword) throw new Error('Set OLD_PASSWORD and NEW_PASSWORD.');

  const users = await prisma.user.findMany({ select: { id: true, email: true, passwordHash: true } });
  const newHash = await bcrypt.hash(newPassword, 12);
  let updated = 0;
  for (const user of users) {
    if (!(await bcrypt.compare(oldPassword, user.passwordHash))) continue;
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: newHash } });
    updated += 1;
  }
  console.log(`Updated ${updated} of ${users.length} accounts to the new default password.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
