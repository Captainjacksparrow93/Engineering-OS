-- CreateEnum
CREATE TYPE "SalesPriceSource" AS ENUM ('PURCHASE', 'PRICE_LIST', 'BOM_COST');

-- CreateEnum
CREATE TYPE "SalesDealStage" AS ENUM ('LEAD', 'QUALIFIED', 'QUOTED', 'NEGOTIATION', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "SalesActivityType" AS ENUM ('NOTE', 'CALL', 'MEETING', 'EMAIL', 'FOLLOW_UP', 'STAGE');

-- CreateEnum
CREATE TYPE "SalesQuoteStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'ACCEPTED', 'DECLINED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "SalesOutcome" AS ENUM ('WON', 'LOST', 'OPEN');

-- CreateEnum
CREATE TYPE "SalesHistorySource" AS ENUM ('IMPORT', 'DEAL');

-- CreateTable
CREATE TABLE "sales_settings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "targetMarginPct" DECIMAL(5,2) NOT NULL DEFAULT 20,
    "minMarginPct" DECIMAL(5,2) NOT NULL DEFAULT 12,
    "gstPct" DECIMAL(5,2) NOT NULL DEFAULT 18,
    "priceStaleDays" INTEGER NOT NULL DEFAULT 90,
    "pricePriority" TEXT[] DEFAULT ARRAY['PURCHASE', 'PRICE_LIST', 'BOM_COST']::TEXT[],
    "quoteValidityDays" INTEGER NOT NULL DEFAULT 30,
    "followUpDays" INTEGER NOT NULL DEFAULT 7,
    "terms" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_items" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "make" TEXT,
    "makerPartNo" TEXT,
    "category" TEXT,
    "uom" TEXT NOT NULL DEFAULT 'Nos',
    "erpItemCode" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_item_prices" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "source" "SalesPriceSource" NOT NULL,
    "rate" DECIMAL(14,2) NOT NULL,
    "listPrice" DECIMAL(14,2),
    "discountPct" DECIMAL(5,2),
    "supplier" TEXT,
    "reference" TEXT,
    "effectiveDate" DATE NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_item_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_accounts" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "clientRef" TEXT,
    "city" TEXT,
    "industry" TEXT,
    "strategic" BOOLEAN NOT NULL DEFAULT false,
    "paymentDelayDays" INTEGER,
    "customerSince" DATE,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_contacts" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "designation" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_deals" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "contactId" TEXT,
    "ownerId" TEXT NOT NULL,
    "stage" "SalesDealStage" NOT NULL DEFAULT 'LEAD',
    "value" DECIMAL(14,2),
    "expectedCloseDate" DATE,
    "source" TEXT,
    "lostReason" TEXT,
    "closedAt" TIMESTAMP(3),
    "erpSalesOrder" TEXT,
    "woNumber" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_deals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_activities" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "SalesActivityType" NOT NULL,
    "note" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3),
    "doneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_quotes" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "status" "SalesQuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "discountPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "freight" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "gstPct" DECIMAL(5,2) NOT NULL,
    "validUntil" DATE NOT NULL,
    "terms" TEXT NOT NULL DEFAULT '',
    "showLineItems" BOOLEAN NOT NULL DEFAULT true,
    "approvalNote" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_quote_lines" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "panel" TEXT NOT NULL,
    "itemId" TEXT,
    "itemCode" TEXT,
    "description" TEXT NOT NULL,
    "uom" TEXT NOT NULL DEFAULT 'Nos',
    "qty" DECIMAL(12,3) NOT NULL,
    "unitCost" DECIMAL(14,2) NOT NULL,
    "costSource" "SalesPriceSource",
    "costDate" DATE,
    "marginPct" DECIMAL(5,2) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "sales_quote_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_history_lines" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "source" "SalesHistorySource" NOT NULL,
    "batchId" TEXT,
    "ref" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "accountId" TEXT,
    "accountName" TEXT NOT NULL,
    "outcome" "SalesOutcome" NOT NULL,
    "itemCode" TEXT,
    "description" TEXT,
    "qty" DECIMAL(12,3) NOT NULL,
    "unitCost" DECIMAL(14,2),
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_history_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sales_settings_companyId_key" ON "sales_settings"("companyId");

