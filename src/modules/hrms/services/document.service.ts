import { prisma } from '@/core/db/prisma';
import { audit } from '@/core/audit/audit';
import { notify } from '@/core/notifications/notify';
import { can } from '@/core/rbac/engine';
import { DomainError, ForbiddenError, NotFoundError } from '@/core/rbac/errors';
import type { Principal } from '@/core/rbac/types';
import { DOCUMENT_CATEGORY_LABEL } from '../domain/labels';
import { safeFileName, sniffDocumentType } from '../domain/records';
import { documentSchema, MAX_DOCUMENT_BYTES, type DocumentInput, type UploadedFile } from '../validation';
import { documentListSelect } from './employee.service';

/**
 * HR documents (plan 020, phase 1): employee files and company policies, stored in Postgres
 * so the daily database backup covers them.
 *
 * - Uploading the same category + title again adds a new version; older versions stay.
 * - HR (`hr.employee.manage`) uploads and removes. An employee downloads their own files
 *   unless HR marked one HR-only. Everyone reads company policies (`userId` null).
 */

const hasGlobalManage = (principal: Principal) =>
  principal.grants.some((g) => g.permission === 'hr.employee.manage' && g.scopeType === 'GLOBAL');

function canManageFor(principal: Principal, departmentId: string | null) {
  return hasGlobalManage(principal) || (!!departmentId && can(principal, 'hr.employee.manage', { departmentId }));
}

export async function uploadDocument(principal: Principal, input: DocumentInput, file: UploadedFile | null) {
  const data = documentSchema.parse(input);
  let employee: { id: string; departmentId: string | null } | null = null;
  if (data.userId) {
    employee = await prisma.user.findFirst({ where: { id: data.userId, companyId: principal.companyId }, select: { id: true, departmentId: true } });
    if (!employee) throw new NotFoundError('Employee not found.');
    if (!canManageFor(principal, employee.departmentId)) throw new ForbiddenError('Only HR can upload employee documents.');
  } else if (!hasGlobalManage(principal)) {
    throw new ForbiddenError('Only HR can publish company policies.');
  }

  if (!file || file.bytes.length === 0) throw new DomainError('Choose a file to upload.');
  if (file.bytes.length > MAX_DOCUMENT_BYTES) throw new DomainError('The file is larger than 3 MB. Scan at a lower resolution or compress the PDF.');
  const mimeType = sniffDocumentType(file.bytes);
  if (!mimeType) throw new DomainError('Upload a PDF, JPG or PNG file.');

  const userId = employee?.id ?? null;
  return prisma.$transaction(async (tx) => {
    const current = await tx.hrDocument.findFirst({
      where: { companyId: principal.companyId, userId, category: data.category, title: { equals: data.title, mode: 'insensitive' }, supersededAt: null },
      select: { id: true, version: true, title: true },
    });
    if (current) await tx.hrDocument.update({ where: { id: current.id }, data: { supersededAt: new Date() } });
    const doc = await tx.hrDocument.create({
      data: {
        companyId: principal.companyId,
        userId,
        category: userId ? data.category : 'POLICY',
        // A new version keeps the name it was first filed under.
        title: current?.title ?? data.title,
        fileName: safeFileName(file.name),
        mimeType,
        sizeBytes: file.bytes.length,
        content: Buffer.from(file.bytes),
        version: (current?.version ?? 0) + 1,
        visibleToEmployee: userId ? data.visibleToEmployee : true,
        uploadedById: principal.userId,
      },
      select: documentListSelect,
    });
    if (userId && doc.visibleToEmployee && userId !== principal.userId) {
      await notify(
        { userIds: [userId], title: `New document: ${doc.title}`, body: `HR added your ${DOCUMENT_CATEGORY_LABEL[doc.category].toLowerCase()}${doc.version > 1 ? ` (version ${doc.version})` : ''}.`, link: '/hrms/me' },
        tx,
      );
    }
    await audit(
      { actorId: principal.userId, module: 'hr', action: userId ? 'hr.document.uploaded' : 'hr.policy.published', entityType: 'HrDocument', entityId: doc.id, diff: { userId, category: doc.category, title: doc.title, version: doc.version } },
      tx,
    );
    return doc;
  });
}

/** One version, with its bytes, if the principal may open it. */
export async function getDocumentFile(principal: Principal, documentId: string) {
  const doc = await prisma.hrDocument.findFirst({
    where: { id: documentId, companyId: principal.companyId },
    include: { user: { select: { id: true, departmentId: true } } },
  });
  if (!doc) throw new NotFoundError('Document not found.');
  const allowed =
    doc.userId === null ||
    canManageFor(principal, doc.user?.departmentId ?? null) ||
    (doc.userId === principal.userId && doc.visibleToEmployee);
  if (!allowed) throw new NotFoundError('Document not found.');
  return { fileName: doc.fileName, mimeType: doc.mimeType, content: doc.content };
}

/** Removes one version. Removing the current one brings back the version before it. */
export async function removeDocument(principal: Principal, documentId: string) {
  const doc = await prisma.hrDocument.findFirst({
    where: { id: documentId, companyId: principal.companyId },
    select: { id: true, userId: true, category: true, title: true, version: true, supersededAt: true, user: { select: { departmentId: true } } },
  });
  if (!doc) throw new NotFoundError('Document not found.');
  const allowed = doc.userId ? canManageFor(principal, doc.user?.departmentId ?? null) : hasGlobalManage(principal);
  if (!allowed) throw new ForbiddenError('Only HR can remove documents.');
  await prisma.$transaction(async (tx) => {
    await tx.hrDocument.delete({ where: { id: doc.id } });
    if (!doc.supersededAt) {
      const previous = await tx.hrDocument.findFirst({
        where: { companyId: principal.companyId, userId: doc.userId, category: doc.category, title: { equals: doc.title, mode: 'insensitive' } },
        orderBy: { version: 'desc' },
        select: { id: true },
      });
      if (previous) await tx.hrDocument.update({ where: { id: previous.id }, data: { supersededAt: null } });
    }
    await audit({ actorId: principal.userId, module: 'hr', action: 'hr.document.removed', entityType: 'HrDocument', entityId: doc.id, diff: { userId: doc.userId, title: doc.title, version: doc.version } }, tx);
  });
}

/** Company policies: everyone reads them; the newest version of each first, then older ones. */
export async function listPolicies(principal: Principal) {
  return prisma.hrDocument.findMany({
    where: { companyId: principal.companyId, userId: null },
    select: documentListSelect,
    orderBy: [{ title: 'asc' }, { version: 'desc' }],
  });
}
