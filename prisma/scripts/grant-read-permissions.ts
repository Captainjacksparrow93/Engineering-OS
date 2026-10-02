/**
 * Additive, idempotent: gives every role that can manage commissioning or checklists the
 * matching read key, and gives SALES_HEAD both read keys. Runs on every container start.
 * It only ever inserts grants, so it never undoes what an admin changed in the app.
 */
import { PrismaClient } from '@prisma/client';
import { ALL_PERMISSIONS, PERMISSIONS } from '../../src/core/rbac/permissions';

const prisma = new PrismaClient();

const READ_FOR_MANAGE: Record<string, string> = {
  'pm.commissioning.manage': 'pm.commissioning.read',
  'pm.template.manage': 'pm.template.read',
};

async function main() {
  console.log('==> Ensuring read-only commissioning and checklist permissions...');

  for (const key of ALL_PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key },
      create: { key, module: key.split('.')[0]!, description: PERMISSIONS[key] },
      update: { description: PERMISSIONS[key] },
    });
  }
  const perms = await prisma.permission.findMany({
    where: { key: { in: [...Object.keys(READ_FOR_MANAGE), ...Object.values(READ_FOR_MANAGE)] } },
  });
  const permId = new Map(perms.map((p) => [p.key, p.id]));

  const grants: Array<{ roleId: string; permissionId: string }> = [];
  for (const [manageKey, readKey] of Object.entries(READ_FOR_MANAGE)) {
    const holders = await prisma.rolePermission.findMany({
      where: { permissionId: permId.get(manageKey)! },
      select: { roleId: true },
    });
    for (const h of holders) grants.push({ roleId: h.roleId, permissionId: permId.get(readKey)! });
  }

  const salesHead = await prisma.role.findUnique({ where: { key: 'SALES_HEAD' } });
  if (salesHead) {
    for (const readKey of Object.values(READ_FOR_MANAGE)) {
      grants.push({ roleId: salesHead.id, permissionId: permId.get(readKey)! });
    }
  }

  const res = await prisma.rolePermission.createMany({ data: grants, skipDuplicates: true });
  console.log(`   - ${res.count} new read grant(s) added.`);
}

main()
  .catch((e) => {
    console.error('[ERROR] Failed to grant read permissions:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
