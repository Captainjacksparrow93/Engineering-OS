import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { prisma } from '@/core/db/prisma';
import { loadPrincipal } from '@/core/rbac/principal';
import { DomainError, ForbiddenError, NotFoundError } from '@/core/rbac/errors';
import type { Principal } from '@/core/rbac/types';
import { makeErpCompany } from './test-fixture';
import { createItem } from './services/item.service';
import { createParty } from './services/party.service';
import { addPurchaseReceiptLine, createPurchaseReceipt, getPurchaseReceipt, submitPurchaseReceipt } from './services/purchase-receipt.service';
import { addTemplateParameter, cancelInspection, createInspection, createTemplate, getInspection, recordReadings, submitInspection } from './services/quality.service';
import { advanceNonConformance, getNonConformance, listNonConformances, updateCapa } from './services/nc.service';
import { createDocument, decideRevision, getDocument, getRevisionFile, listDocuments, recordCustomerApproval, uploadRevision } from './services/quality-doc.service';

const today = new Date().toISOString().slice(0, 10);
const pdf = (text: string) => ({ name: 'drawing.pdf', bytes: new Uint8Array(Buffer.from(`%PDF-1.4 ${text}`)) });

describe('Plan 022 phase 5: quality', () => {
  let fx: Awaited<ReturnType<typeof makeErpCompany>>;
  let qm: Principal;
  let qm2: Principal;
  let store: Principal;
  let engineer: Principal;
  let outsider: Principal;
  let templateId: string;
  let receiptId: string;
  let lineId: string;
  let projectId: string;

  beforeAll(async () => {
    fx = await makeErpCompany('QMS');
    qm = await fx.user('QUALITY_MANAGER', 'Quality');
    qm2 = await fx.user('QUALITY_MANAGER', 'Quality Two');
    store = await fx.user('STORE_KEEPER', 'Store');
    engineer = await fx.user('JUNIOR_ENGINEER', 'Engineer');
    outsider = await fx.user('JUNIOR_ENGINEER', 'Outsider');
    const project = await prisma.project.create({ data: { companyId: fx.companyId, code: `Q-${fx.run}`, name: 'Furnace panels', clientName: 'Client', managerId: qm.userId, members: { create: { userId: engineer.userId } } } });
    projectId = project.id;
    engineer = (await loadPrincipal(engineer.userId))!;
  });

  afterAll(async () => {
    await fx.cleanup();
  });

  it('builds an inspection template', async () => {
    await expect(createTemplate(store, { name: 'MCB incoming' })).rejects.toThrow(ForbiddenError);
    templateId = (await createTemplate(qm, { name: 'MCB incoming' })).id;
    await addTemplateParameter(qm, templateId, { name: 'Trip current (A)', kind: 'NUMERIC', minValue: '5.5', maxValue: '6.5' });
    await addTemplateParameter(qm, templateId, { name: 'Body free of cracks', kind: 'CHECK' });
    await expect(addTemplateParameter(qm, templateId, { name: 'Bad', kind: 'NUMERIC', minValue: '9', maxValue: '1' })).rejects.toThrow(ZodError);
  });

  it('blocks a receipt until an accepted inspection; a rejection raises a non-conformance', async () => {
    await createItem(store, { code: 'MCB-6A', name: 'MCB 6A', isStockItem: 'on', isPurchaseItem: 'on', inspectionBeforePurchase: 'on', qualityTemplateId: templateId });
    const supplier = await createParty(await fx.user('PURCHASE_MANAGER', 'Buyer'), 'SUPPLIER', { name: `L&T ${fx.run}` });
    const pr = await createPurchaseReceipt(store, supplier.id, { postingDate: today });
    receiptId = pr.id;
    await addPurchaseReceiptLine(store, pr.id, { itemCode: 'MCB-6A', qty: '50', rate: '120' });
    lineId = (await getPurchaseReceipt(store, pr.id)).pr.lines[0]!.id;
    await expect(submitPurchaseReceipt(store, pr.id)).rejects.toThrow(/needs a quality inspection/);

    const bad = await createInspection(qm, { type: 'INCOMING', itemCode: 'MCB-6A', inspectionDate: today, referenceType: 'Purchase Receipt', referenceId: pr.id, referenceLineId: lineId });
    const { qi } = await getInspection(qm, bad.id);
    expect(qi.readings.map((r) => r.parameter)).toEqual(['Trip current (A)', 'Body free of cracks']);
    await recordReadings(qm, bad.id, { [qi.readings[0]!.id]: '7.1' });
    await expect(submitInspection(qm, bad.id)).rejects.toThrow(/Body free of cracks/);
    await recordReadings(qm, bad.id, { [qi.readings[1]!.id]: 'ok' });
    expect(await submitInspection(qm, bad.id)).toBe('REJECTED');
    const ncs = await listNonConformances(qm, { status: 'OPEN' });
    expect(ncs.find((n) => n.inspectionId === bad.id)?.title).toMatch(/MCB-6A failed incoming inspection/);
    expect((await getNonConformance(qm, ncs[0]!.id)).supplier?.name).toBe(`L&T ${fx.run}`);
    await expect(submitPurchaseReceipt(store, pr.id)).rejects.toThrow(/was rejected/);
  });

  it('accepts on a passing inspection; the inspection is locked once the receipt is in', async () => {
    const good = await createInspection(qm, { type: 'INCOMING', itemCode: 'MCB-6A', inspectionDate: today, referenceType: 'Purchase Receipt', referenceId: receiptId, referenceLineId: lineId });
    const { qi } = await getInspection(qm, good.id);
    await recordReadings(qm, good.id, { [qi.readings[0]!.id]: '6.0', [qi.readings[1]!.id]: 'pass' });
    expect(await submitInspection(qm, good.id)).toBe('ACCEPTED');
    await submitPurchaseReceipt(store, receiptId);
    await expect(cancelInspection(qm, good.id)).rejects.toThrow(/Cancel it first/);
    await expect(createInspection(qm, { type: 'INCOMING', itemCode: 'MCB-6A', inspectionDate: today, referenceType: 'Purchase Receipt', referenceId: receiptId, referenceLineId: 'nope' })).rejects.toThrow(DomainError);
  });

  it('runs a non-conformance through CAPA to closed', async () => {
    const nc = (await listNonConformances(qm, { status: 'OPEN' }))[0]!;
    await advanceNonConformance(qm, nc.id);
    await expect(advanceNonConformance(qm, nc.id)).rejects.toThrow(/root cause/);
    await updateCapa(qm, nc.id, { rootCause: 'Supplier calibration drift', correction: 'Lot returned', correctiveAction: '', preventiveAction: 'Ask for calibration certificate per lot', ownerId: qm2.userId });
    await expect(updateCapa(store, nc.id, { rootCause: 'x' })).rejects.toThrow(ForbiddenError);
    await advanceNonConformance(qm, nc.id);
    await expect(advanceNonConformance(qm, nc.id)).rejects.toThrow(/corrective action/);
    await updateCapa(qm2, nc.id, { rootCause: 'Supplier calibration drift', correctiveAction: 'Supplier re-calibrated the test bench' });
    expect(await advanceNonConformance(qm, nc.id, 'Verified on next lot')).toBe('CLOSED');
    await expect(advanceNonConformance(qm, nc.id)).rejects.toThrow(/already closed/);
  });

  it('controls drawing revisions: second-person approval, supersede, customer approval, project access', async () => {
    const doc = await createDocument(qm, { code: 'dwg-ga-001', title: 'GA drawing, PLC panel', category: 'DRAWING', projectId, needsCustomerApproval: 'on' });
    await expect(createDocument(qm, { code: 'DWG-GA-001', title: 'Again', category: 'DRAWING' })).rejects.toThrow(/already used/);
    await expect(uploadRevision(qm, doc.id, { changeNote: 'First issue' }, { name: 'x.exe', bytes: new Uint8Array([1, 2, 3]) })).rejects.toThrow(/PDF, JPG or PNG/);
    const r0 = await uploadRevision(qm, doc.id, { changeNote: 'First issue' }, pdf('rev 0'));
    await expect(uploadRevision(qm, doc.id, { changeNote: 'Too soon' }, pdf('x'))).rejects.toThrow(/still waiting/);
    await expect(decideRevision(qm, r0.id, true)).rejects.toThrow(ForbiddenError);
    await decideRevision(qm2, r0.id, true);
    await recordCustomerApproval(qm, r0.id, { decision: 'APPROVED_WITH_COMMENTS', customerRef: 'TS/APP/12', customerNote: 'Add terminal numbers' });
    const r1 = await uploadRevision(qm, doc.id, { changeNote: 'Terminal numbers added' }, pdf('rev 1'));
    await expect(decideRevision(qm2, r1.id, false)).rejects.toThrow(/why/);
    await decideRevision(qm2, r1.id, true);
    const { doc: full } = await getDocument(qm, doc.id);
    expect(full.revisions.map((r) => `${r.revision}:${r.status}:${r.customerApproval}`)).toEqual(['1:RELEASED:PENDING', '0:SUPERSEDED:APPROVED_WITH_COMMENTS']);

    // A project member reads the project's drawings without quality access; others can't.
    expect((await listDocuments(engineer, { projectId })).map((d) => d.code)).toEqual(['DWG-GA-001']);
    expect((await getRevisionFile(engineer, r1.id)).mimeType).toBe('application/pdf');
    await expect(getRevisionFile(outsider, r1.id)).rejects.toThrow(NotFoundError);
    await expect(listDocuments(outsider)).rejects.toThrow(ForbiddenError);
  });
});
