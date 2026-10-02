-- DropIndex
DROP INDEX "pm_projects_code_key";

-- CreateIndex
CREATE INDEX "pm_projects_companyId_code_idx" ON "pm_projects"("companyId", "code");
