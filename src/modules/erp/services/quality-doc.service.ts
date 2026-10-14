import type { ErpCustomerApproval } from '@prisma/client';
import { prisma } from '@/core/db/prisma';
import { audit } from '@/core/audit/audit';
import { notify } from '@/core/notifications/notify';
import { DomainError, ForbiddenError, NotFoundError } from '@/core/rbac/errors';
import type { Principal } from '@/core/rbac/types';
import { safeFileName, sniffDocumentType } from '@/modules/hrms/domain/records';
import { qualityDocumentSchema, type QualityDocumentInput, type Raw } from '../validation';
import { assertProject, canManage, canRead, manageArea, readArea } from './access';
import { itemByCode } from './item.service';

/**
 * Controlled documents (QMS): drawings, procedures, work instructions, test reports. Each
 * upload is a numbered revision that someone other than its author approves; releasing a
 * revision supersedes the one before. Client drawings also track the customer's approval.
 * People on a PM project can read that project's documents.
 */

export const MAX_DOC_BYTES = 3 * 1024 * 1024;
export const DOC_CATEGORY_LABEL = { DRAWING: 'Drawing', PROCEDURE: 'Procedure', WORK_INSTRUCTION: 'Work instruction', TEST_REPORT: 'Test report', FORM: 'Form', MANUAL: 'Manual', OTHER: 'Other' } as const;
export const CUSTOMER_APPROVAL_LABEL: Record<ErpCustomerApproval, string> = { NOT_NEEDED: 'Not needed', PENDING: 'Waiting for customer', APPROVED: 'Approved by customer', APPROVED_WITH_COMMENTS: 'Approved with comments', REJECTED: 'Rejected by customer' };

const revisionSelect = { id: true, revision: true, changeNote: true, status: true, fileName: true, mimeType: true, sizeBytes: true, authorId: true, approverId: true, approvedAt: true, approvalNote: true, customerApproval: true, customerRef: true, customerNote: true, customerDecidedAt: true, createdAt: true } as const;

function canSee(p: Principal, doc: { projectId: string | null }) {
  return canRead(p, 'quality') || (!!doc.projectId && p.memberProjectIds.includes(doc.projectId));
}

export async function listDocuments(p: Principal, f: { category?: string | null; q?: string | null; projectId?: string | null } = {}) {
  const projectOnly = !canRead(p, 'quality');
  if (projectOnly && !f.projectId) await readArea(p, 'quality');
  const docs = await prisma.erpQualityDocument.findMany({
    where: {
      companyId: p.companyId,
      ...(f.category ? { category: f.category as never } : {}),
      ...(f.projectId ? { projectId: f.projectId } : {}),
      ...(projectOnly ? { projectId: { in: p.memberProjectIds } } : {}),
      ...(f.q ? { OR: [{ code: { contains: f.q, mode: 'insensitive' } }, { title: { contains: f.q, mode: 'insensitive' } }] } : {}),
    },
    orderBy: { code: 'asc' },
    take: 500,
    include: { revisions: { select: { id: true, revision: true, status: true, customerApproval: true }, orderBy: { revision: 'desc' } } },
  });
  return docs.map(({ revisions, ...d }) => ({ ...d, released: revisions.find((r) => r.status === 'RELEASED') ?? null, latest: revisions[0] ?? null }));
}

export async function getDocument(p: Principal, id: string) {
  const doc = await prisma.erpQualityDocument.findFirst({ where: { id, companyId: p.companyId }, include: { revisions: { select: revisionSelect, orderBy: { revision: 'desc' } } } });
  if (!doc || !canSee(p, doc)) throw new NotFoundError('Document not found.');
  const [project, item, people] = await Promise.all([
    doc.projectId ? prisma.project.findUnique({ where: { id: doc.projectId }, select: { id: true, code: true, name: true } }) : null,
    doc.itemId ? prisma.erpItem.findUnique({ where: { id: doc.itemId }, select: { id: true, code: true, name: true } }) : null,
    prisma.user.findMany({ where: { id: { in: doc.revisions.flatMap((r) => [r.authorId, r.approverId]).filter((x): x is string => !!x) } }, select: { id: true, fullName: true } }),
  ]);
  return { doc, project, item, people: new Map(people.map((u) => [u.id, u.fullName])) };
}

