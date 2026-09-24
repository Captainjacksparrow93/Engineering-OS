import { PrismaClient } from '@prisma/client';
import { ALL_PERMISSIONS, PERMISSIONS, SYSTEM_ROLES } from '../../src/core/rbac/permissions';

const prisma = new PrismaClient();

async function main() {
  console.log('==> Ensuring SERVICE_HEAD role and granting to Rajani Nagar (ACS-0062)...');

  const def = SYSTEM_ROLES.SERVICE_HEAD;
  if (!def) {
    throw new Error('SYSTEM_ROLES.SERVICE_HEAD definition not found in permissions.ts');
  }

  // 1. Find company
  const company = await prisma.company.findFirst({
    where: { code: 'ACS' },
  });
  if (!company) {
    throw new Error('Company ACS not found');
  }

  // 2. Ensure all permissions are upserted
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

  // 3. Upsert SERVICE_HEAD role
  const role = await prisma.role.upsert({
    where: { key: 'SERVICE_HEAD' },
    create: {
      key: 'SERVICE_HEAD',
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

  // 4. Attach permissions to SERVICE_HEAD
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

  // 5. Find Rajani Bhurabhai Nagar
  const rajani = await prisma.user.findFirst({
    where: { employeeCode: 'ACS-0062' },
  });
  if (!rajani) {
    throw new Error('User ACS-0062 (Rajani Bhurabhai Nagar) not found.');
  }

  // 6. Find TECH department
  const techDept = await prisma.department.findFirst({
    where: { code: 'TECH', companyId: company.id },
  });
  if (!techDept) {
    throw new Error('Department TECH not found.');
  }

  // 7. Assign SERVICE_HEAD at DEPARTMENT scope on TECH
  const existingServiceHeadGrant = await prisma.roleAssignment.findFirst({
    where: {
      userId: rajani.id,
      roleId: role.id,
      scopeType: 'DEPARTMENT',
      scopeId: techDept.id,
    },
  });

  if (existingServiceHeadGrant) {
    console.log(`   - [OK] ${rajani.fullName} already has role ${role.key} on department ${techDept.name}.`);
  } else {
    await prisma.roleAssignment.create({
      data: {
        userId: rajani.id,
        roleId: role.id,
        scopeType: 'DEPARTMENT',
        scopeId: techDept.id,
      },
    });
    console.log(`   - [GRANTED] ${role.key} assigned to ${rajani.fullName} on department ${techDept.name}.`);
  }

  // 8. Remove any TECHNICAL_HEAD assignment for Rajani (so oversight is not duplicated)
  const technicalHeadRole = await prisma.role.findFirst({
    where: { key: 'TECHNICAL_HEAD' },
  });
  if (technicalHeadRole) {
    const oldGrants = await prisma.roleAssignment.deleteMany({
      where: {
        userId: rajani.id,
        roleId: technicalHeadRole.id,
      },
    });
    if (oldGrants.count > 0) {
      console.log(`   - [REMOVED] Removed ${oldGrants.count} obsolete TECHNICAL_HEAD assignment(s) from ${rajani.fullName}.`);
    }
  }

  console.log('==> SERVICE_HEAD role setup complete.');
}

main()
  .catch((e) => {
    console.error('[ERROR] Failed to grant SERVICE_HEAD:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
