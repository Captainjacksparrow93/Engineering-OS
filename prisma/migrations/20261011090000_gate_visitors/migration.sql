-- CreateEnum
CREATE TYPE "GateVisitStatus" AS ENUM ('EXPECTED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED');
-- CreateEnum
CREATE TYPE "GateVisitSource" AS ENUM ('DESK', 'HOST', 'WALK_IN');

-- CreateEnum
CREATE TYPE "GateHostReply" AS ENUM ('COMING', 'WAIT', 'UNAVAILABLE');

-- CreateTable
CREATE TABLE "gate_visits" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "visitorName" TEXT NOT NULL,
    "visitorPhone" TEXT NOT NULL,
    "visitorCompany" TEXT,
    "purpose" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "expectedAt" TIMESTAMP(3) NOT NULL,
    "status" "GateVisitStatus" NOT NULL DEFAULT 'EXPECTED',
    "source" "GateVisitSource" NOT NULL,
    "createdById" TEXT NOT NULL,
    "checkedInAt" TIMESTAMP(3),
    "checkedOutAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "hostReply" "GateHostReply",
    "hostReplyNote" TEXT,
    "hostRepliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gate_visits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gate_visits_companyId_expectedAt_idx" ON "gate_visits"("companyId", "expectedAt");

-- CreateIndex
CREATE INDEX "gate_visits_companyId_status_idx" ON "gate_visits"("companyId", "status");

-- CreateIndex
CREATE INDEX "gate_visits_hostId_status_idx" ON "gate_visits"("hostId", "status");

-- AddForeignKey
ALTER TABLE "gate_visits" ADD CONSTRAINT "gate_visits_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "core_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gate_visits" ADD CONSTRAINT "gate_visits_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "core_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gate_visits" ADD CONSTRAINT "gate_visits_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "core_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

