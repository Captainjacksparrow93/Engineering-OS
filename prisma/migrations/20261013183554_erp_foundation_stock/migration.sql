-- CreateEnum
CREATE TYPE "ErpDocStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ErpRootType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "ErpPartyType" AS ENUM ('CUSTOMER', 'SUPPLIER');

-- CreateEnum
CREATE TYPE "ErpStockPurpose" AS ENUM ('MATERIAL_RECEIPT', 'MATERIAL_ISSUE', 'MATERIAL_TRANSFER', 'TRANSFER_FOR_MANUFACTURE', 'MANUFACTURE');

-- CreateEnum
CREATE TYPE "ErpReconPurpose" AS ENUM ('OPENING', 'ADJUSTMENT');

-- CreateTable
CREATE TABLE "erp_settings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "companyState" TEXT,
    "defaultGstRate" DECIMAL(5,2) NOT NULL DEFAULT 18,
    "allowNegativeStock" BOOLEAN NOT NULL DEFAULT false,
    "booksClosedUpTo" DATE,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "erp_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_series" (
    "companyId" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "current" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "erp_series_pkey" PRIMARY KEY ("companyId","prefix")
);

-- CreateTable
CREATE TABLE "erp_accounts" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rootType" "ErpRootType" NOT NULL,
    "parentId" TEXT,
    "isGroup" BOOLEAN NOT NULL DEFAULT false,
    "systemKey" TEXT,
    "accountType" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "erp_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_gl_entries" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "postingDate" DATE NOT NULL,
    "accountId" TEXT NOT NULL,
    "debit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "partyType" "ErpPartyType",
    "partyId" TEXT,
    "projectId" TEXT,
    "voucherType" TEXT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "voucherNo" TEXT NOT NULL,
    "againstType" TEXT,
    "againstId" TEXT,
    "remarks" TEXT,
    "isCancelled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "erp_gl_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_warehouses" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "systemKey" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "erp_warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_items" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "itemGroup" TEXT NOT NULL DEFAULT 'General',
    "uom" TEXT NOT NULL DEFAULT 'Nos',
    "make" TEXT,
    "makerPartNo" TEXT,
    "hsnCode" TEXT,
    "gstRate" DECIMAL(5,2) NOT NULL DEFAULT 18,
    "isStockItem" BOOLEAN NOT NULL DEFAULT true,
    "isPurchaseItem" BOOLEAN NOT NULL DEFAULT true,
    "isSalesItem" BOOLEAN NOT NULL DEFAULT true,
    "standardRate" DECIMAL(14,2),
    "lastPurchaseRate" DECIMAL(14,2),
    "reorderLevel" DECIMAL(14,3),
    "reorderQty" DECIMAL(14,3),
    "leadTimeDays" INTEGER,
    "defaultWarehouseId" TEXT,
    "expenseAccountId" TEXT,
    "incomeAccountId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "erp_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_bins" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "actualQty" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "valuationRate" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "stockValue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "reservedQty" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "orderedQty" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "requestedQty" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "plannedQty" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "erp_bins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_stock_ledger" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "postingDate" DATE NOT NULL,
    "qtyChange" DECIMAL(18,3) NOT NULL,
    "rate" DECIMAL(18,4) NOT NULL,
    "valueChange" DECIMAL(18,2) NOT NULL,
    "qtyAfter" DECIMAL(18,3) NOT NULL,
    "valuationRate" DECIMAL(18,4) NOT NULL,
    "stockValue" DECIMAL(18,2) NOT NULL,
    "voucherType" TEXT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "voucherNo" TEXT NOT NULL,
    "voucherLineId" TEXT,
    "projectId" TEXT,
    "isCancelled" BOOLEAN NOT NULL DEFAULT false,
    "seq" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "erp_stock_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_stock_entries" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "purpose" "ErpStockPurpose" NOT NULL,
    "status" "ErpDocStatus" NOT NULL DEFAULT 'DRAFT',
    "postingDate" DATE NOT NULL,
    "fromWarehouseId" TEXT,
    "toWarehouseId" TEXT,
    "projectId" TEXT,
    "workOrderId" TEXT,
    "materialRequestId" TEXT,
    "remarks" TEXT,
    "totalValue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "additionalCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "erp_stock_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_stock_entry_lines" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "qty" DECIMAL(18,3) NOT NULL,
    "fromWarehouseId" TEXT,
    "toWarehouseId" TEXT,
    "rate" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "isFinishedGood" BOOLEAN NOT NULL DEFAULT false,
    "materialRequestLineId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "erp_stock_entry_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_stock_reconciliations" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "purpose" "ErpReconPurpose" NOT NULL DEFAULT 'ADJUSTMENT',
    "status" "ErpDocStatus" NOT NULL DEFAULT 'DRAFT',
    "postingDate" DATE NOT NULL,
    "remarks" TEXT,
    "differenceValue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "erp_stock_reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_stock_reconciliation_lines" (
    "id" TEXT NOT NULL,
    "reconciliationId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "qty" DECIMAL(18,3) NOT NULL,
    "valuationRate" DECIMAL(18,4) NOT NULL,
    "currentQty" DECIMAL(18,3),
    "currentRate" DECIMAL(18,4),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "erp_stock_reconciliation_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "erp_settings_companyId_key" ON "erp_settings"("companyId");