export async function createDocument(p: Principal, input: Raw<QualityDocumentInput>) {
  await manageArea(p, 'quality');
  const data = qualityDocumentSchema.parse(input);
  const clash = await prisma.erpQualityDocument.findUnique({ where: { companyId_code: { companyId: p.companyId, code: data.code } } });
  if (clash) throw new DomainError(`Document code ${data.code} is already used.`);
  const item = data.itemCode ? await itemByCode(p.companyId, data.itemCode) : null;
  return prisma.erpQualityDocument.create({
    data: { companyId: p.companyId, code: data.code, title: data.title, category: data.category, projectId: await assertProject(p.companyId, data.projectId), itemId: item?.id ?? null, needsCustomerApproval: data.needsCustomerApproval, createdById: p.userId },
  });
}

export interface DocFile {
  name: string;
  bytes: Uint8Array;
}

/** Uploads the next revision as a draft. PDF, JPG or PNG up to 3 MB. */
export async function uploadRevision(p: Principal, documentId: string, input: { changeNote: string }, file: DocFile | null) {
  await manageArea(p, 'quality');
  const changeNote = input.changeNote?.trim();
  if (!changeNote) throw new DomainError('Say what changed in this revision.');
  if (!file || file.bytes.length === 0) throw new DomainError('Choose the file to upload.');
  if (file.bytes.length > MAX_DOC_BYTES) throw new DomainError('The file is larger than 3 MB. Export the drawing at a lower resolution or compress the PDF.');
  const mimeType = sniffDocumentType(file.bytes);
  if (!mimeType) throw new DomainError('Upload a PDF, JPG or PNG file.');
  return prisma.$transaction(async (tx) => {
    const doc = await tx.erpQualityDocument.findFirst({ where: { id: documentId, companyId: p.companyId } });
    if (!doc) throw new NotFoundError('Document not found.');
    const pending = await tx.erpQualityDocumentRevision.findFirst({ where: { documentId, status: { in: ['DRAFT', 'PENDING_APPROVAL'] } } });
    if (pending) throw new DomainError(`Revision ${pending.revision} is still waiting. Approve or reject it first.`);
    const last = await tx.erpQualityDocumentRevision.findFirst({ where: { documentId }, orderBy: { revision: 'desc' }, select: { revision: true } });
    const rev = await tx.erpQualityDocumentRevision.create({
      data: { documentId, revision: (last?.revision ?? -1) + 1, changeNote, fileName: safeFileName(file.name), mimeType, sizeBytes: file.bytes.length, content: Buffer.from(file.bytes), authorId: p.userId, status: 'PENDING_APPROVAL' },
    });
    const approvers = await tx.user.findMany({ where: { companyId: p.companyId, status: 'ACTIVE', id: { not: p.userId }, roleAssignments: { some: { role: { key: { in: ['QUALITY_MANAGER', 'DIRECTOR'] } } } } }, select: { id: true } });
    if (approvers.length) await notify({ userIds: approvers.map((a) => a.id), title: `Approve ${doc.code} rev ${rev.revision}`, body: `${doc.title}: ${changeNote}`, link: `/erp/quality/documents/${doc.id}` }, tx);
    await audit({ actorId: p.userId, module: 'erp', action: 'erp.qdoc.revision_uploaded', entityType: 'ErpQualityDocument', entityId: doc.id, diff: { code: doc.code, revision: rev.revision } }, tx);
    return rev;
  });
}

