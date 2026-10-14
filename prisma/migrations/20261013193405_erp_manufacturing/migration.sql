-- CreateEnum
CREATE TYPE "ErpJobCardStatus" AS ENUM ('OPEN', 'WORK_IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "erp_workstations" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hourRate" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "capacity" INTEGER NOT NULL DEFAULT 1,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "erp_workstations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_boms" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "qty" DECIMAL(18,3) NOT NULL DEFAULT 1,
    "status" "ErpDocStatus" NOT NULL DEFAULT 'DRAFT',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "projectId" TEXT,
    "remarks" TEXT,
    "rawMaterialCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "operatingCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "erp_boms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_bom_items" (
    "id" TEXT NOT NULL,
    "bomId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "qty" DECIMAL(18,3) NOT NULL,
    "rate" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "childBomId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "erp_bom_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_bom_operations" (
    "id" TEXT NOT NULL,
    "bomId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "workstationId" TEXT NOT NULL,
    "timeMinutes" DECIMAL(12,2) NOT NULL,
    "hourRate" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "cost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "sequence" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "erp_bom_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_work_orders" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "bomId" TEXT NOT NULL,
    "qty" DECIMAL(18,3) NOT NULL,
    "producedQty" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "materialTransferredQty" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "status" "ErpDocStatus" NOT NULL DEFAULT 'DRAFT',
    "isStopped" BOOLEAN NOT NULL DEFAULT false,
    "plannedStart" DATE,
    "expectedEnd" DATE,
    "sourceWarehouseId" TEXT NOT NULL,
    "wipWarehouseId" TEXT NOT NULL,
    "fgWarehouseId" TEXT NOT NULL,
    "salesOrderId" TEXT,
    "salesOrderLineId" TEXT,
    "productionPlanId" TEXT,
    "projectId" TEXT,
    "remarks" TEXT,
    "createdById" TEXT NOT NULL,
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "erp_work_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_work_order_items" (
    "id" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "requiredQty" DECIMAL(18,3) NOT NULL,
    "transferredQty" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "consumedQty" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "sourceWarehouseId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "erp_work_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_job_cards" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "workstationId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "forQty" DECIMAL(18,3) NOT NULL,
    "completedQty" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "plannedMinutes" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalMinutes" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "hourRate" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "ErpJobCardStatus" NOT NULL DEFAULT 'OPEN',
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "erp_job_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_job_card_logs" (
    "id" TEXT NOT NULL,
    "jobCardId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "fromTime" TIMESTAMP(3) NOT NULL,
    "toTime" TIMESTAMP(3) NOT NULL,
    "minutes" DECIMAL(12,2) NOT NULL,
    "completedQty" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "erp_job_card_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_production_plans" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" "ErpDocStatus" NOT NULL DEFAULT 'DRAFT',
    "postingDate" DATE NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "remarks" TEXT,
    "createdById" TEXT NOT NULL,
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "erp_production_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_production_plan_items" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "bomId" TEXT,
    "qty" DECIMAL(18,3) NOT NULL,
    "plannedStart" DATE,
    "salesOrderLineId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "erp_production_plan_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "erp_workstations_companyId_name_key" ON "erp_workstations"("companyId", "name");

-- CreateIndex
CREATE INDEX "erp_boms_companyId_itemId_isDefault_idx" ON "erp_boms"("companyId", "itemId", "isDefault");

-- CreateIndex
CREATE UNIQUE INDEX "erp_boms_companyId_number_key" ON "erp_boms"("companyId", "number");

-- CreateIndex
CREATE INDEX "erp_bom_items_bomId_sortOrder_idx" ON "erp_bom_items"("bomId", "sortOrder");

-- CreateIndex
CREATE INDEX "erp_bom_items_itemId_idx" ON "erp_bom_items"("itemId");

-- CreateIndex
CREATE INDEX "erp_bom_operations_bomId_sequence_idx" ON "erp_bom_operations"("bomId", "sequence");

-- CreateIndex
CREATE INDEX "erp_work_orders_companyId_status_idx" ON "erp_work_orders"("companyId", "status");

-- CreateIndex
CREATE INDEX "erp_work_orders_salesOrderLineId_idx" ON "erp_work_orders"("salesOrderLineId");

-- CreateIndex
CREATE INDEX "erp_work_orders_productionPlanId_idx" ON "erp_work_orders"("productionPlanId");

-- CreateIndex
CREATE INDEX "erp_work_orders_companyId_projectId_idx" ON "erp_work_orders"("companyId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "erp_work_orders_companyId_number_key" ON "erp_work_orders"("companyId", "number");

-- CreateIndex
CREATE INDEX "erp_work_order_items_workOrderId_sortOrder_idx" ON "erp_work_order_items"("workOrderId", "sortOrder");

-- CreateIndex
CREATE INDEX "erp_job_cards_workOrderId_sequence_idx" ON "erp_job_cards"("workOrderId", "sequence");

-- CreateIndex
CREATE INDEX "erp_job_cards_companyId_status_idx" ON "erp_job_cards"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "erp_job_cards_companyId_number_key" ON "erp_job_cards"("companyId", "number");

-- CreateIndex
CREATE INDEX "erp_job_card_logs_jobCardId_fromTime_idx" ON "erp_job_card_logs"("jobCardId", "fromTime");

-- CreateIndex
CREATE INDEX "erp_job_card_logs_employeeId_fromTime_idx" ON "erp_job_card_logs"("employeeId", "fromTime");

-- CreateIndex
CREATE INDEX "erp_production_plans_companyId_status_idx" ON "erp_production_plans"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "erp_production_plans_companyId_number_key" ON "erp_production_plans"("companyId", "number");

-- CreateIndex
CREATE INDEX "erp_production_plan_items_planId_sortOrder_idx" ON "erp_production_plan_items"("planId", "sortOrder");

-- AddForeignKey
ALTER TABLE "erp_bom_items" ADD CONSTRAINT "erp_bom_items_bomId_fkey" FOREIGN KEY ("bomId") REFERENCES "erp_boms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp_bom_operations" ADD CONSTRAINT "erp_bom_operations_bomId_fkey" FOREIGN KEY ("bomId") REFERENCES "erp_boms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp_work_order_items" ADD CONSTRAINT "erp_work_order_items_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "erp_work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp_job_card_logs" ADD CONSTRAINT "erp_job_card_logs_jobCardId_fkey" FOREIGN KEY ("jobCardId") REFERENCES "erp_job_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp_production_plan_items" ADD CONSTRAINT "erp_production_plan_items_planId_fkey" FOREIGN KEY ("planId") REFERENCES "erp_production_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
