import { DomainError } from '@/core/rbac/errors';
import type { Principal } from '@/core/rbac/types';
import { type Cell, toCsv } from '../domain/csv';
import { listAssets, ASSET_STATUS_LABEL } from './asset.service';
import { listItems } from './item.service';
import { listPayments, PAYMENT_TYPE_LABEL } from './payment.service';
import { listPurchaseInvoices } from './purchase-invoice.service';
import { ageing, AGEING_BUCKETS, generalLedger, projectProfitability, trialBalance } from './reports.service';
import { listSalesInvoices } from './sales-invoice.service';
import { stockBalance } from './stock-report.service';

/**
 * CSV downloads of ERP lists and reports. Each export calls the same service as its screen,
 * so the same permission check applies.
 */

export const EXPORTS = ['items', 'stock-balance', 'sales-invoices', 'purchase-invoices', 'payments', 'general-ledger', 'trial-balance', 'receivables', 'payables', 'projects', 'assets'] as const;
export type ExportName = (typeof EXPORTS)[number];

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const day = (s: string | null | undefined, fallback: Date) => (s && ISO.test(s) ? new Date(`${s}T00:00:00.000Z`) : fallback);

export async function exportCsv(p: Principal, name: string, q: URLSearchParams): Promise<{ filename: string; body: string }> {
  if (!(EXPORTS as readonly string[]).includes(name)) throw new DomainError('Unknown export.');
  const today = new Date(`${new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10)}T00:00:00.000Z`);
  const fyStart = new Date(Date.UTC(today.getUTCMonth() >= 3 ? today.getUTCFullYear() : today.getUTCFullYear() - 1, 3, 1));
  const from = day(q.get('from'), fyStart);
  const to = day(q.get('to'), today);
  let rows: Cell[][];
  switch (name as ExportName) {
    case 'items': {
      const items = await listItems(p, { includeInactive: true });
      rows = [['Code', 'Name', 'Group', 'Unit', 'HSN', 'Make', 'Part no.', 'GST %', 'Selling rate', 'Stock qty', 'Stock value', 'Reorder level', 'Active'], ...items.map((i) => [i.code, i.name, i.itemGroup, i.uom, i.hsnCode, i.make, i.makerPartNo, i.gstRate, i.standardRate, i.stockQty, i.stockValue, i.reorderLevel, i.isActive])];
      break;
    }
    case 'stock-balance': {
      const { rows: bins } = await stockBalance(p, { warehouseId: q.get('warehouse') });
      rows = [['Item', 'Name', 'Warehouse', 'Actual', 'Reserved', 'Ordered', 'Requested', 'Planned', 'Projected', 'Valuation rate', 'Value'], ...bins.map((b) => [b.item.code, b.item.name, b.warehouse.name, b.actualQty, b.reservedQty, b.orderedQty, b.requestedQty, b.plannedQty, b.projectedQty, b.valuationRate, b.stockValue])];
      break;
    }
    case 'sales-invoices': {
      const list = await listSalesInvoices(p, { status: q.get('status'), today });
      rows = [['Invoice', 'Date', 'Customer', 'Return', 'Net', 'CGST', 'SGST', 'IGST', 'Total', 'Outstanding', 'Due', 'Status'], ...list.map((i) => [i.number, i.postingDate, i.customerName, i.isReturn, i.netTotal, i.cgst, i.sgst, i.igst, i.grandTotal, i.outstandingAmount, i.dueDate, i.state.label])];
      break;
    }
    case 'purchase-invoices': {
      const list = await listPurchaseInvoices(p, { status: q.get('status'), today });
      rows = [['Invoice', 'Date', 'Supplier', 'Bill no.', 'Return', 'Net', 'CGST', 'SGST', 'IGST', 'Total', 'Outstanding', 'Due', 'Status'], ...list.map((i) => [i.number, i.postingDate, i.supplierName, i.billNo, i.isReturn, i.netTotal, i.cgst, i.sgst, i.igst, i.grandTotal, i.outstandingAmount, i.dueDate, i.state.label])];
      break;
    }
    case 'payments': {
      const list = await listPayments(p, { status: q.get('status') });
      rows = [['Payment', 'Date', 'Type', 'Party', 'Account', 'Reference', 'Amount', 'Unallocated', 'Cleared', 'Status'], ...list.map((x) => [x.number, x.postingDate, PAYMENT_TYPE_LABEL[x.paymentType], x.partyName ?? x.transferToName, x.accountName, x.referenceNo, x.amount, x.unallocatedAmount, x.clearanceDate, x.status])];
      break;
    }
    case 'general-ledger': {
      const [partyType, partyId] = (q.get('party') ?? '').split('|');
      const gl = await generalLedger(p, { from, to, accountId: q.get('account'), partyType: partyType === 'CUSTOMER' || partyType === 'SUPPLIER' ? partyType : null, partyId: partyId || null, projectId: q.get('projectId'), voucherNo: q.get('voucher') });
      rows = [['Date', 'Voucher type', 'Voucher', 'Account code', 'Account', 'Party', 'Remarks', 'Debit', 'Credit', 'Balance'], ['', '', '', '', 'Opening', '', '', '', '', gl.opening], ...gl.lines.map((l) => [l.postingDate, l.voucherType, l.voucherNo, l.account.code, l.account.name, l.partyName, l.remarks, l.debit, l.credit, l.balance])];
      break;
    }
    case 'trial-balance': {
      const tb = await trialBalance(p, { from, to });
      rows = [['Code', 'Account', 'Group', 'Opening Dr', 'Opening Cr', 'Debit', 'Credit', 'Closing Dr', 'Closing Cr'], ...tb.rows.map((r) => [r.account.code, `${'  '.repeat(r.depth)}${r.account.name}`, r.account.isGroup, ...r.values])];
      break;
    }
    case 'receivables':
    case 'payables': {
      const a = await ageing(p, name === 'receivables' ? 'RECEIVABLE' : 'PAYABLE', today);
      rows = [['Party', ...AGEING_BUCKETS, 'Total', 'Credit', 'Net'], ...a.rows.map((r) => [r.name, ...r.buckets, r.total, r.credit, r.net])];
      break;
    }
    case 'projects': {
      const list = await projectProfitability(p, { from, to });
      rows = [['Project', 'Name', 'Client', 'Income', 'Cost', 'Profit', 'Margin %'], ...list.map((x) => [x.project.code, x.project.name, x.project.clientName, x.income, x.cost, x.profit, x.margin])];
      break;
    }
    case 'assets': {
      const list = await listAssets(p, { status: q.get('status') });
      rows = [['Asset', 'Name', 'Category', 'Serial no.', 'Location', 'Purchased', 'Value', 'Book value', 'Status'], ...list.map((a) => [a.number, a.name, a.categoryName, a.serialNo, a.location, a.purchaseDate, a.grossValue, a.bookValue, ASSET_STATUS_LABEL[a.status]])];
      break;
    }
  }
  return { filename: `${name}-${to.toISOString().slice(0, 10)}.csv`, body: toCsv(rows) };
}
