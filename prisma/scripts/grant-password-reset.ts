import { PrismaClient } from '@prisma/client';
import { ALL_PERMISSIONS, PERMISSIONS } from '../../src/core/rbac/permissions';

const prisma = new PrismaClient();

async function main() {
  console.log('==> Ensuring permissions and granting admin.user.password.reset...');

  // 1. Ensure all permissions from PERMISSIONS are upserted
  for (const key of ALL_PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key },
      create: {
        key,
        module: key.split('.')[0]!,
        description: PERMISSIONS[key],
      },
      update: {
        description: PERMISSIONS[key],
      },
    });
  }

  const resetPerm = await prisma.permission.findUnique({
    where: { key: 'admin.user.password.reset' },
  });
  if (!resetPerm) {
    throw new Error('Permission admin.user.password.reset not found after upsert');
  }

  // 2. Grant to DIRECTOR and SUPER_ADMIN roles
  const targetRoles = ['DIRECTOR', 'SUPER_ADMIN'];
  for (const roleKey of targetRoles) {
    const role = await prisma.role.findUnique({
      where: { key: roleKey },
    });
    if (!role) {
      console.log(`   - [SKIP] Role ${roleKey} does not exist in DB yet.`);
      continue;
    }

    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: role.id,
          permissionId: resetPerm.id,
        },
      },
      create: {
        roleId: role.id,
        permissionId: resetPerm.id,
      },
      update: {},
    });
    console.log(`   - [GRANTED] admin.user.password.reset attached to ${roleKey}.`);
  }

  console.log('==> Password reset permission grant complete.');
}

main()
  .catch((e) => {
    console.error('[ERROR] Failed to grant password reset permission:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
