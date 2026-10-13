-- CreateEnum
CREATE TYPE "ErpMaterialRequestPurpose" AS ENUM ('PURCHASE', 'TRANSFER', 'ISSUE');

-- CreateTable
CREATE TABLE "erp_parties" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" "ErpPartyType" NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "gstin" TEXT,
    "pan" TEXT,
    "state" TEXT,
    "address" TEXT,
    "city" TEXT,
    "pincode" TEXT,
    "contactPerson" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "paymentTermsDays" INTEGER NOT NULL DEFAULT 30,
    "creditLimit" DECIMAL(14,2),
    "clientId" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "erp_parties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_material_requests" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "purpose" "ErpMaterialRequestPurpose" NOT NULL DEFAULT 'PURCHASE',
    "status" "ErpDocStatus" NOT NULL DEFAULT 'DRAFT',
    "isStopped" BOOLEAN NOT NULL DEFAULT false,
    "requestDate" DATE NOT NULL,
    "requiredBy" DATE,
    "warehouseId" TEXT,
    "projectId" TEXT,
    "workOrderId" TEXT,
    "remarks" TEXT,
    "createdById" TEXT NOT NULL,
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "erp_material_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_material_request_lines" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "qty" DECIMAL(18,3) NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "requiredBy" DATE,
    "orderedQty" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "erp_material_request_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_supplier_quotations" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "status" "ErpDocStatus" NOT NULL DEFAULT 'DRAFT',
    "quoteDate" DATE NOT NULL,
    "validTill" DATE,
    "materialRequestId" TEXT,
    "supplierRef" TEXT,
    "remarks" TEXT,
    "netTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "erp_supplier_quotations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_supplier_quotation_lines" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "qty" DECIMAL(18,3) NOT NULL,
    "rate" DECIMAL(14,2) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "leadTimeDays" INTEGER,
    "materialRequestLineId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "erp_supplier_quotation_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_purchase_orders" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "status" "ErpDocStatus" NOT NULL DEFAULT 'DRAFT',
    "isClosed" BOOLEAN NOT NULL DEFAULT false,
    "orderDate" DATE NOT NULL,
    "scheduleDate" DATE,
    "projectId" TEXT,
    "supplierQuotationId" TEXT,
    "supplierRef" TEXT,
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

    CONSTRAINT "erp_purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_purchase_order_lines" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "description" TEXT,
    "qty" DECIMAL(18,3) NOT NULL,
    "rate" DECIMAL(14,2) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "gstRate" DECIMAL(5,2) NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "scheduleDate" DATE,
    "receivedQty" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "billedQty" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "materialRequestLineId" TEXT,
    "supplierQuotationLineId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "erp_purchase_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_purchase_receipts" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "status" "ErpDocStatus" NOT NULL DEFAULT 'DRAFT',
    "postingDate" DATE NOT NULL,
    "supplierDeliveryNote" TEXT,
    "projectId" TEXT,
    "remarks" TEXT,
    "netTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "erp_purchase_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_purchase_receipt_lines" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "orderLineId" TEXT,
    "qty" DECIMAL(18,3) NOT NULL,
    "rejectedQty" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "rate" DECIMAL(14,2) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "gstRate" DECIMAL(5,2) NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "billedQty" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "qualityInspectionId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "erp_purchase_receipt_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_purchase_invoices" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "status" "ErpDocStatus" NOT NULL DEFAULT 'DRAFT',
    "postingDate" DATE NOT NULL,
    "billNo" TEXT,
    "billDate" DATE,
    "dueDate" DATE,
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

    CONSTRAINT "erp_purchase_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_purchase_invoice_lines" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "itemId" TEXT,
    "description" TEXT NOT NULL,
    "qty" DECIMAL(18,3) NOT NULL,
    "rate" DECIMAL(14,2) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "gstRate" DECIMAL(5,2) NOT NULL,
    "orderLineId" TEXT,
    "receiptLineId" TEXT,
    "expenseAccountId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "erp_purchase_invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "erp_parties_clientId_idx" ON "erp_parties"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "erp_parties_companyId_kind_code_key" ON "erp_parties"("companyId", "kind", "code");

-- CreateIndex
CREATE UNIQUE INDEX "erp_parties_companyId_kind_name_key" ON "erp_parties"("companyId", "kind", "name");

-- CreateIndex
CREATE INDEX "erp_material_requests_companyId_status_idx" ON "erp_material_requests"("companyId", "status");

