import type { ErpInspectionType, Prisma } from '@prisma/client';
import { prisma, type Tx } from '@/core/db/prisma';
import { audit } from '@/core/audit/audit';
import { notify } from '@/core/notifications/notify';
import { DomainError, NotFoundError } from '@/core/rbac/errors';
import type { Principal } from '@/core/rbac/types';
import { acceptanceText, evaluateReading } from '../domain/quality';
import {
  inspectionSchema,
  qualityParameterSchema,
  qualityTemplateSchema,
  readingSchema,
  type InspectionInput,
  type QualityParameterInput,
  type Raw,
} from '../validation';
import { manageArea, readArea } from './access';
import { itemByCode } from './item.service';
import { nextNumber, SERIES } from './series';

/**
 * Quality Inspection (ERPNext): incoming on purchase receipts, in-process on work orders,
 * outgoing on deliveries. Readings come from the item's template; the result is Accepted only
 * when every reading passes. Items flagged "inspection before purchase / delivery" can't be
 * received / delivered without an accepted inspection. A rejection raises a non-conformance.
 */

export const INSPECTION_LABEL: Record<ErpInspectionType, string> = { INCOMING: 'Incoming', IN_PROCESS: 'In-process', OUTGOING: 'Outgoing' };

// ---------------------------------------------------------------- templates

export async function listTemplates(p: Principal) {
  await readArea(p, 'quality');
  return prisma.erpQualityTemplate.findMany({ where: { companyId: p.companyId }, orderBy: { name: 'asc' }, include: { parameters: { orderBy: { sortOrder: 'asc' } } } });
}

export async function templateOptions(companyId: string) {
  return prisma.erpQualityTemplate.findMany({ where: { companyId, isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
}

export async function createTemplate(p: Principal, input: { name: string }) {
  await manageArea(p, 'quality');
  const { name } = qualityTemplateSchema.parse(input);
  const clash = await prisma.erpQualityTemplate.findUnique({ where: { companyId_name: { companyId: p.companyId, name } } });
  if (clash) throw new DomainError(`A template called ${name} already exists.`);
  return prisma.erpQualityTemplate.create({ data: { companyId: p.companyId, name } });
}

export async function addTemplateParameter(p: Principal, templateId: string, input: Raw<QualityParameterInput>) {
  await manageArea(p, 'quality');
  const data = qualityParameterSchema.parse(input);
  const t = await prisma.erpQualityTemplate.findFirst({ where: { id: templateId, companyId: p.companyId } });
  if (!t) throw new NotFoundError('Template not found.');
  const count = await prisma.erpQualityParameter.count({ where: { templateId } });
  return prisma.erpQualityParameter.create({ data: { templateId, ...data, sortOrder: count } });
}

export async function removeTemplateParameter(p: Principal, templateId: string, parameterId: string) {
  await manageArea(p, 'quality');
  const t = await prisma.erpQualityTemplate.findFirst({ where: { id: templateId, companyId: p.companyId } });
  if (!t) throw new NotFoundError('Template not found.');
  await prisma.erpQualityParameter.deleteMany({ where: { id: parameterId, templateId } });
}

// ---------------------------------------------------------------- inspections

export async function listInspections(p: Principal, f: { status?: string | null; type?: string | null } = {}) {
  await readArea(p, 'quality');
  const rows = await prisma.erpQualityInspection.findMany({
    where: { companyId: p.companyId, ...(f.status ? { status: f.status as never } : {}), ...(f.type ? { type: f.type as never } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 300,
  });
  const items = await prisma.erpItem.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.itemId))] } }, select: { id: true, code: true, name: true } });
  const byId = new Map(items.map((i) => [i.id, i]));
  return rows.map((r) => ({ ...r, item: byId.get(r.itemId) }));
}

