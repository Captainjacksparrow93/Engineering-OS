import { prisma } from '@/core/db/prisma';
import { loadPrincipal } from '@/core/rbac/principal';
import type { Principal } from '@/core/rbac/types';
import { resetSetupCache } from './services/setup';

/**
 * Integration-test fixture: a throwaway company with its own people, so ERP tests never
 * depend on (or disturb) seed or production-copy data. `cleanup` removes every ERP row.
 */
export async function makeErpCompany(tag: string) {
  const run = `${Date.now()}`.slice(-7) + Math.floor(Math.random() * 100);
  const company = await prisma.company.create({ data: { name: `ERP Test ${tag} ${run}`, code: `T${tag}${run}`.slice(0, 20) } });

  let techDeptId: string | null = null;
  /** The TECH department PMs and engineers sit in (New project picks PMs from it). */
  async function techDepartment() {
    if (!techDeptId) techDeptId = (await prisma.department.create({ data: { companyId: company.id, name: 'Technical', code: 'TECH' } })).id;
    return techDeptId;
  }

  async function user(role: string | null, name = role ?? 'Staff', opts: { tech?: boolean } = {}): Promise<Principal> {
    const roleRow = role ? await prisma.role.findUniqueOrThrow({ where: { key: role } }) : null;
    const u = await prisma.user.create({
      data: {
        companyId: company.id,
        employeeCode: `E${run}-${Math.random().toString(36).slice(2, 7)}`,
        email: `erp-${run}-${Math.random().toString(36).slice(2, 8)}@example.test`,
        passwordHash: 'not-a-real-hash',
        fullName: `${name} ${run}`,
        ...(opts.tech ? { departmentId: await techDepartment() } : {}),
        ...(roleRow ? { roleAssignments: { create: { roleId: roleRow.id, scopeType: 'GLOBAL' } } } : {}),
      },
    });
    return (await loadPrincipal(u.id))!;
  }

  async function cleanup() {
    const companyId = company.id;
    const ids = (await prisma.user.findMany({ where: { companyId }, select: { id: true } })).map((u) => u.id);
    // Delete child tables before the tables they reference (FK order from the catalogue).
    const tables = await prisma.$queryRaw<Array<{ name: string; parent: string | null; scoped: boolean }>>`
      SELECT t.table_name AS name, ccu.table_name AS parent,
             EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_name = t.table_name AND c.column_name = 'companyId') AS scoped
      FROM information_schema.tables t
      LEFT JOIN information_schema.table_constraints tc ON tc.table_name = t.table_name AND tc.constraint_type = 'FOREIGN KEY'
      LEFT JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_name <> t.table_name
      WHERE t.table_schema = current_schema() AND t.table_name LIKE 'erp\\_%'`;
    const parents = new Map<string, Set<string>>();
    const scoped = new Set<string>();
    for (const t of tables) {
      if (!parents.has(t.name)) parents.set(t.name, new Set());
      if (t.parent?.startsWith('erp_')) parents.get(t.name)!.add(t.parent);
      if (t.scoped) scoped.add(t.name);
    }
    const order: string[] = [];
    const visit = (name: string, seen = new Set<string>()) => {
      if (order.includes(name) || seen.has(name)) return;
      seen.add(name);
      for (const [child, ps] of parents) if (ps.has(name)) visit(child, seen);
      order.push(name);
    };
    for (const name of parents.keys()) visit(name);
    for (const name of order) {
      if (scoped.has(name)) await prisma.$executeRawUnsafe(`DELETE FROM "${name}" WHERE "companyId" = $1`, companyId);
    }
    await prisma.salesItem.deleteMany({ where: { companyId } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
    await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
    const projects = await prisma.project.findMany({ where: { companyId }, select: { id: true } });
    for (const { id } of projects) {
      await prisma.taskDependency.deleteMany({ where: { predecessor: { projectId: id } } });
      await prisma.taskAssignment.deleteMany({ where: { task: { projectId: id } } });
      await prisma.task.deleteMany({ where: { projectId: id, parentId: { not: null } } });
      await prisma.task.deleteMany({ where: { projectId: id } });
      await prisma.projectMember.deleteMany({ where: { projectId: id } });
      await prisma.roleAssignment.deleteMany({ where: { scopeType: 'PROJECT', scopeId: id } });
      await prisma.notification.deleteMany({ where: { link: { contains: id } } });
      await prisma.project.delete({ where: { id } });
    }
    await prisma.client.deleteMany({ where: { companyId } });
    await prisma.salesHistoryLine.deleteMany({ where: { companyId } });
    await prisma.salesQuote.deleteMany({ where: { companyId } });
    await prisma.salesDeal.deleteMany({ where: { companyId } });
    await prisma.salesAccount.deleteMany({ where: { companyId } });
    await prisma.salesSettings.deleteMany({ where: { companyId } });
    await prisma.roleAssignment.deleteMany({ where: { userId: { in: ids } } });
    await prisma.department.updateMany({ where: { companyId }, data: { headId: null } });
    await prisma.company.delete({ where: { id: companyId } });
    resetSetupCache();
  }

  return { company, companyId: company.id, run, user, techDepartment, cleanup };
}
