import type { ErpNcStatus } from '@prisma/client';
import { prisma } from '@/core/db/prisma';
import { audit } from '@/core/audit/audit';
import { notify } from '@/core/notifications/notify';
import { DomainError, NotFoundError } from '@/core/rbac/errors';
import type { Principal } from '@/core/rbac/types';
import { capaSchema, nonConformanceSchema, type CapaInput, type NonConformanceInput, type Raw } from '../validation';
import { assertProject, canRead, manageArea, readArea } from './access';
import { itemByCode } from './item.service';
import { nextNumber, SERIES } from './series';

/**
 * Non-conformance and CAPA (ERPNext Quality: Non Conformance, Quality Action). Raised by
 * anyone in quality, or automatically when an inspection fails; the owner records root cause,
 * correction, corrective and preventive action; quality closes it once the action is done.
 *   Open → Investigating → Action taken → Closed
 */

export const NC_STATUS_LABEL: Record<ErpNcStatus, string> = { OPEN: 'Open', INVESTIGATING: 'Investigating', ACTION_TAKEN: 'Action taken', CLOSED: 'Closed' };
export const NC_SOURCE_LABEL = { INCOMING: 'Incoming material', IN_PROCESS: 'In process', FINAL: 'Final inspection', CUSTOMER_COMPLAINT: 'Customer complaint', INTERNAL_AUDIT: 'Internal audit', SUPPLIER: 'Supplier' } as const;
const NEXT: Record<ErpNcStatus, ErpNcStatus | null> = { OPEN: 'INVESTIGATING', INVESTIGATING: 'ACTION_TAKEN', ACTION_TAKEN: 'CLOSED', CLOSED: null };

export async function listNonConformances(p: Principal, f: { status?: string | null; mine?: boolean } = {}) {
  await readArea(p, 'quality');
  const rows = await prisma.erpNonConformance.findMany({
    where: { companyId: p.companyId, ...(f.status === 'OPEN_ALL' ? { status: { not: 'CLOSED' } } : f.status ? { status: f.status as ErpNcStatus } : {}), ...(f.mine ? { ownerId: p.userId } : {}) },
    orderBy: [{ createdAt: 'desc' }],
    take: 300,
  });
  const owners = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.ownerId))] } }, select: { id: true, fullName: true } });
  const name = new Map(owners.map((o) => [o.id, o.fullName]));
  return rows.map((r) => ({ ...r, ownerName: name.get(r.ownerId) ?? '—' }));
}

export async function getNonConformance(p: Principal, id: string) {
  await readArea(p, 'quality');
  const nc = await prisma.erpNonConformance.findFirst({ where: { id, companyId: p.companyId } });
  if (!nc) throw new NotFoundError('Non-conformance not found.');
  const [item, supplier, customer, project, inspection, people] = await Promise.all([
    nc.itemId ? prisma.erpItem.findUnique({ where: { id: nc.itemId }, select: { id: true, code: true, name: true } }) : null,
    nc.supplierId ? prisma.erpParty.findUnique({ where: { id: nc.supplierId }, select: { id: true, name: true } }) : null,
    nc.customerId ? prisma.erpParty.findUnique({ where: { id: nc.customerId }, select: { id: true, name: true } }) : null,
    nc.projectId ? prisma.project.findUnique({ where: { id: nc.projectId }, select: { id: true, code: true, name: true } }) : null,
    nc.inspectionId ? prisma.erpQualityInspection.findUnique({ where: { id: nc.inspectionId }, select: { id: true, number: true } }) : null,
    prisma.user.findMany({ where: { id: { in: [nc.ownerId, nc.createdById, nc.closedById].filter((x): x is string => !!x) } }, select: { id: true, fullName: true } }),
  ]);
  return { nc, item, supplier, customer, project, inspection, people: new Map(people.map((u) => [u.id, u.fullName])) };
}

async function assertOwner(companyId: string, ownerId: string | null | undefined) {
  if (!ownerId) return null;
  const u = await prisma.user.findFirst({ where: { id: ownerId, companyId, status: 'ACTIVE' } });
  if (!u) throw new DomainError('Pick an active employee as the owner.');
  return u.id;
}

