-- AlterTable
ALTER TABLE "pm_clients" ADD COLUMN     "erpCustomer" TEXT;

-- AlterTable
ALTER TABLE "pm_projects" ADD COLUMN     "clientPoNumber" TEXT,
ADD COLUMN     "erpOrderModified" TEXT,
ADD COLUMN     "erpSalesOrder" TEXT;

-- AlterTable
ALTER TABLE "pm_tasks" ADD COLUMN     "erpOrderItem" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "pm_clients_companyId_erpCustomer_key" ON "pm_clients"("companyId", "erpCustomer");

-- CreateIndex
CREATE UNIQUE INDEX "pm_projects_erpSalesOrder_key" ON "pm_projects"("erpSalesOrder");
