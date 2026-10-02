-- AlterEnum (Note: In PostgreSQL, ALTER TYPE ... ADD VALUE cannot run inside a transaction block)
ALTER TYPE "ProjectStatus" ADD VALUE 'COMMISSIONING';
ALTER TYPE "ProjectStatus" ADD VALUE 'CLOSED';

-- CreateTable
CREATE TABLE "pm_commissioning_assignments" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assignedById" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),

    CONSTRAINT "pm_commissioning_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pm_commissioning_logs" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "loggedFor" DATE NOT NULL,
    "workDone" TEXT NOT NULL,
    "blocker" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pm_commissioning_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pm_commissioning_assignments_userId_idx" ON "pm_commissioning_assignments"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "pm_commissioning_assignments_projectId_userId_key" ON "pm_commissioning_assignments"("projectId", "userId");

-- CreateIndex
CREATE INDEX "pm_commissioning_logs_projectId_loggedFor_idx" ON "pm_commissioning_logs"("projectId", "loggedFor");

-- CreateIndex
CREATE INDEX "pm_commissioning_logs_userId_loggedFor_idx" ON "pm_commissioning_logs"("userId", "loggedFor");

-- CreateIndex
CREATE UNIQUE INDEX "pm_commissioning_logs_projectId_userId_loggedFor_key" ON "pm_commissioning_logs"("projectId", "userId", "loggedFor");

-- AddForeignKey
ALTER TABLE "pm_commissioning_assignments" ADD CONSTRAINT "pm_commissioning_assignments_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "pm_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pm_commissioning_assignments" ADD CONSTRAINT "pm_commissioning_assignments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "core_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pm_commissioning_logs" ADD CONSTRAINT "pm_commissioning_logs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "pm_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pm_commissioning_logs" ADD CONSTRAINT "pm_commissioning_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "core_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