export async function getInspection(p: Principal, id: string) {
  await readArea(p, 'quality');
  const qi = await prisma.erpQualityInspection.findFirst({ where: { id, companyId: p.companyId }, include: { readings: { orderBy: { sortOrder: 'asc' } } } });
  if (!qi) throw new NotFoundError('Inspection not found.');
  const item = await prisma.erpItem.findUniqueOrThrow({ where: { id: qi.itemId }, select: { id: true, code: true, name: true, uom: true } });
  const nc = await prisma.erpNonConformance.findFirst({ where: { inspectionId: id }, select: { id: true, number: true, status: true } });
  return { qi, item, nc, acceptance: new Map(qi.readings.map((r) => [r.id, acceptanceText(r)])) };
}

/** The document line the inspection is for, checked against the item and company. */
async function referenceFor(tx: Tx, companyId: string, data: { referenceType?: string | null; referenceId?: string | null; referenceLineId?: string | null }, itemId: string) {
  if (!data.referenceType || !data.referenceId) return { referenceType: null, referenceId: null, referenceLineId: null };
  if (data.referenceType === 'Purchase Receipt') {
    const line = data.referenceLineId ? await tx.erpPurchaseReceiptLine.findFirst({ where: { id: data.referenceLineId, receiptId: data.referenceId, receipt: { companyId } } }) : null;
    if (!line || line.itemId !== itemId) throw new DomainError('That receipt line was not found for this item.');
  } else if (data.referenceType === 'Delivery Note') {
    const line = data.referenceLineId ? await tx.erpDeliveryNoteLine.findFirst({ where: { id: data.referenceLineId, deliveryNoteId: data.referenceId, deliveryNote: { companyId } } }) : null;
    if (!line || line.itemId !== itemId) throw new DomainError('That delivery line was not found for this item.');
  } else {
    const wo = await tx.erpWorkOrder.findFirst({ where: { id: data.referenceId, companyId } });
    if (!wo) throw new DomainError('That work order was not found.');
  }
  return { referenceType: data.referenceType, referenceId: data.referenceId, referenceLineId: data.referenceLineId ?? null };
}

export async function createInspection(p: Principal, input: Raw<InspectionInput>) {
  await manageArea(p, 'quality');
  const data = inspectionSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const item = await itemByCode(p.companyId, data.itemCode, tx);
    const ref = await referenceFor(tx, p.companyId, data, item.id);
    const template = item.qualityTemplateId ? await tx.erpQualityTemplate.findUnique({ where: { id: item.qualityTemplateId }, include: { parameters: { orderBy: { sortOrder: 'asc' } } } }) : null;
    const qi = await tx.erpQualityInspection.create({
      data: {
        companyId: p.companyId,
        number: await nextNumber(tx, p.companyId, SERIES.inspection),
        type: data.type,
        itemId: item.id,
        ...ref,
        templateId: template?.id ?? null,
        sampleSize: data.sampleSize ?? 1,
        inspectionDate: data.inspectionDate,
        remarks: data.remarks,
        createdById: p.userId,
        readings: template ? { create: template.parameters.map((x, n) => ({ parameter: x.name, kind: x.kind, minValue: x.minValue, maxValue: x.maxValue, acceptanceValue: x.acceptanceValue, sortOrder: n })) } : undefined,
      },
    });
    await audit({ actorId: p.userId, module: 'erp', action: 'erp.inspection.created', entityType: 'ErpQualityInspection', entityId: qi.id, diff: { number: qi.number } }, tx);
    return qi;
  });
}

async function loadDraft(tx: Tx, p: Principal, id: string) {
  const qi = await tx.erpQualityInspection.findFirst({ where: { id, companyId: p.companyId } });
  if (!qi) throw new NotFoundError('Inspection not found.');
  if (qi.status !== 'DRAFT') throw new DomainError(`${qi.number} is ${qi.status.toLowerCase()} and can't be changed.`);
  return qi;
}

/** Records values; each reading is judged as it is entered. Keys are reading ids. */
export async function recordReadings(p: Principal, id: string, values: Record<string, string>) {
  await manageArea(p, 'quality');
  return prisma.$transaction(async (tx) => {
    await loadDraft(tx, p, id);
    const readings = await tx.erpQualityReading.findMany({ where: { inspectionId: id } });
    for (const r of readings) {
      if (!(r.id in values)) continue;
      const value = values[r.id]?.trim() || null;
      await tx.erpQualityReading.update({ where: { id: r.id }, data: { value, ok: evaluateReading(r, value) } });
    }
  });
}

