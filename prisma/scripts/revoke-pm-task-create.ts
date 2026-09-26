import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Revokes task creation permissions from PM and Assistant PM roles.
 * Spec: 4b (docs/client-requests-2026-09-25.md)
 *
 * NOTE: As per system rules, this script is created for deployment automation
 * and must NEVER be run manually against shared or production databases.
 */
async function main() {
  console.log('==> Revoking task creation permissions from PROJECT_MANAGER and ASST_MANAGER...');

  const targetRoles = ['PROJECT_MANAGER', 'ASST_MANAGER'];
  const revokedPermKeys = ['pm.task.create', 'pm.task.adhoc.create'];

  for (const permKey of revokedPermKeys) {
    const perm = await prisma.permission.findUnique({
      where: { key: permKey },
    });
    if (!perm) {
      console.log(`   - [SKIP] Permission ${permKey} does not exist in DB.`);
      continue;
    }

    for (const roleKey of targetRoles) {
      const role = await prisma.role.findUnique({
        where: { key: roleKey },
      });
      if (!role) {
        console.log(`   - [SKIP] Role ${roleKey} does not exist in DB.`);
        continue;
      }

      const deleted = await prisma.rolePermission.deleteMany({
        where: {
          roleId: role.id,
          permissionId: perm.id,
        },
      });

      if (deleted.count > 0) {
        console.log(`   - [REVOKED] Removed ${permKey} from ${roleKey} (${deleted.count} record(s)).`);
      } else {
        console.log(`   - [OK] ${permKey} already absent from ${roleKey}.`);
      }
    }
  }

  console.log('==> Revocation script finished successfully.');
}

main()
  .catch((e) => {
    console.error('Revocation failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
