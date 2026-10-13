import { prisma } from '@/core/db/prisma';
import { hasPermissionAnywhere } from '@/core/rbac/engine';
import { ForbiddenError } from '@/core/rbac/errors';
import type { PermissionKey } from '@/core/rbac/permissions';
import type { Principal } from '@/core/rbac/types';
import { ensureErpSetup } from './setup';

/** ERP areas, each guarded by `erp.<area>.read` and `erp.<area>.manage` (manage implies read). */
export type ErpArea = 'stock' | 'buying' | 'selling' | 'manufacturing' | 'quality' | 'assets' | 'accounts';

export const canRead = (p: Principal, area: ErpArea) =>
  hasPermissionAnywhere(p, `erp.${area}.read` as PermissionKey) || hasPermissionAnywhere(p, `erp.${area}.manage` as PermissionKey);
export const canManage = (p: Principal, area: ErpArea) => hasPermissionAnywhere(p, `erp.${area}.manage` as PermissionKey);

const AREA_LABEL: Record<ErpArea, string> = {
  stock: 'stock',
  buying: 'buying',
  selling: 'selling',
  manufacturing: 'manufacturing',
  quality: 'quality',
  assets: 'assets and maintenance',
  accounts: 'accounts',
};

/** Read guard for an ERP area. Also makes sure the company's ERP is set up. */
export async function readArea(p: Principal, area: ErpArea): Promise<void> {
  if (!canRead(p, area)) throw new ForbiddenError(`You don't have access to ${AREA_LABEL[area]}.`);
  await ensureErpSetup(p.companyId);
  if (area === 'selling') await ensureSellingReady(p.companyId);
}

/** Write guard for an ERP area. */
export async function manageArea(p: Principal, area: ErpArea): Promise<void> {
  if (!canManage(p, area)) throw new ForbiddenError(`You can't change ${AREA_LABEL[area]} records.`);
  await ensureErpSetup(p.companyId);
  if (area === 'selling') await ensureSellingReady(p.companyId);
}

/** Panel items (one per checklist template) exist before anyone sells; refreshed at most once a minute. */
const sellingReady = new Map<string, number>();
async function ensureSellingReady(companyId: string) {
  if (Date.now() - (sellingReady.get(companyId) ?? 0) < 60_000) return;
  const { ensurePanelItems } = await import('./selling-bridge');
  await ensurePanelItems(companyId);
  sellingReady.set(companyId, Date.now());
}

/** Names for user ids stored on ERP documents (created by, submitted by). */
export async function userNames(ids: Array<string | null | undefined>): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  if (unique.length === 0) return new Map();
  const users = await prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, fullName: true } });
  return new Map(users.map((u) => [u.id, u.fullName]));
}

/** PM projects a document can be tagged with (open projects of the company). */
export async function projectOptions(companyId: string) {
  return prisma.project.findMany({
    where: { companyId, status: { notIn: ['CLOSED', 'CANCELLED'] } },
    select: { id: true, code: true, name: true },
    orderBy: { code: 'desc' },
    take: 500,
  });
}

export async function assertProject(companyId: string, projectId: string | null | undefined): Promise<string | null> {
  if (!projectId) return null;
  const project = await prisma.project.findFirst({ where: { id: projectId, companyId }, select: { id: true } });
  if (!project) throw new ForbiddenError('That project is not in your company.');
  return project.id;
}
