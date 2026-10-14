-- CreateEnum
CREATE TYPE "ErpPaymentType" AS ENUM ('RECEIVE', 'PAY', 'INTERNAL_TRANSFER');

-- CreateEnum
CREATE TYPE "ErpJournalType" AS ENUM ('JOURNAL', 'OPENING');

-- CreateTable
CREATE TABLE "erp_payments" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" "ErpDocStatus" NOT NULL DEFAULT 'DRAFT',
    "paymentType" "ErpPaymentType" NOT NULL,
    "postingDate" DATE NOT NULL,
    "partyType" "ErpPartyType",
    "partyId" TEXT,
    "accountId" TEXT NOT NULL,
    "transferToAccountId" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "unallocatedAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "modeOfPayment" TEXT,
    "referenceNo" TEXT,
    "referenceDate" DATE,
    "clearanceDate" DATE,
    "projectId" TEXT,
    "remarks" TEXT,
    "createdById" TEXT NOT NULL,
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "erp_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_payment_allocations" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "invoiceType" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "isReconciliation" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "erp_payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_journal_entries" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" "ErpDocStatus" NOT NULL DEFAULT 'DRAFT',
    "entryType" "ErpJournalType" NOT NULL DEFAULT 'JOURNAL',
    "postingDate" DATE NOT NULL,
    "referenceNo" TEXT,
    "referenceDate" DATE,
    "clearanceDate" DATE,
    "remarks" TEXT,
    "totalDebit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalCredit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "erp_journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_journal_lines" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "partyType" "ErpPartyType",
    "partyId" TEXT,
    "projectId" TEXT,
    "debit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "againstType" TEXT,
    "againstId" TEXT,
    "remarks" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "erp_journal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_period_closings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "fiscalYear" TEXT NOT NULL,
    "yearStart" DATE NOT NULL,
    "yearEnd" DATE NOT NULL,
    "netProfit" DECIMAL(18,2) NOT NULL,
    "status" "ErpDocStatus" NOT NULL DEFAULT 'SUBMITTED',
    "remarks" TEXT,
    "createdById" TEXT NOT NULL,
    "cancelledById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "erp_period_closings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "erp_payments_companyId_status_idx" ON "erp_payments"("companyId", "status");

-- CreateIndex
CREATE INDEX "erp_payments_companyId_partyType_partyId_idx" ON "erp_payments"("companyId", "partyType", "partyId");

-- CreateIndex
CREATE INDEX "erp_payments_accountId_postingDate_idx" ON "erp_payments"("accountId", "postingDate");

-- CreateIndex
CREATE UNIQUE INDEX "erp_payments_companyId_number_key" ON "erp_payments"("companyId", "number");

-- CreateIndex
CREATE INDEX "erp_payment_allocations_paymentId_idx" ON "erp_payment_allocations"("paymentId");

-- CreateIndex
CREATE INDEX "erp_payment_allocations_invoiceType_invoiceId_idx" ON "erp_payment_allocations"("invoiceType", "invoiceId");

-- CreateIndex
CREATE INDEX "erp_journal_entries_companyId_status_idx" ON "erp_journal_entries"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "erp_journal_entries_companyId_number_key" ON "erp_journal_entries"("companyId", "number");

-- CreateIndex
CREATE INDEX "erp_journal_lines_entryId_sortOrder_idx" ON "erp_journal_lines"("entryId", "sortOrder");

-- CreateIndex
CREATE INDEX "erp_journal_lines_againstType_againstId_idx" ON "erp_journal_lines"("againstType", "againstId");

-- CreateIndex
CREATE INDEX "erp_period_closings_companyId_status_yearEnd_idx" ON "erp_period_closings"("companyId", "status", "yearEnd");

-- AddForeignKey
ALTER TABLE "erp_payment_allocations" ADD CONSTRAINT "erp_payment_allocations_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "erp_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp_journal_lines" ADD CONSTRAINT "erp_journal_lines_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "erp_journal_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
