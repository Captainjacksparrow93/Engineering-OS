import { PrismaClient } from '@prisma/client';
import { ALL_PERMISSIONS, PERMISSIONS, SYSTEM_ROLES } from '../../src/core/rbac/permissions';

const prisma = new PrismaClient();

async function main() {
  console.log('==> Ensuring SALES_HEAD role and granting to Dharmesh Thummar (dharmesh.thummar@acsengitech.com)...');

  const def = SYSTEM_ROLES.SALES_HEAD;
  if (!def) {
    throw new Error('SYSTEM_ROLES.SALES_HEAD definition not found in permissions.ts');
  }

  // 1. Ensure all permissions are upserted
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

  // 2. Upsert SALES_HEAD role
  const role = await prisma.role.upsert({
    where: { key: 'SALES_HEAD' },
    create: {
      key: 'SALES_HEAD',
      name: def.name,
      description: def.description,
      isSystem: true,
    },
    update: {
      name: def.name,
      description: def.description,
    },
  });
  console.log(`   - Role '${role.name}' (${role.key}) upserted.`);

  // 3. Attach permissions to SALES_HEAD
  let permsGranted = 0;
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
    permsGranted++;
  }
  console.log(`   - Attached ${permsGranted} permissions to ${role.key}.`);

  // 4. Find Dharmesh Thummar by email - fail loudly if missing, NEVER create him
  const dharmesh = await prisma.user.findUnique({
    where: { email: 'dharmesh.thummar@acsengitech.com' },
    include: { roleAssignments: { include: { role: true } } },
  });
  if (!dharmesh) {
    throw new Error('User dharmesh.thummar@acsengitech.com not found. Script will not create user.');
  }

  // 5. Remove existing DEPARTMENT_HEAD or any other roles to ensure purely view-only
  for (const assignment of dharmesh.roleAssignments) {
    if (assignment.roleId !== role.id) {
      await prisma.roleAssignment.delete({ where: { id: assignment.id } });
      console.log(`   - [REMOVED] Removed previous role '${assignment.role.name}' (${assignment.role.key}) from ${dharmesh.fullName}.`);
    }
  }

  // 6. Assign SALES_HEAD at GLOBAL scope
  const existingGrant = await prisma.roleAssignment.findFirst({
    where: {
      userId: dharmesh.id,
      roleId: role.id,
      scopeType: 'GLOBAL',
      scopeId: null,
    },
  });

  if (existingGrant) {
    console.log(`   - [OK] ${dharmesh.fullName} already has role ${role.key} at GLOBAL scope.`);
  } else {
    await prisma.roleAssignment.create({
      data: {
        userId: dharmesh.id,
        roleId: role.id,
        scopeType: 'GLOBAL',
        scopeId: null,
      },
    });
    console.log(`   - [GRANTED] ${role.key} assigned to ${dharmesh.fullName} at GLOBAL scope.`);
  }

  console.log('==> SALES_HEAD setup complete.');
}

main()
  .catch((e) => {
    console.error('[ERROR] Failed to grant SALES_HEAD:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
