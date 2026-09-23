-- AlterTable
ALTER TABLE "pm_projects" ADD COLUMN "holdReason" TEXT;
ALTER TABLE "pm_projects" ADD COLUMN "heldAt" TIMESTAMP(3);
