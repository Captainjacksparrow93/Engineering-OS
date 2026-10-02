import { PrismaClient } from '@prisma/client';
import { ALL_PERMISSIONS, PERMISSIONS, SYSTEM_ROLES } from '../../src/core/rbac/permissions';

const prisma = new PrismaClient();

async function main() {
  console.log('==> Ensuring commissioning permissions and role grants...');

  // 1. Upsert all permissions in case seed hasn't run yet
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

  const permissions = await prisma.permission.findMany();
  const permMap = new Map(permissions.map((p) => [p.key, p.id]));

  // 2. Grant new permissions to existing system roles
  for (const [, def] of Object.entries(SYSTEM_ROLES)) {
    const role = await prisma.role.findFirst({
      where: {
        name: def.name,
      },
    });

    if (!role) continue;

    for (const permKey of def.permissions) {
      const permId = permMap.get(permKey);
      if (!permId) continue;

      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: role.id,
            permissionId: permId,
          },
        },
        create: {
          roleId: role.id,
          permissionId: permId,
        },
        update: {},
      });
    }
  }

  console.log('==> Commissioning permissions sync completed.');
}

main()
  .catch((e) => {
    console.error('Failed to sync commissioning permissions:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
