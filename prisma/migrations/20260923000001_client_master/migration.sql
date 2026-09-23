-- CreateTable
CREATE TABLE "pm_clients" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "refNumber" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pm_clients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pm_clients_companyId_name_key" ON "pm_clients"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "pm_clients_companyId_refNumber_key" ON "pm_clients"("companyId", "refNumber");

-- AddForeignKey
ALTER TABLE "pm_clients" ADD CONSTRAINT "pm_clients_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "core_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "pm_projects" ADD COLUMN "clientId" TEXT;

-- CreateIndex
CREATE INDEX "pm_projects_clientId_idx" ON "pm_projects"("clientId");

-- AddForeignKey
ALTER TABLE "pm_projects" ADD CONSTRAINT "pm_projects_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "pm_clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Data backfill: populate pm_clients from DISTINCT clientName in pm_projects
DO $$
DECLARE
    r RECORD;
    seq INT := 1;
    new_client_id TEXT;
BEGIN
    FOR r IN (
        SELECT DISTINCT "companyId", "clientName"
        FROM "pm_projects"
        WHERE "clientName" IS NOT NULL AND "clientName" != ''
        ORDER BY "clientName" ASC
    ) LOOP
        new_client_id := 'cclient_' || substr(md5(random()::text || clock_timestamp()::text), 1, 20);
        INSERT INTO "pm_clients" ("id", "companyId", "name", "refNumber", "isActive", "createdAt", "updatedAt")
        VALUES (
            new_client_id,
            r."companyId",
            r."clientName",
            'ACS-' || lpad(seq::text, 4, '0'),
            true,
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
        );
        UPDATE "pm_projects"
        SET "clientId" = new_client_id
        WHERE "companyId" = r."companyId" AND "clientName" = r."clientName";
        seq := seq + 1;
    END LOOP;
END $$;
