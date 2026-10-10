import type { Prisma } from '@prisma/client';
import { prisma, type Tx } from '@/core/db/prisma';
import { hasPermissionAnywhere } from '@/core/rbac/engine';
import { ForbiddenError, NotFoundError } from '@/core/rbac/errors';
import { assertCan } from '@/core/rbac/guard';
import type { Principal } from '@/core/rbac/types';

/**
 * Sales visibility. A salesperson sees only the deals they own; `sales.deal.read.all`
 * (Sales Head, Director) sees every deal. Quotes follow their deal. Accounts and the
 * catalogue are shared by everyone in Sales.
 */
export const seesAllDeals = (principal: Principal) => hasPermissionAnywhere(principal, 'sales.deal.read.all');

export function assertSalesRead(principal: Principal) {
  assertCan(principal, 'sales.deal.read');
}

export function dealVisibilityWhere(principal: Principal): Prisma.SalesDealWhereInput {
  return seesAllDeals(principal) ? { companyId: principal.companyId } : { companyId: principal.companyId, ownerId: principal.userId };
}

/** A deal the principal may see, or NotFound (never "forbidden": that would confirm it exists). */
export async function loadVisibleDeal(principal: Principal, dealId: string, tx: Tx = prisma) {
  assertSalesRead(principal);
  const deal = await tx.salesDeal.findFirst({ where: { id: dealId, ...dealVisibilityWhere(principal) } });
  if (!deal) throw new NotFoundError('Deal not found.');
  return deal;
}

export function assertCanEditDeal(principal: Principal, deal: { ownerId: string }) {
  assertCan(principal, 'sales.deal.manage');
  if (deal.ownerId !== principal.userId && !seesAllDeals(principal)) {
    throw new ForbiddenError('Only the deal owner or the Sales Head can change this deal.');
  }
}

export async function loadVisibleQuote(principal: Principal, quoteId: string, tx: Tx = prisma) {
  assertSalesRead(principal);
  const quote = await tx.salesQuote.findFirst({
    where: { id: quoteId, companyId: principal.companyId, deal: dealVisibilityWhere(principal) },
    include: { deal: true },
  });
  if (!quote) throw new NotFoundError('Quote not found.');
  return quote;
}

export const num = (d: Prisma.Decimal | number | null | undefined): number => (d === null || d === undefined ? 0 : Number(d));
export const numOrNull = (d: Prisma.Decimal | number | null | undefined): number | null => (d === null || d === undefined ? null : Number(d));