export async function raiseNonConformance(p: Principal, input: Raw<NonConformanceInput>) {
  await manageArea(p, 'quality');
  const data = nonConformanceSchema.parse(input);
  const item = data.itemCode ? await itemByCode(p.companyId, data.itemCode) : null;
  for (const [pid, kind] of [[data.supplierId, 'SUPPLIER'], [data.customerId, 'CUSTOMER']] as const) {
    if (pid && !(await prisma.erpParty.findFirst({ where: { id: pid, companyId: p.companyId, kind } }))) throw new DomainError(`That ${kind.toLowerCase()} was not found.`);
  }
  const ownerId = (await assertOwner(p.companyId, data.ownerId)) ?? p.userId;
  return prisma.$transaction(async (tx) => {
    const nc = await tx.erpNonConformance.create({
      data: {
        companyId: p.companyId,
        number: await nextNumber(tx, p.companyId, SERIES.nonConformance),
        title: data.title,
        description: data.description,
        source: data.source,
        severity: data.severity,
        itemId: item?.id ?? null,
        supplierId: data.supplierId,
        customerId: data.customerId,
        projectId: await assertProject(p.companyId, data.projectId),
        ownerId,
        dueDate: data.dueDate,
        createdById: p.userId,
      },
    });
    if (ownerId !== p.userId) await notify({ userIds: [ownerId], title: `Non-conformance ${nc.number} is yours`, body: nc.title, link: `/erp/quality/non-conformances/${nc.id}` }, tx);
    await audit({ actorId: p.userId, module: 'erp', action: 'erp.nc.raised', entityType: 'ErpNonConformance', entityId: nc.id, diff: { number: nc.number, severity: nc.severity } }, tx);
    return nc;
  });
}

/** The owner (or quality) records the investigation and actions. */
export async function updateCapa(p: Principal, id: string, input: Raw<CapaInput>) {
  const nc = await prisma.erpNonConformance.findFirst({ where: { id, companyId: p.companyId } });
  if (!nc) throw new NotFoundError('Non-conformance not found.');
  if (nc.ownerId !== p.userId) await manageArea(p, 'quality');
  else if (!canRead(p, 'quality')) await readArea(p, 'quality');
  if (nc.status === 'CLOSED') throw new DomainError(`${nc.number} is closed.`);
  const data = capaSchema.parse(input);
  const ownerId = (await assertOwner(p.companyId, data.ownerId)) ?? nc.ownerId;
  const updated = await prisma.erpNonConformance.update({ where: { id }, data: { ...data, ownerId } });
  if (ownerId !== nc.ownerId) await notify({ userIds: [ownerId], title: `Non-conformance ${nc.number} is yours`, body: nc.title, link: `/erp/quality/non-conformances/${nc.id}` });
  return updated;
}

/** Moves the record one step on. Closing needs the corrective action written and quality's sign-off. */
export async function advanceNonConformance(p: Principal, id: string, closingNote?: string | null) {
  await manageArea(p, 'quality');
  const nc = await prisma.erpNonConformance.findFirst({ where: { id, companyId: p.companyId } });
  if (!nc) throw new NotFoundError('Non-conformance not found.');
  const next = NEXT[nc.status];
  if (!next) throw new DomainError(`${nc.number} is already closed.`);
  if (next === 'ACTION_TAKEN' && !nc.rootCause) throw new DomainError('Write down the root cause first.');
  if (next === 'CLOSED' && !nc.correctiveAction) throw new DomainError('Write down the corrective action before closing.');
  const { count } = await prisma.erpNonConformance.updateMany({
    where: { id, status: nc.status },
    data: { status: next, ...(next === 'CLOSED' ? { closedById: p.userId, closedAt: new Date(), closingNote: closingNote?.trim() || null } : {}) },
  });
  if (count === 0) throw new DomainError('Someone else moved this record on. Reload the page.');
  await audit({ actorId: p.userId, module: 'erp', action: 'erp.nc.status', entityType: 'ErpNonConformance', entityId: id, diff: { from: nc.status, to: next } });
  return next;
}

export async function reopenNonConformance(p: Principal, id: string) {
  await manageArea(p, 'quality');
  const { count } = await prisma.erpNonConformance.updateMany({ where: { id, companyId: p.companyId, status: 'CLOSED' }, data: { status: 'INVESTIGATING', closedAt: null, closedById: null } });
  if (count === 0) throw new DomainError('Only a closed record can be re-opened.');
}