/** An extra pass/fail check not on the template. */
export async function addReading(p: Principal, id: string, input: { parameter: string; value?: string | null }) {
  await manageArea(p, 'quality');
  const data = readingSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    await loadDraft(tx, p, id);
    const count = await tx.erpQualityReading.count({ where: { inspectionId: id } });
    const spec = { kind: 'CHECK' as const, minValue: null, maxValue: null, acceptanceValue: null };
    await tx.erpQualityReading.create({ data: { inspectionId: id, parameter: data.parameter, kind: 'CHECK', value: data.value, ok: evaluateReading(spec, data.value), sortOrder: count } });
  });
}

export async function deleteInspection(p: Principal, id: string) {
  await manageArea(p, 'quality');
  return prisma.$transaction(async (tx) => {
    await loadDraft(tx, p, id);
    await tx.erpQualityInspection.delete({ where: { id } });
  });
}

/** Submit: Accepted when every reading passes, Rejected otherwise (and a non-conformance is raised). */
export async function submitInspection(p: Principal, id: string) {
  await manageArea(p, 'quality');
  return prisma.$transaction(async (tx) => {
    const qi = await tx.erpQualityInspection.findFirst({ where: { id, companyId: p.companyId }, include: { readings: true } });
    if (!qi) throw new NotFoundError('Inspection not found.');
    if (qi.readings.length === 0) throw new DomainError('Add at least one reading.');
    const missing = qi.readings.find((r) => r.ok === null);
    if (missing) throw new DomainError(`Record a valid value for "${missing.parameter}".`);
    const result = qi.readings.every((r) => r.ok) ? 'ACCEPTED' : 'REJECTED';
    const { count } = await tx.erpQualityInspection.updateMany({ where: { id, status: 'DRAFT' }, data: { status: 'SUBMITTED', result, submittedById: p.userId, submittedAt: new Date() } });
    if (count === 0) throw new DomainError(`${qi.number} was already submitted or cancelled.`);
    if (qi.referenceLineId && qi.referenceType === 'Purchase Receipt') await tx.erpPurchaseReceiptLine.update({ where: { id: qi.referenceLineId }, data: { qualityInspectionId: id } });
    if (qi.referenceLineId && qi.referenceType === 'Delivery Note') await tx.erpDeliveryNoteLine.update({ where: { id: qi.referenceLineId }, data: { qualityInspectionId: id } });
    if (result === 'REJECTED') {
      const item = await tx.erpItem.findUniqueOrThrow({ where: { id: qi.itemId }, select: { code: true, name: true } });
      const failed = qi.readings.filter((r) => !r.ok).map((r) => `${r.parameter}: ${r.value}`);
      const supplierId = qi.referenceType === 'Purchase Receipt' && qi.referenceId ? (await tx.erpPurchaseReceipt.findUnique({ where: { id: qi.referenceId }, select: { supplierId: true } }))?.supplierId ?? null : null;
      const wo = qi.referenceType === 'Work Order' && qi.referenceId ? await tx.erpWorkOrder.findUnique({ where: { id: qi.referenceId }, select: { projectId: true } }) : null;
      const nc = await tx.erpNonConformance.create({
        data: {
          companyId: p.companyId,
          number: await nextNumber(tx, p.companyId, SERIES.nonConformance),
          title: `${item.code} failed ${INSPECTION_LABEL[qi.type].toLowerCase()} inspection`,
          description: `${qi.number}: ${failed.join('; ')}`,
          source: qi.type === 'INCOMING' ? 'INCOMING' : qi.type === 'IN_PROCESS' ? 'IN_PROCESS' : 'FINAL',
          severity: 'MAJOR',
          itemId: qi.itemId,
          supplierId,
          projectId: wo?.projectId ?? null,
          inspectionId: id,
          ownerId: p.userId,
          createdById: p.userId,
        },
      });
      await audit({ actorId: p.userId, module: 'erp', action: 'erp.nc.raised', entityType: 'ErpNonConformance', entityId: nc.id, diff: { number: nc.number, from: qi.number } }, tx);
    }
    await audit({ actorId: p.userId, module: 'erp', action: 'erp.inspection.submitted', entityType: 'ErpQualityInspection', entityId: id, diff: { number: qi.number, result } }, tx);
    return result;
  });
}

