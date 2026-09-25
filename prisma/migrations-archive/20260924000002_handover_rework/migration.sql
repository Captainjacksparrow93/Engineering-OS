-- AlterEnum
ALTER TYPE "HandoverStatus" ADD VALUE 'AWAITING_HEAD_APPROVAL';

-- AlterTable pm_task_handovers
ALTER TABLE "pm_task_handovers" ADD COLUMN "headApprovedById" TEXT,
ADD COLUMN "headApprovedAt" TIMESTAMP(3),
ADD COLUMN "headDecisionNote" TEXT;

-- AlterTable pm_project_handovers
ALTER TABLE "pm_project_handovers" ADD COLUMN "headApprovedById" TEXT,
ADD COLUMN "headApprovedAt" TIMESTAMP(3),
ADD COLUMN "headDecisionNote" TEXT;

-- AddForeignKey
ALTER TABLE "pm_task_handovers" ADD CONSTRAINT "pm_task_handovers_headApprovedById_fkey" FOREIGN KEY ("headApprovedById") REFERENCES "core_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pm_project_handovers" ADD CONSTRAINT "pm_project_handovers_headApprovedById_fkey" FOREIGN KEY ("headApprovedById") REFERENCES "core_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
