-- AlterTable
ALTER TABLE "erp_items" ADD COLUMN     "inspectionBeforeDelivery" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "inspectionBeforePurchase" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "qualityTemplateId" TEXT;