-- CreateIndex
CREATE INDEX "erp_accounts_companyId_parentId_idx" ON "erp_accounts"("companyId", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "erp_accounts_companyId_code_key" ON "erp_accounts"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "erp_accounts_companyId_systemKey_key" ON "erp_accounts"("companyId", "systemKey");

-- CreateIndex
CREATE INDEX "erp_gl_entries_companyId_postingDate_idx" ON "erp_gl_entries"("companyId", "postingDate");

-- CreateIndex
CREATE INDEX "erp_gl_entries_accountId_postingDate_idx" ON "erp_gl_entries"("accountId", "postingDate");

-- CreateIndex
CREATE INDEX "erp_gl_entries_voucherType_voucherId_idx" ON "erp_gl_entries"("voucherType", "voucherId");

-- CreateIndex
CREATE INDEX "erp_gl_entries_companyId_partyType_partyId_idx" ON "erp_gl_entries"("companyId", "partyType", "partyId");

-- CreateIndex
CREATE INDEX "erp_gl_entries_againstType_againstId_idx" ON "erp_gl_entries"("againstType", "againstId");

-- CreateIndex
CREATE INDEX "erp_gl_entries_companyId_projectId_idx" ON "erp_gl_entries"("companyId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "erp_warehouses_companyId_name_key" ON "erp_warehouses"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "erp_warehouses_companyId_systemKey_key" ON "erp_warehouses"("companyId", "systemKey");

-- CreateIndex
CREATE INDEX "erp_items_companyId_name_idx" ON "erp_items"("companyId", "name");

-- CreateIndex
CREATE INDEX "erp_items_companyId_itemGroup_idx" ON "erp_items"("companyId", "itemGroup");

-- CreateIndex
CREATE UNIQUE INDEX "erp_items_companyId_code_key" ON "erp_items"("companyId", "code");

-- CreateIndex
CREATE INDEX "erp_bins_companyId_warehouseId_idx" ON "erp_bins"("companyId", "warehouseId");

-- CreateIndex
CREATE UNIQUE INDEX "erp_bins_itemId_warehouseId_key" ON "erp_bins"("itemId", "warehouseId");

-- CreateIndex
CREATE INDEX "erp_stock_ledger_itemId_warehouseId_seq_idx" ON "erp_stock_ledger"("itemId", "warehouseId", "seq");

-- CreateIndex
CREATE INDEX "erp_stock_ledger_companyId_postingDate_idx" ON "erp_stock_ledger"("companyId", "postingDate");

-- CreateIndex
CREATE INDEX "erp_stock_ledger_voucherType_voucherId_idx" ON "erp_stock_ledger"("voucherType", "voucherId");

-- CreateIndex
CREATE INDEX "erp_stock_ledger_companyId_projectId_idx" ON "erp_stock_ledger"("companyId", "projectId");

-- CreateIndex
CREATE INDEX "erp_stock_entries_companyId_status_postingDate_idx" ON "erp_stock_entries"("companyId", "status", "postingDate");

-- CreateIndex
CREATE INDEX "erp_stock_entries_workOrderId_idx" ON "erp_stock_entries"("workOrderId");

-- CreateIndex
CREATE INDEX "erp_stock_entries_materialRequestId_idx" ON "erp_stock_entries"("materialRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "erp_stock_entries_companyId_number_key" ON "erp_stock_entries"("companyId", "number");

-- CreateIndex
CREATE INDEX "erp_stock_entry_lines_entryId_sortOrder_idx" ON "erp_stock_entry_lines"("entryId", "sortOrder");

-- CreateIndex
CREATE INDEX "erp_stock_entry_lines_itemId_idx" ON "erp_stock_entry_lines"("itemId");

-- CreateIndex
CREATE INDEX "erp_stock_reconciliations_companyId_status_idx" ON "erp_stock_reconciliations"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "erp_stock_reconciliations_companyId_number_key" ON "erp_stock_reconciliations"("companyId", "number");

-- CreateIndex
CREATE INDEX "erp_stock_reconciliation_lines_reconciliationId_sortOrder_idx" ON "erp_stock_reconciliation_lines"("reconciliationId", "sortOrder");

-- AddForeignKey
ALTER TABLE "erp_accounts" ADD CONSTRAINT "erp_accounts_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "erp_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp_gl_entries" ADD CONSTRAINT "erp_gl_entries_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "erp_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp_bins" ADD CONSTRAINT "erp_bins_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "erp_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp_bins" ADD CONSTRAINT "erp_bins_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "erp_warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp_stock_entry_lines" ADD CONSTRAINT "erp_stock_entry_lines_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "erp_stock_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp_stock_reconciliation_lines" ADD CONSTRAINT "erp_stock_reconciliation_lines_reconciliationId_fkey" FOREIGN KEY ("reconciliationId") REFERENCES "erp_stock_reconciliations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