-- CreateIndex
CREATE INDEX "sales_items_companyId_name_idx" ON "sales_items"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "sales_items_companyId_code_key" ON "sales_items"("companyId", "code");

-- CreateIndex
CREATE INDEX "sales_item_prices_itemId_effectiveDate_idx" ON "sales_item_prices"("itemId", "effectiveDate");

-- CreateIndex
CREATE UNIQUE INDEX "sales_accounts_companyId_name_key" ON "sales_accounts"("companyId", "name");

-- CreateIndex
CREATE INDEX "sales_contacts_accountId_idx" ON "sales_contacts"("accountId");

-- CreateIndex
CREATE INDEX "sales_deals_companyId_ownerId_stage_idx" ON "sales_deals"("companyId", "ownerId", "stage");

-- CreateIndex
CREATE INDEX "sales_deals_accountId_idx" ON "sales_deals"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "sales_deals_companyId_code_key" ON "sales_deals"("companyId", "code");

-- CreateIndex
CREATE INDEX "sales_activities_dealId_createdAt_idx" ON "sales_activities"("dealId", "createdAt");

-- CreateIndex
CREATE INDEX "sales_activities_userId_doneAt_dueAt_idx" ON "sales_activities"("userId", "doneAt", "dueAt");

-- CreateIndex
CREATE INDEX "sales_quotes_dealId_idx" ON "sales_quotes"("dealId");

-- CreateIndex
CREATE INDEX "sales_quotes_companyId_status_idx" ON "sales_quotes"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "sales_quotes_companyId_number_revision_key" ON "sales_quotes"("companyId", "number", "revision");

-- CreateIndex
CREATE INDEX "sales_quote_lines_quoteId_sortOrder_idx" ON "sales_quote_lines"("quoteId", "sortOrder");

-- CreateIndex
CREATE INDEX "sales_history_lines_companyId_accountId_idx" ON "sales_history_lines"("companyId", "accountId");

-- CreateIndex
CREATE INDEX "sales_history_lines_companyId_itemCode_idx" ON "sales_history_lines"("companyId", "itemCode");

-- CreateIndex
CREATE INDEX "sales_history_lines_companyId_ref_idx" ON "sales_history_lines"("companyId", "ref");

-- AddForeignKey
ALTER TABLE "sales_settings" ADD CONSTRAINT "sales_settings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "core_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_items" ADD CONSTRAINT "sales_items_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "core_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_item_prices" ADD CONSTRAINT "sales_item_prices_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "sales_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_accounts" ADD CONSTRAINT "sales_accounts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "core_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_contacts" ADD CONSTRAINT "sales_contacts_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "sales_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_deals" ADD CONSTRAINT "sales_deals_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "core_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_deals" ADD CONSTRAINT "sales_deals_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "sales_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_deals" ADD CONSTRAINT "sales_deals_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "sales_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_deals" ADD CONSTRAINT "sales_deals_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "core_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_activities" ADD CONSTRAINT "sales_activities_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "sales_deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_activities" ADD CONSTRAINT "sales_activities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "core_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_quotes" ADD CONSTRAINT "sales_quotes_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "core_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_quotes" ADD CONSTRAINT "sales_quotes_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "sales_deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_quotes" ADD CONSTRAINT "sales_quotes_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "core_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_quotes" ADD CONSTRAINT "sales_quotes_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "core_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_quote_lines" ADD CONSTRAINT "sales_quote_lines_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "sales_quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_history_lines" ADD CONSTRAINT "sales_history_lines_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "core_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_history_lines" ADD CONSTRAINT "sales_history_lines_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "sales_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