export async function cancelInspection(p: Principal, id: string) {
  await manageArea(p, 'quality');
  return prisma.$transaction(async (tx) => {
    const qi = await tx.erpQualityInspection.findFirst({ where: { id, companyId: p.companyId } });
    if (!qi) throw new NotFoundError('Inspection not found.');
    const usedBy =
      (qi.referenceType === 'Purchase Receipt' && qi.referenceId && (await tx.erpPurchaseReceipt.findFirst({ where: { id: qi.referenceId, status: 'SUBMITTED' } }))) ||
      (qi.referenceType === 'Delivery Note' && qi.referenceId && (await tx.erpDeliveryNote.findFirst({ where: { id: qi.referenceId, status: 'SUBMITTED' } })));
    if (usedBy) throw new DomainError(`${usedBy.number} was submitted on this inspection. Cancel it first.`);
    const { count } = await tx.erpQualityInspection.updateMany({ where: { id, status: 'SUBMITTED' }, data: { status: 'CANCELLED', cancelledById: p.userId, cancelledAt: new Date() } });
    if (count === 0) throw new DomainError('Only a submitted inspection can be cancelled.');
    if (qi.referenceLineId && qi.referenceType === 'Purchase Receipt') await tx.erpPurchaseReceiptLine.updateMany({ where: { id: qi.referenceLineId, qualityInspectionId: id }, data: { qualityInspectionId: null } });
    if (qi.referenceLineId && qi.referenceType === 'Delivery Note') await tx.erpDeliveryNoteLine.updateMany({ where: { id: qi.referenceLineId, qualityInspectionId: id }, data: { qualityInspectionId: null } });
  });
}

/**
 * The gate a receipt / delivery passes on submit: every line whose item needs inspection must
 * carry an accepted, submitted inspection.
 */
export async function assertInspected(tx: Tx, kind: 'purchase' | 'delivery', lines: Array<{ itemId: string; qualityInspectionId: string | null; qty?: Prisma.Decimal.Value }>) {
  const flag = kind === 'purchase' ? 'inspectionBeforePurchase' : 'inspectionBeforeDelivery';
  const needed = await tx.erpItem.findMany({ where: { id: { in: lines.map((l) => l.itemId) }, [flag]: true }, select: { id: true, code: true } });
  if (needed.length === 0) return;
  const code = new Map(needed.map((i) => [i.id, i.code]));
  for (const line of lines.filter((l) => code.has(l.itemId))) {
    const qi = line.qualityInspectionId ? await tx.erpQualityInspection.findUnique({ where: { id: line.qualityInspectionId } }) : null;
    if (!qi || qi.status !== 'SUBMITTED') throw new DomainError(`${code.get(line.itemId)} needs a quality inspection before it can be ${kind === 'purchase' ? 'received' : 'delivered'}.`);
    if (qi.result !== 'ACCEPTED') throw new DomainError(`${code.get(line.itemId)} was rejected by ${qi.number}. ${kind === 'purchase' ? 'Book it as rejected quantity' : 'Rework it'} and inspect again.`);
  }
}

/** Inspections waiting on a receipt or delivery, for its page. */
export async function inspectionsFor(referenceType: string, referenceId: string) {
  return prisma.erpQualityInspection.findMany({ where: { referenceType, referenceId, status: { not: 'CANCELLED' } }, select: { id: true, number: true, status: true, result: true, referenceLineId: true } });
}

export async function notifyQuality(companyId: string, title: string, body: string, link: string, tx: Tx = prisma) {
  const users = await tx.user.findMany({ where: { companyId, status: 'ACTIVE', roleAssignments: { some: { role: { key: 'QUALITY_MANAGER' } } } }, select: { id: true } });
  if (users.length) await notify({ userIds: users.map((u) => u.id), title, body, link }, tx);
}
