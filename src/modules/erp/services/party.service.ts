import type { ErpPartyType } from '@prisma/client';
import { prisma, type Tx } from '@/core/db/prisma';
import { audit } from '@/core/audit/audit';
import { DomainError, NotFoundError } from '@/core/rbac/errors';
import type { Principal } from '@/core/rbac/types';
import { renameClientCascade } from '@/modules/project-management/services/client.service';
import { D } from '../domain/money';
import { partySchema, type PartyInput, type Raw } from '../validation';
import { manageArea, readArea, type ErpArea } from './access';
import { nextCode, SERIES } from './series';

/**
 * Customers and suppliers (ERPNext Customer / Supplier). Suppliers belong to Buying,
 * customers to Selling; Accounts can read both.
 */
const AREA: Record<ErpPartyType, ErpArea> = { SUPPLIER: 'buying', CUSTOMER: 'selling' };
export const PARTY_LABEL: Record<ErpPartyType, string> = { SUPPLIER: 'supplier', CUSTOMER: 'customer' };

async function readParties(p: Principal, kind: ErpPartyType) {
  try {
    await readArea(p, AREA[kind]);
  } catch (e) {
    await readArea(p, 'accounts').catch(() => {
      throw e;
    });
  }
}

export async function listParties(p: Principal, kind: ErpPartyType, f: { q?: string | null; includeInactive?: boolean } = {}) {
  await readParties(p, kind);
  const q = f.q?.trim();
  return prisma.erpParty.findMany({
    where: {
      companyId: p.companyId,
      kind,
      ...(f.includeInactive ? {} : { isActive: true }),
      ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { code: { contains: q, mode: 'insensitive' } }, { gstin: { contains: q, mode: 'insensitive' } }, { city: { contains: q, mode: 'insensitive' } }] } : {}),
    },
    orderBy: { name: 'asc' },
    take: 1000,
  });
}

export async function partyOptions(companyId: string, kind: ErpPartyType) {
  return prisma.erpParty.findMany({ where: { companyId, kind, isActive: true }, select: { id: true, code: true, name: true, state: true, paymentTermsDays: true }, orderBy: { name: 'asc' } });
}

export async function getParty(p: Principal, kind: ErpPartyType, partyId: string) {
  await readParties(p, kind);
  const party = await prisma.erpParty.findFirst({ where: { id: partyId, companyId: p.companyId, kind } });
  if (!party) throw new NotFoundError(`That ${PARTY_LABEL[kind]} was not found.`);
  return party;
}

/** Loads an active party for a document, inside the document's transaction. */
export async function activeParty(tx: Tx, companyId: string, kind: ErpPartyType, partyId: string) {
  const party = await tx.erpParty.findFirst({ where: { id: partyId, companyId, kind } });
  if (!party) throw new DomainError(`That ${PARTY_LABEL[kind]} was not found.`);
  if (!party.isActive) throw new DomainError(`${party.name} is switched off.`);
  return party;
}

export async function createParty(p: Principal, kind: ErpPartyType, input: Raw<PartyInput>, tx?: Tx) {
  await manageArea(p, AREA[kind]);
  const data = partySchema.parse(input);
  const work = async (t: Tx) => {
    const clash = await t.erpParty.findUnique({ where: { companyId_kind_name: { companyId: p.companyId, kind, name: data.name } }, select: { id: true } });
    if (clash) throw new DomainError(`A ${PARTY_LABEL[kind]} called ${data.name} already exists.`);
    const party = await t.erpParty.create({
      data: { companyId: p.companyId, kind, code: await nextCode(t, p.companyId, kind === 'CUSTOMER' ? SERIES.customer : SERIES.supplier), ...data },
    });
    await audit({ actorId: p.userId, module: 'erp', action: `erp.${kind.toLowerCase()}.created`, entityType: 'ErpParty', entityId: party.id, diff: { name: party.name } }, t);
    return party;
  };
  return tx ? work(tx) : prisma.$transaction(work);
}

export async function updateParty(p: Principal, kind: ErpPartyType, partyId: string, input: Raw<PartyInput>) {
  await manageArea(p, AREA[kind]);
  const data = partySchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const before = await tx.erpParty.findFirst({ where: { id: partyId, companyId: p.companyId, kind } });
    if (!before) throw new NotFoundError(`That ${PARTY_LABEL[kind]} was not found.`);
    const clash = await tx.erpParty.findUnique({ where: { companyId_kind_name: { companyId: p.companyId, kind, name: data.name } }, select: { id: true } });
    if (clash && clash.id !== partyId) throw new DomainError(`A ${PARTY_LABEL[kind]} called ${data.name} already exists.`);
    const party = await tx.erpParty.update({ where: { id: partyId }, data });
    if (before.name !== party.name && party.clientId) {
      // A customer that is a PM client keeps the same name in PM (plan 015: client name follows ERP).
      const clash = await tx.client.findFirst({ where: { companyId: p.companyId, name: party.name, id: { not: party.clientId } }, select: { id: true } });
      if (clash) throw new DomainError(`Another PM client is already called ${party.name}.`);
      await renameClientCascade(tx, p.companyId, party.clientId, party.name);
    }
    await audit({ actorId: p.userId, module: 'erp', action: `erp.${kind.toLowerCase()}.updated`, entityType: 'ErpParty', entityId: party.id, diff: { name: party.name } }, tx);
    return party;
  });
}

export async function setPartyActive(p: Principal, kind: ErpPartyType, partyId: string, isActive: boolean) {
  await manageArea(p, AREA[kind]);
  const party = await prisma.erpParty.findFirst({ where: { id: partyId, companyId: p.companyId, kind } });
  if (!party) throw new NotFoundError(`That ${PARTY_LABEL[kind]} was not found.`);
  return prisma.erpParty.update({ where: { id: partyId }, data: { isActive } });
}

/** Party balance from the ledger: positive = they owe us (customer) / we owe them (supplier). */
export async function partyBalance(companyId: string, kind: ErpPartyType, partyId: string) {
  const agg = await prisma.erpGlEntry.aggregate({ where: { companyId, partyType: kind, partyId, isCancelled: false }, _sum: { debit: true, credit: true } });
  const dr = D(agg._sum.debit);
  const cr = D(agg._sum.credit);
  return kind === 'CUSTOMER' ? dr.minus(cr) : cr.minus(dr);
}

