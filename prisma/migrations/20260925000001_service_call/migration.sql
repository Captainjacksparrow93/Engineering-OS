-- CreateEnum
CREATE TYPE "ProjectKind" AS ENUM ('WORK_ORDER', 'SERVICE_CALL');

-- AlterTable
ALTER TABLE "pm_projects" ADD COLUMN "kind" "ProjectKind" NOT NULL DEFAULT 'WORK_ORDER',
ALTER COLUMN "workOrderNo" DROP NOT NULL;
