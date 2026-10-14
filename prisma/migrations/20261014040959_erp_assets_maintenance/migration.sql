-- CreateEnum
CREATE TYPE "ErpAssetStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'SCRAPPED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ErpMaintenanceFrequency" AS ENUM ('WEEKLY', 'MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "ErpMaintenanceKind" AS ENUM ('PREVENTIVE', 'BREAKDOWN');

-- CreateEnum
CREATE TYPE "ErpMaintenanceStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED');

-- CreateTable
CREATE TABLE "erp_asset_categories" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "usefulLifeMonths" INTEGER NOT NULL,
    "fixedAssetAccountId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "erp_asset_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_assets" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "itemId" TEXT,
    "serialNo" TEXT,
    "location" TEXT,
    "custodianId" TEXT,
    "workstationId" TEXT,
    "supplierId" TEXT,
    "purchaseInvoiceId" TEXT,
    "isExisting" BOOLEAN NOT NULL DEFAULT false,
    "purchaseDate" DATE NOT NULL,
    "availableForUseDate" DATE NOT NULL,
    "grossValue" DECIMAL(18,2) NOT NULL,
    "salvageValue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "usefulLifeMonths" INTEGER NOT NULL,
    "openingAccumulated" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "openingMonths" INTEGER NOT NULL DEFAULT 0,
    "maintenanceRequired" BOOLEAN NOT NULL DEFAULT false,
    "status" "ErpAssetStatus" NOT NULL DEFAULT 'DRAFT',
    "disposalDate" DATE,
    "disposalNote" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "erp_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_depreciation_entries" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "scheduleDate" DATE NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "accumulated" DECIMAL(18,2) NOT NULL,
    "postedAt" TIMESTAMP(3),
    "postedById" TEXT,

    CONSTRAINT "erp_depreciation_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_asset_movements" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "movedAt" DATE NOT NULL,
    "fromLocation" TEXT,
    "toLocation" TEXT,
    "fromCustodian" TEXT,
    "toCustodian" TEXT,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "erp_asset_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_maintenance_schedules" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "frequency" "ErpMaintenanceFrequency" NOT NULL,
    "nextDueDate" DATE NOT NULL,
    "lastDoneDate" DATE,
    "assignedToId" TEXT,
    "checklist" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "erp_maintenance_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_maintenance_logs" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "scheduleId" TEXT,
    "kind" "ErpMaintenanceKind" NOT NULL,
    "status" "ErpMaintenanceStatus" NOT NULL DEFAULT 'OPEN',
    "description" TEXT NOT NULL,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "downtimeHours" DECIMAL(10,2),
    "actionTaken" TEXT,
    "cost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "assignedToId" TEXT,
    "doneById" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "erp_maintenance_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "erp_asset_categories_companyId_name_key" ON "erp_asset_categories"("companyId", "name");

-- CreateIndex
CREATE INDEX "erp_assets_companyId_status_idx" ON "erp_assets"("companyId", "status");

-- CreateIndex
CREATE INDEX "erp_assets_companyId_categoryId_idx" ON "erp_assets"("companyId", "categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "erp_assets_companyId_number_key" ON "erp_assets"("companyId", "number");

-- CreateIndex
CREATE INDEX "erp_depreciation_entries_scheduleDate_postedAt_idx" ON "erp_depreciation_entries"("scheduleDate", "postedAt");

-- CreateIndex
CREATE UNIQUE INDEX "erp_depreciation_entries_assetId_seq_key" ON "erp_depreciation_entries"("assetId", "seq");

-- CreateIndex
CREATE INDEX "erp_asset_movements_assetId_idx" ON "erp_asset_movements"("assetId");

-- CreateIndex
CREATE INDEX "erp_maintenance_schedules_companyId_isActive_nextDueDate_idx" ON "erp_maintenance_schedules"("companyId", "isActive", "nextDueDate");

-- CreateIndex
CREATE INDEX "erp_maintenance_schedules_assetId_idx" ON "erp_maintenance_schedules"("assetId");

-- CreateIndex
CREATE INDEX "erp_maintenance_logs_companyId_kind_status_idx" ON "erp_maintenance_logs"("companyId", "kind", "status");

-- CreateIndex
CREATE INDEX "erp_maintenance_logs_assetId_idx" ON "erp_maintenance_logs"("assetId");

-- CreateIndex
CREATE UNIQUE INDEX "erp_maintenance_logs_companyId_number_key" ON "erp_maintenance_logs"("companyId", "number");

-- AddForeignKey
ALTER TABLE "erp_depreciation_entries" ADD CONSTRAINT "erp_depreciation_entries_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "erp_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp_asset_movements" ADD CONSTRAINT "erp_asset_movements_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "erp_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
