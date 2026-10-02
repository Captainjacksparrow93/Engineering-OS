-- AlterTable
ALTER TABLE "pm_projects" ADD COLUMN "workOrderNo" TEXT;
ALTER TABLE "pm_projects" ADD COLUMN "endUserName" TEXT;
ALTER TABLE "pm_projects" ADD COLUMN "applicationName" TEXT;

-- Backfill workOrderNo for existing projects uniquely
DO $$
DECLARE
    r RECORD;
    counter INT := 1001;
    num_part TEXT;
BEGIN
    FOR r IN (
        SELECT id, code FROM "pm_projects" ORDER BY "createdAt" ASC
    ) LOOP
        num_part := regexp_replace(r.code, '\D', '', 'g');
        IF num_part IS NULL OR num_part = '' THEN
            num_part := counter::text;
            counter := counter + 1;
        END IF;
        -- ensure uniqueness
        WHILE EXISTS (SELECT 1 FROM "pm_projects" WHERE "workOrderNo" = num_part AND id != r.id) LOOP
            num_part := counter::text;
            counter := counter + 1;
        END LOOP;

        UPDATE "pm_projects" SET "workOrderNo" = num_part WHERE id = r.id;
    END LOOP;
END $$;

ALTER TABLE "pm_projects" ALTER COLUMN "workOrderNo" SET NOT NULL;
CREATE UNIQUE INDEX "pm_projects_workOrderNo_key" ON "pm_projects"("workOrderNo");

-- Drop old columns
ALTER TABLE "pm_projects" DROP COLUMN IF EXISTS "poNumber";
ALTER TABLE "pm_projects" DROP COLUMN IF EXISTS "orderValue";
