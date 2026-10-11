-- Plan 020 phase 2: leave, holidays, attendance and regularisation. Additive: new enums, tables and one nullable column.

-- CreateEnum
CREATE TYPE "HrLeaveStatus" AS ENUM ('PENDING_MANAGER', 'PENDING_HEAD', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "HrAttendanceSource" AS ENUM ('IMPORT', 'REGULARISED');

-- CreateEnum
CREATE TYPE "HrRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "hr_employee_profiles" ADD COLUMN     "biometricId" TEXT;

-- CreateTable
CREATE TABLE "hr_settings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "shiftStartMinutes" INTEGER NOT NULL DEFAULT 570,
    "graceMinutes" INTEGER NOT NULL DEFAULT 15,
    "fullDayMinutes" INTEGER NOT NULL DEFAULT 480,
    "halfDayMinutes" INTEGER NOT NULL DEFAULT 240,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_leave_types" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "annualDays" DECIMAL(5,1),
    "paid" BOOLEAN NOT NULL DEFAULT true,
    "allowHalfDay" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_leave_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_leave_allocations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "days" DECIMAL(5,1) NOT NULL,
    "note" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_leave_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_leave_requests" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "halfDay" BOOLEAN NOT NULL DEFAULT false,
    "days" DECIMAL(5,1) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "HrLeaveStatus" NOT NULL,
    "managerById" TEXT,
    "managerAt" TIMESTAMP(3),
    "managerNote" TEXT,
    "headById" TEXT,
    "headAt" TIMESTAMP(3),
    "headNote" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "coreLeaveId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_leave_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_holidays" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hr_holidays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_attendance" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "firstIn" TIMESTAMP(3),
    "lastOut" TIMESTAMP(3),
    "source" "HrAttendanceSource" NOT NULL DEFAULT 'IMPORT',
    "importId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_attendance_imports" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "rows" INTEGER NOT NULL,
    "days" INTEGER NOT NULL,
    "skipped" INTEGER NOT NULL,
    "problems" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "fromDate" DATE,
    "toDate" DATE,
    "importedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hr_attendance_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_regularisations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "firstIn" TIMESTAMP(3) NOT NULL,
    "lastOut" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "HrRequestStatus" NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hr_regularisations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hr_settings_companyId_key" ON "hr_settings"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "hr_leave_types_companyId_code_key" ON "hr_leave_types"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "hr_leave_allocations_userId_leaveTypeId_year_key" ON "hr_leave_allocations"("userId", "leaveTypeId", "year");

-- CreateIndex
CREATE UNIQUE INDEX "hr_leave_requests_coreLeaveId_key" ON "hr_leave_requests"("coreLeaveId");

-- CreateIndex
CREATE INDEX "hr_leave_requests_companyId_status_idx" ON "hr_leave_requests"("companyId", "status");

-- CreateIndex
CREATE INDEX "hr_leave_requests_userId_startDate_idx" ON "hr_leave_requests"("userId", "startDate");

-- CreateIndex
CREATE UNIQUE INDEX "hr_holidays_companyId_date_key" ON "hr_holidays"("companyId", "date");

-- CreateIndex
CREATE INDEX "hr_attendance_date_idx" ON "hr_attendance"("date");

-- CreateIndex
CREATE UNIQUE INDEX "hr_attendance_userId_date_key" ON "hr_attendance"("userId", "date");

-- CreateIndex
CREATE INDEX "hr_attendance_imports_companyId_createdAt_idx" ON "hr_attendance_imports"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "hr_regularisations_userId_date_idx" ON "hr_regularisations"("userId", "date");

-- CreateIndex
CREATE INDEX "hr_regularisations_status_idx" ON "hr_regularisations"("status");

-- CreateIndex
CREATE INDEX "hr_employee_profiles_biometricId_idx" ON "hr_employee_profiles"("biometricId");

-- AddForeignKey
ALTER TABLE "hr_settings" ADD CONSTRAINT "hr_settings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "core_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_leave_types" ADD CONSTRAINT "hr_leave_types_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "core_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_leave_allocations" ADD CONSTRAINT "hr_leave_allocations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "core_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_leave_allocations" ADD CONSTRAINT "hr_leave_allocations_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "hr_leave_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_leave_requests" ADD CONSTRAINT "hr_leave_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "core_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_leave_requests" ADD CONSTRAINT "hr_leave_requests_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "hr_leave_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_leave_requests" ADD CONSTRAINT "hr_leave_requests_managerById_fkey" FOREIGN KEY ("managerById") REFERENCES "core_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_leave_requests" ADD CONSTRAINT "hr_leave_requests_headById_fkey" FOREIGN KEY ("headById") REFERENCES "core_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_holidays" ADD CONSTRAINT "hr_holidays_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "core_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_attendance" ADD CONSTRAINT "hr_attendance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "core_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_attendance" ADD CONSTRAINT "hr_attendance_importId_fkey" FOREIGN KEY ("importId") REFERENCES "hr_attendance_imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_attendance_imports" ADD CONSTRAINT "hr_attendance_imports_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "core_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_attendance_imports" ADD CONSTRAINT "hr_attendance_imports_importedById_fkey" FOREIGN KEY ("importedById") REFERENCES "core_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_regularisations" ADD CONSTRAINT "hr_regularisations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "core_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_regularisations" ADD CONSTRAINT "hr_regularisations_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "core_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

