-- Plan 020 phase 1: HRMS employee profiles and documents. Additive: new enums and tables only.

-- CreateEnum
CREATE TYPE "HrEmploymentType" AS ENUM ('PERMANENT', 'PROBATION', 'CONTRACT', 'INTERN', 'CONSULTANT');

-- CreateEnum
CREATE TYPE "HrGender" AS ENUM ('FEMALE', 'MALE', 'OTHER');

-- CreateEnum
CREATE TYPE "HrMaritalStatus" AS ENUM ('SINGLE', 'MARRIED', 'OTHER');

-- CreateEnum
CREATE TYPE "HrDocumentCategory" AS ENUM ('OFFER_LETTER', 'APPOINTMENT_LETTER', 'ID_PROOF', 'ADDRESS_PROOF', 'EDUCATION', 'EXPERIENCE', 'BANK', 'CONTRACT', 'LETTER', 'POLICY', 'OTHER');

-- CreateTable
CREATE TABLE "hr_employee_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dateOfJoining" DATE,
    "employmentType" "HrEmploymentType",
    "probationEndDate" DATE,
    "confirmationDate" DATE,
    "workLocation" TEXT,
    "noticePeriodDays" INTEGER,
    "dateOfBirth" DATE,
    "gender" "HrGender",
    "maritalStatus" "HrMaritalStatus",
    "bloodGroup" TEXT,
    "personalEmail" TEXT,
    "currentAddress" TEXT,
    "permanentAddress" TEXT,
    "emergencyName" TEXT,
    "emergencyRelation" TEXT,
    "emergencyPhone" TEXT,
    "pan" TEXT,
    "aadhaar" TEXT,
    "uan" TEXT,
    "esicNumber" TEXT,
    "bankName" TEXT,
    "bankAccountNo" TEXT,
    "bankIfsc" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_employee_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_documents" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT,
    "category" "HrDocumentCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "content" BYTEA NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "supersededAt" TIMESTAMP(3),
    "visibleToEmployee" BOOLEAN NOT NULL DEFAULT true,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hr_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hr_employee_profiles_userId_key" ON "hr_employee_profiles"("userId");

-- CreateIndex
CREATE INDEX "hr_documents_companyId_userId_category_title_idx" ON "hr_documents"("companyId", "userId", "category", "title");

-- AddForeignKey
ALTER TABLE "hr_employee_profiles" ADD CONSTRAINT "hr_employee_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "core_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_documents" ADD CONSTRAINT "hr_documents_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "core_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_documents" ADD CONSTRAINT "hr_documents_userId_fkey" FOREIGN KEY ("userId") REFERENCES "core_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_documents" ADD CONSTRAINT "hr_documents_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "core_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