-- CreateIndex
CREATE INDEX "erp_material_requests_companyId_projectId_idx" ON "erp_material_requests"("companyId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "erp_material_requests_companyId_number_key" ON "erp_material_requests"("companyId", "number");

-- CreateIndex
CREATE INDEX "erp_material_request_lines_requestId_sortOrder_idx" ON "erp_material_request_lines"("requestId", "sortOrder");

-- CreateIndex
CREATE INDEX "erp_material_request_lines_itemId_idx" ON "erp_material_request_lines"("itemId");

-- CreateIndex
CREATE INDEX "erp_supplier_quotations_companyId_status_idx" ON "erp_supplier_quotations"("companyId", "status");

-- CreateIndex
CREATE INDEX "erp_supplier_quotations_materialRequestId_idx" ON "erp_supplier_quotations"("materialRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "erp_supplier_quotations_companyId_number_key" ON "erp_supplier_quotations"("companyId", "number");

-- CreateIndex
CREATE INDEX "erp_supplier_quotation_lines_quotationId_sortOrder_idx" ON "erp_supplier_quotation_lines"("quotationId", "sortOrder");

-- CreateIndex
CREATE INDEX "erp_supplier_quotation_lines_itemId_idx" ON "erp_supplier_quotation_lines"("itemId");

-- CreateIndex
CREATE INDEX "erp_purchase_orders_companyId_status_idx" ON "erp_purchase_orders"("companyId", "status");

-- CreateIndex
CREATE INDEX "erp_purchase_orders_companyId_supplierId_idx" ON "erp_purchase_orders"("companyId", "supplierId");

-- CreateIndex
CREATE INDEX "erp_purchase_orders_companyId_projectId_idx" ON "erp_purchase_orders"("companyId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "erp_purchase_orders_companyId_number_key" ON "erp_purchase_orders"("companyId", "number");

-- CreateIndex
CREATE INDEX "erp_purchase_order_lines_orderId_sortOrder_idx" ON "erp_purchase_order_lines"("orderId", "sortOrder");

-- CreateIndex
CREATE INDEX "erp_purchase_order_lines_itemId_idx" ON "erp_purchase_order_lines"("itemId");

-- CreateIndex
CREATE INDEX "erp_purchase_order_lines_materialRequestLineId_idx" ON "erp_purchase_order_lines"("materialRequestLineId");

-- CreateIndex
CREATE INDEX "erp_purchase_receipts_companyId_status_idx" ON "erp_purchase_receipts"("companyId", "status");

-- CreateIndex
CREATE INDEX "erp_purchase_receipts_companyId_supplierId_idx" ON "erp_purchase_receipts"("companyId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "erp_purchase_receipts_companyId_number_key" ON "erp_purchase_receipts"("companyId", "number");

-- CreateIndex
CREATE INDEX "erp_purchase_receipt_lines_receiptId_sortOrder_idx" ON "erp_purchase_receipt_lines"("receiptId", "sortOrder");

-- CreateIndex
CREATE INDEX "erp_purchase_receipt_lines_orderLineId_idx" ON "erp_purchase_receipt_lines"("orderLineId");

-- CreateIndex
CREATE INDEX "erp_purchase_receipt_lines_itemId_idx" ON "erp_purchase_receipt_lines"("itemId");

-- CreateIndex
CREATE INDEX "erp_purchase_invoices_companyId_status_idx" ON "erp_purchase_invoices"("companyId", "status");

-- CreateIndex
CREATE INDEX "erp_purchase_invoices_companyId_supplierId_idx" ON "erp_purchase_invoices"("companyId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "erp_purchase_invoices_companyId_number_key" ON "erp_purchase_invoices"("companyId", "number");

-- CreateIndex
CREATE INDEX "erp_purchase_invoice_lines_invoiceId_sortOrder_idx" ON "erp_purchase_invoice_lines"("invoiceId", "sortOrder");

-- CreateIndex
CREATE INDEX "erp_purchase_invoice_lines_receiptLineId_idx" ON "erp_purchase_invoice_lines"("receiptLineId");

-- CreateIndex
CREATE INDEX "erp_purchase_invoice_lines_orderLineId_idx" ON "erp_purchase_invoice_lines"("orderLineId");

-- AddForeignKey
ALTER TABLE "erp_material_request_lines" ADD CONSTRAINT "erp_material_request_lines_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "erp_material_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp_supplier_quotation_lines" ADD CONSTRAINT "erp_supplier_quotation_lines_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "erp_supplier_quotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp_purchase_order_lines" ADD CONSTRAINT "erp_purchase_order_lines_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "erp_purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp_purchase_receipt_lines" ADD CONSTRAINT "erp_purchase_receipt_lines_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "erp_purchase_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp_purchase_invoice_lines" ADD CONSTRAINT "erp_purchase_invoice_lines_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "erp_purchase_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
