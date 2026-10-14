-- CreateEnum
CREATE TYPE "ErpQualityParamKind" AS ENUM ('NUMERIC', 'TEXT', 'CHECK');

-- CreateEnum
CREATE TYPE "ErpInspectionType" AS ENUM ('INCOMING', 'IN_PROCESS', 'OUTGOING');

-- CreateEnum
CREATE TYPE "ErpInspectionResult" AS ENUM ('ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ErpNcSeverity" AS ENUM ('MINOR', 'MAJOR', 'CRITICAL');

-- CreateEnum
CREATE TYPE "ErpNcSource" AS ENUM ('INCOMING', 'IN_PROCESS', 'FINAL', 'CUSTOMER_COMPLAINT', 'INTERNAL_AUDIT', 'SUPPLIER');

-- CreateEnum
CREATE TYPE "ErpNcStatus" AS ENUM ('OPEN', 'INVESTIGATING', 'ACTION_TAKEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "ErpQualityDocCategory" AS ENUM ('DRAWING', 'PROCEDURE', 'WORK_INSTRUCTION', 'TEST_REPORT', 'FORM', 'MANUAL', 'OTHER');

-- CreateEnum
CREATE TYPE "ErpRevisionStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'RELEASED', 'REJECTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "ErpCustomerApproval" AS ENUM ('NOT_NEEDED', 'PENDING', 'APPROVED', 'APPROVED_WITH_COMMENTS', 'REJECTED');

-- CreateTable
CREATE TABLE "erp_quality_templates" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "erp_quality_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_quality_parameters" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "ErpQualityParamKind" NOT NULL DEFAULT 'CHECK',
    "minValue" DECIMAL(14,4),
    "maxValue" DECIMAL(14,4),
    "acceptanceValue" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "erp_quality_parameters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_quality_inspections" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "type" "ErpInspectionType" NOT NULL,
    "itemId" TEXT NOT NULL,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "referenceLineId" TEXT,
    "templateId" TEXT,
    "sampleSize" DECIMAL(14,3) NOT NULL DEFAULT 1,
    "inspectionDate" DATE NOT NULL,
    "status" "ErpDocStatus" NOT NULL DEFAULT 'DRAFT',
    "result" "ErpInspectionResult",
    "remarks" TEXT,
    "createdById" TEXT NOT NULL,
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "erp_quality_inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_quality_readings" (
    "id" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "parameter" TEXT NOT NULL,
    "kind" "ErpQualityParamKind" NOT NULL,
    "minValue" DECIMAL(14,4),
    "maxValue" DECIMAL(14,4),
    "acceptanceValue" TEXT,
    "value" TEXT,
    "ok" BOOLEAN,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "erp_quality_readings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_non_conformances" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "source" "ErpNcSource" NOT NULL,
    "severity" "ErpNcSeverity" NOT NULL DEFAULT 'MINOR',
    "status" "ErpNcStatus" NOT NULL DEFAULT 'OPEN',
    "itemId" TEXT,
    "supplierId" TEXT,
    "customerId" TEXT,
    "projectId" TEXT,
    "inspectionId" TEXT,
    "ownerId" TEXT NOT NULL,
    "dueDate" DATE,
    "rootCause" TEXT,
    "correction" TEXT,
    "correctiveAction" TEXT,
    "preventiveAction" TEXT,
    "closingNote" TEXT,
    "createdById" TEXT NOT NULL,
    "closedById" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "erp_non_conformances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_quality_documents" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" "ErpQualityDocCategory" NOT NULL,
    "projectId" TEXT,
    "itemId" TEXT,
    "needsCustomerApproval" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "erp_quality_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_quality_document_revisions" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "changeNote" TEXT NOT NULL,
    "status" "ErpRevisionStatus" NOT NULL DEFAULT 'DRAFT',
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "content" BYTEA NOT NULL,
    "authorId" TEXT NOT NULL,
    "approverId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvalNote" TEXT,
    "customerApproval" "ErpCustomerApproval" NOT NULL DEFAULT 'NOT_NEEDED',
    "customerRef" TEXT,
    "customerNote" TEXT,
    "customerDecidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "erp_quality_document_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "erp_quality_templates_companyId_name_key" ON "erp_quality_templates"("companyId", "name");

-- CreateIndex
CREATE INDEX "erp_quality_parameters_templateId_sortOrder_idx" ON "erp_quality_parameters"("templateId", "sortOrder");

-- CreateIndex
CREATE INDEX "erp_quality_inspections_companyId_status_idx" ON "erp_quality_inspections"("companyId", "status");

-- CreateIndex
CREATE INDEX "erp_quality_inspections_referenceType_referenceId_idx" ON "erp_quality_inspections"("referenceType", "referenceId");

-- CreateIndex
CREATE INDEX "erp_quality_inspections_referenceLineId_idx" ON "erp_quality_inspections"("referenceLineId");

-- CreateIndex
CREATE UNIQUE INDEX "erp_quality_inspections_companyId_number_key" ON "erp_quality_inspections"("companyId", "number");

-- CreateIndex
CREATE INDEX "erp_quality_readings_inspectionId_sortOrder_idx" ON "erp_quality_readings"("inspectionId", "sortOrder");

-- CreateIndex
CREATE INDEX "erp_non_conformances_companyId_status_idx" ON "erp_non_conformances"("companyId", "status");

-- CreateIndex
CREATE INDEX "erp_non_conformances_ownerId_status_idx" ON "erp_non_conformances"("ownerId", "status");

-- CreateIndex
CREATE INDEX "erp_non_conformances_companyId_projectId_idx" ON "erp_non_conformances"("companyId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "erp_non_conformances_companyId_number_key" ON "erp_non_conformances"("companyId", "number");

-- CreateIndex
CREATE INDEX "erp_quality_documents_companyId_category_idx" ON "erp_quality_documents"("companyId", "category");

-- CreateIndex
CREATE INDEX "erp_quality_documents_companyId_projectId_idx" ON "erp_quality_documents"("companyId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "erp_quality_documents_companyId_code_key" ON "erp_quality_documents"("companyId", "code");

-- CreateIndex
CREATE INDEX "erp_quality_document_revisions_documentId_status_idx" ON "erp_quality_document_revisions"("documentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "erp_quality_document_revisions_documentId_revision_key" ON "erp_quality_document_revisions"("documentId", "revision");

-- AddForeignKey
ALTER TABLE "erp_quality_parameters" ADD CONSTRAINT "erp_quality_parameters_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "erp_quality_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp_quality_readings" ADD CONSTRAINT "erp_quality_readings_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "erp_quality_inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp_quality_document_revisions" ADD CONSTRAINT "erp_quality_document_revisions_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "erp_quality_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