/** Approve (release) or reject a revision. The author can't approve their own revision. */
export async function decideRevision(p: Principal, revisionId: string, approve: boolean, note?: string | null) {
  await manageArea(p, 'quality');
  return prisma.$transaction(async (tx) => {
    const rev = await tx.erpQualityDocumentRevision.findFirst({ where: { id: revisionId, document: { companyId: p.companyId } }, include: { document: true } });
    if (!rev) throw new NotFoundError('Revision not found.');
    if (rev.status !== 'PENDING_APPROVAL') throw new DomainError('This revision is not waiting for approval.');
    if (rev.authorId === p.userId) throw new ForbiddenError('Someone other than the author must approve a revision.');
    if (approve) {
      await tx.erpQualityDocumentRevision.updateMany({ where: { documentId: rev.documentId, status: 'RELEASED' }, data: { status: 'SUPERSEDED' } });
      await tx.erpQualityDocumentRevision.update({
        where: { id: revisionId },
        data: { status: 'RELEASED', approverId: p.userId, approvedAt: new Date(), approvalNote: note?.trim() || null, customerApproval: rev.document.needsCustomerApproval ? 'PENDING' : 'NOT_NEEDED' },
      });
    } else {
      if (!note?.trim()) throw new DomainError('Say why the revision is rejected.');
      await tx.erpQualityDocumentRevision.update({ where: { id: revisionId }, data: { status: 'REJECTED', approverId: p.userId, approvedAt: new Date(), approvalNote: note.trim() } });
    }
    await notify({ userIds: [rev.authorId], title: `${rev.document.code} rev ${rev.revision} ${approve ? 'released' : 'rejected'}`, body: note?.trim() || rev.document.title, link: `/erp/quality/documents/${rev.documentId}` }, tx);
    await audit({ actorId: p.userId, module: 'erp', action: approve ? 'erp.qdoc.released' : 'erp.qdoc.rejected', entityType: 'ErpQualityDocument', entityId: rev.documentId, diff: { revision: rev.revision } }, tx);
  });
}

/** Records the customer's decision on a released drawing revision. */
export async function recordCustomerApproval(p: Principal, revisionId: string, input: { decision: string; customerRef?: string | null; customerNote?: string | null }) {
  await manageArea(p, 'quality');
  const decision = input.decision as ErpCustomerApproval;
  if (!['APPROVED', 'APPROVED_WITH_COMMENTS', 'REJECTED'].includes(decision)) throw new DomainError("Pick the customer's decision.");
  const rev = await prisma.erpQualityDocumentRevision.findFirst({ where: { id: revisionId, document: { companyId: p.companyId } } });
  if (!rev) throw new NotFoundError('Revision not found.');
  if (rev.status !== 'RELEASED' || rev.customerApproval === 'NOT_NEEDED') throw new DomainError('Only a released revision sent to the customer takes their decision.');
  return prisma.erpQualityDocumentRevision.update({ where: { id: revisionId }, data: { customerApproval: decision, customerRef: input.customerRef?.trim() || null, customerNote: input.customerNote?.trim() || null, customerDecidedAt: new Date() } });
}

export async function getRevisionFile(p: Principal, revisionId: string) {
  const rev = await prisma.erpQualityDocumentRevision.findFirst({ where: { id: revisionId, document: { companyId: p.companyId } }, include: { document: { select: { projectId: true, code: true } } } });
  if (!rev || !canSee(p, rev.document)) throw new NotFoundError('File not found.');
  // Drafts and rejected revisions are for quality only.
  if (rev.status !== 'RELEASED' && rev.status !== 'SUPERSEDED' && !canManage(p, 'quality') && !canRead(p, 'quality')) throw new NotFoundError('File not found.');
  return { fileName: rev.fileName, mimeType: rev.mimeType, content: rev.content };
}

export async function setDocumentActive(p: Principal, id: string, isActive: boolean) {
  await manageArea(p, 'quality');
  const doc = await prisma.erpQualityDocument.findFirst({ where: { id, companyId: p.companyId } });
  if (!doc) throw new NotFoundError('Document not found.');
  return prisma.erpQualityDocument.update({ where: { id }, data: { isActive } });
}
