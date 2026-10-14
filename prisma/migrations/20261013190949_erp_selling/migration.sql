-- AlterTable
ALTER TABLE "erp_settings" ADD COLUMN     "projectsFromSalesOrders" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "salesTerms" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "erp_sales_orders" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "status" "ErpDocStatus" NOT NULL DEFAULT 'DRAFT',
    "isClosed" BOOLEAN NOT NULL DEFAULT false,
    "isOnHold" BOOLEAN NOT NULL DEFAULT false,
    "orderDate" DATE NOT NULL,
    "deliveryDate" DATE,
    "poNo" TEXT,
    "woNumber" TEXT,
    "projectId" TEXT,
    "dealId" TEXT,
    "quotationRef" TEXT,
    "terms" TEXT,
    "remarks" TEXT,
    "netTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "cgst" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "sgst" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "igst" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "grandTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "erp_sales_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_sales_order_lines" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "description" TEXT,
    "qty" DECIMAL(18,3) NOT NULL,
    "rate" DECIMAL(14,2) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "gstRate" DECIMAL(5,2) NOT NULL,
    "deliveryDate" DATE,
    "warehouseId" TEXT NOT NULL,
    "deliveredQty" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "billedQty" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "erp_sales_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_delivery_notes" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "status" "ErpDocStatus" NOT NULL DEFAULT 'DRAFT',
    "postingDate" DATE NOT NULL,
    "projectId" TEXT,
    "transporter" TEXT,
    "vehicleNo" TEXT,
    "lrNo" TEXT,
    "remarks" TEXT,
    "netTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "erp_delivery_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_delivery_note_lines" (
    "id" TEXT NOT NULL,
    "deliveryNoteId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "orderLineId" TEXT,
    "qty" DECIMAL(18,3) NOT NULL,
    "rate" DECIMAL(14,2) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "gstRate" DECIMAL(5,2) NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "costAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "billedQty" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "qualityInspectionId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "erp_delivery_note_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_sales_invoices" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "status" "ErpDocStatus" NOT NULL DEFAULT 'DRAFT',
    "postingDate" DATE NOT NULL,
    "dueDate" DATE,
    "poNo" TEXT,
    "projectId" TEXT,
    "remarks" TEXT,
    "isReturn" BOOLEAN NOT NULL DEFAULT false,
    "returnAgainstId" TEXT,
    "netTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "cgst" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "sgst" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "igst" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "grandTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "outstandingAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "erp_sales_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_sales_invoice_lines" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "itemId" TEXT,
    "description" TEXT NOT NULL,
    "qty" DECIMAL(18,3) NOT NULL,
    "rate" DECIMAL(14,2) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "gstRate" DECIMAL(5,2) NOT NULL,
    "orderLineId" TEXT,
    "deliveryLineId" TEXT,
    "incomeAccountId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "erp_sales_invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "erp_sales_orders_companyId_status_idx" ON "erp_sales_orders"("companyId", "status");

-- CreateIndex
CREATE INDEX "erp_sales_orders_companyId_customerId_idx" ON "erp_sales_orders"("companyId", "customerId");

-- CreateIndex
CREATE INDEX "erp_sales_orders_companyId_woNumber_idx" ON "erp_sales_orders"("companyId", "woNumber");

-- CreateIndex
CREATE INDEX "erp_sales_orders_projectId_idx" ON "erp_sales_orders"("projectId");

-- CreateIndex
CREATE INDEX "erp_sales_orders_dealId_idx" ON "erp_sales_orders"("dealId");

-- CreateIndex
CREATE UNIQUE INDEX "erp_sales_orders_companyId_number_key" ON "erp_sales_orders"("companyId", "number");

-- CreateIndex
CREATE INDEX "erp_sales_order_lines_orderId_sortOrder_idx" ON "erp_sales_order_lines"("orderId", "sortOrder");

-- CreateIndex
CREATE INDEX "erp_sales_order_lines_itemId_idx" ON "erp_sales_order_lines"("itemId");

-- CreateIndex
CREATE INDEX "erp_delivery_notes_companyId_status_idx" ON "erp_delivery_notes"("companyId", "status");

-- CreateIndex
CREATE INDEX "erp_delivery_notes_companyId_customerId_idx" ON "erp_delivery_notes"("companyId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "erp_delivery_notes_companyId_number_key" ON "erp_delivery_notes"("companyId", "number");

-- CreateIndex
CREATE INDEX "erp_delivery_note_lines_deliveryNoteId_sortOrder_idx" ON "erp_delivery_note_lines"("deliveryNoteId", "sortOrder");

-- CreateIndex
CREATE INDEX "erp_delivery_note_lines_orderLineId_idx" ON "erp_delivery_note_lines"("orderLineId");

-- CreateIndex
CREATE INDEX "erp_sales_invoices_companyId_status_idx" ON "erp_sales_invoices"("companyId", "status");

-- CreateIndex
CREATE INDEX "erp_sales_invoices_companyId_customerId_idx" ON "erp_sales_invoices"("companyId", "customerId");

-- CreateIndex
CREATE INDEX "erp_sales_invoices_companyId_projectId_idx" ON "erp_sales_invoices"("companyId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "erp_sales_invoices_companyId_number_key" ON "erp_sales_invoices"("companyId", "number");

-- CreateIndex
CREATE INDEX "erp_sales_invoice_lines_invoiceId_sortOrder_idx" ON "erp_sales_invoice_lines"("invoiceId", "sortOrder");

-- CreateIndex
CREATE INDEX "erp_sales_invoice_lines_orderLineId_idx" ON "erp_sales_invoice_lines"("orderLineId");

-- CreateIndex
CREATE INDEX "erp_sales_invoice_lines_deliveryLineId_idx" ON "erp_sales_invoice_lines"("deliveryLineId");

-- AddForeignKey
ALTER TABLE "erp_sales_order_lines" ADD CONSTRAINT "erp_sales_order_lines_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "erp_sales_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp_delivery_note_lines" ADD CONSTRAINT "erp_delivery_note_lines_deliveryNoteId_fkey" FOREIGN KEY ("deliveryNoteId") REFERENCES "erp_delivery_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp_sales_invoice_lines" ADD CONSTRAINT "erp_sales_invoice_lines_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "erp_sales_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
