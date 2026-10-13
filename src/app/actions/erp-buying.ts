'use server';

import { requirePrincipal } from '@/core/auth/session';
import type { ActionState } from '@/core/utils/actions';
import { createParty, setPartyActive, updateParty } from '@/modules/erp/services/party.service';
import {
  addMaterialRequestLine,
  cancelMaterialRequest,
  createMaterialRequest,
  createReorderRequest,
  deleteMaterialRequest,
  makeStockEntryFromRequest,
  removeMaterialRequestLine,
  setMaterialRequestStopped,
  submitMaterialRequest,
  updateMaterialRequest,
} from '@/modules/erp/services/material-request.service';
import {
  addSupplierQuotationLine,
  cancelSupplierQuotation,
  createSupplierQuotation,
  deleteSupplierQuotation,
  removeSupplierQuotationLine,
  submitSupplierQuotation,
  updateSupplierQuotationLine,
} from '@/modules/erp/services/supplier-quotation.service';
import {
  addPurchaseOrderLine,
  cancelPurchaseOrder,
  createPurchaseOrder,
  deletePurchaseOrder,
  makePurchaseOrderFromQuotation,
  makePurchaseOrderFromRequest,
  removePurchaseOrderLine,
  setPurchaseOrderClosed,
  submitPurchaseOrder,
  updatePurchaseOrder,
  updatePurchaseOrderLine,
} from '@/modules/erp/services/purchase-order.service';
import {
  addPurchaseReceiptLine,
  cancelPurchaseReceipt,
  createPurchaseReceipt,
  deletePurchaseReceipt,
  makeReceiptFromOrder,
  removePurchaseReceiptLine,
  submitPurchaseReceipt,
  updatePurchaseReceipt,
  updatePurchaseReceiptLine,
} from '@/modules/erp/services/purchase-receipt.service';
import {
  addExpenseLine,
  cancelPurchaseInvoice,
  createPurchaseInvoice,
  deletePurchaseInvoice,
  makeInvoiceFromOrder,
  makeInvoiceFromReceipt,
  removePurchaseInvoiceLine,
  submitPurchaseInvoice,
  updatePurchaseInvoice,
  updatePurchaseInvoiceLine,
} from '@/modules/erp/services/purchase-invoice.service';
import { field, fields, run, runAndOpen } from './erp-common';

const id = (form: FormData, key = 'id') => field(form, key) ?? '';
const today = () => new Date(`${new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10)}T00:00:00Z`);
const dateField = (form: FormData) => {
  const v = field(form, 'date');
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00Z`) : today();
};

// ---------------------------------------------------------------- suppliers

export async function createSupplierAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return runAndOpen(() => createParty(p, 'SUPPLIER', fields(form)), (x) => `/erp/buying/suppliers/${x}`);
}
export async function updateSupplierAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => updateParty(p, 'SUPPLIER', id(form), fields(form)), 'Supplier saved.');
}
export async function setSupplierActiveAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => setPartyActive(p, 'SUPPLIER', id(form), field(form, 'active') === 'true'), 'Saved.');
}

// ---------------------------------------------------------------- material requests

export async function createMaterialRequestAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return runAndOpen(() => createMaterialRequest(p, fields(form)), (x) => `/erp/buying/requests/${x}`);
}
export async function updateMaterialRequestAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => updateMaterialRequest(p, id(form), fields(form)), 'Saved.');
}
export async function addMaterialRequestLineAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => addMaterialRequestLine(p, id(form), fields(form)), 'Line added.');
}
export async function removeMaterialRequestLineAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => removeMaterialRequestLine(p, id(form), id(form, 'lineId')), 'Line removed.');
}
export async function submitMaterialRequestAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => submitMaterialRequest(p, id(form)), 'Submitted.');
}
export async function cancelMaterialRequestAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => cancelMaterialRequest(p, id(form)), 'Cancelled.');
}
export async function stopMaterialRequestAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  const stop = field(form, 'stop') === 'true';
  return run(() => setMaterialRequestStopped(p, id(form), stop), stop ? 'Stopped.' : 'Re-opened.');
}
export async function deleteMaterialRequestAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return runAndOpen(async () => {
    await deleteMaterialRequest(p, id(form));
    return { id: '' };
  }, () => '/erp/buying/requests');
}
export async function reorderRequestAction(_prev: ActionState, _form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return runAndOpen(() => createReorderRequest(p, today()), (x) => `/erp/buying/requests/${x}`);
}
export async function stockEntryFromRequestAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return runAndOpen(() => makeStockEntryFromRequest(p, id(form), today()), (x) => `/erp/stock/entries/${x}`);
}
export async function orderFromRequestAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return runAndOpen(() => makePurchaseOrderFromRequest(p, id(form), id(form, 'supplierId'), today()), (x) => `/erp/buying/orders/${x}`);
}
export async function quotationFromRequestAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return runAndOpen(() => createSupplierQuotation(p, { supplierId: id(form, 'supplierId'), quoteDate: today().toISOString().slice(0, 10), materialRequestId: id(form) }), (x) => `/erp/buying/quotations/${x}`);
}

// ---------------------------------------------------------------- supplier quotations

export async function createSupplierQuotationAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return runAndOpen(() => createSupplierQuotation(p, fields(form)), (x) => `/erp/buying/quotations/${x}`);
}
export async function addSupplierQuotationLineAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => addSupplierQuotationLine(p, id(form), fields(form)), 'Line added.');
}
export async function updateSupplierQuotationLineAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => updateSupplierQuotationLine(p, id(form), id(form, 'lineId'), fields(form)), 'Saved.');
}
export async function removeSupplierQuotationLineAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => removeSupplierQuotationLine(p, id(form), id(form, 'lineId')), 'Line removed.');
}
export async function submitSupplierQuotationAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => submitSupplierQuotation(p, id(form)), 'Submitted.');
}
export async function cancelSupplierQuotationAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => cancelSupplierQuotation(p, id(form)), 'Cancelled.');
}
export async function deleteSupplierQuotationAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return runAndOpen(async () => {
    await deleteSupplierQuotation(p, id(form));
    return { id: '' };
  }, () => '/erp/buying/quotations');
}
export async function orderFromQuotationAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return runAndOpen(() => makePurchaseOrderFromQuotation(p, id(form), today()), (x) => `/erp/buying/orders/${x}`);
}

// ---------------------------------------------------------------- purchase orders

export async function createPurchaseOrderAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return runAndOpen(() => createPurchaseOrder(p, fields(form)), (x) => `/erp/buying/orders/${x}`);
}
export async function updatePurchaseOrderAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => updatePurchaseOrder(p, id(form), fields(form)), 'Saved.');
}
export async function addPurchaseOrderLineAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => addPurchaseOrderLine(p, id(form), fields(form)), 'Line added.');
}
export async function updatePurchaseOrderLineAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => updatePurchaseOrderLine(p, id(form), id(form, 'lineId'), fields(form)), 'Saved.');
}
export async function removePurchaseOrderLineAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => removePurchaseOrderLine(p, id(form), id(form, 'lineId')), 'Line removed.');
}
export async function submitPurchaseOrderAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => submitPurchaseOrder(p, id(form)), 'Submitted. The supplier can be sent the order.');
}
export async function cancelPurchaseOrderAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => cancelPurchaseOrder(p, id(form)), 'Cancelled.');
}
export async function closePurchaseOrderAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  const close = field(form, 'close') === 'true';
  return run(() => setPurchaseOrderClosed(p, id(form), close), close ? 'Closed.' : 'Re-opened.');
}
export async function deletePurchaseOrderAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return runAndOpen(async () => {
    await deletePurchaseOrder(p, id(form));
    return { id: '' };
  }, () => '/erp/buying/orders');
}
export async function receiptFromOrderAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return runAndOpen(() => makeReceiptFromOrder(p, id(form), dateField(form)), (x) => `/erp/buying/receipts/${x}`);
}
export async function invoiceFromOrderAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return runAndOpen(() => makeInvoiceFromOrder(p, id(form), dateField(form)), (x) => `/erp/buying/invoices/${x}`);
}

// ---------------------------------------------------------------- purchase receipts

export async function createPurchaseReceiptAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return runAndOpen(() => createPurchaseReceipt(p, id(form, 'supplierId'), fields(form)), (x) => `/erp/buying/receipts/${x}`);
}
export async function updatePurchaseReceiptAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => updatePurchaseReceipt(p, id(form), fields(form)), 'Saved.');
}
export async function addPurchaseReceiptLineAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => addPurchaseReceiptLine(p, id(form), fields(form)), 'Line added.');
}
export async function updatePurchaseReceiptLineAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => updatePurchaseReceiptLine(p, id(form), id(form, 'lineId'), fields(form)), 'Saved.');
}
export async function removePurchaseReceiptLineAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => removePurchaseReceiptLine(p, id(form), id(form, 'lineId')), 'Line removed.');
}
export async function submitPurchaseReceiptAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => submitPurchaseReceipt(p, id(form)), 'Submitted. Stock and accounts are updated.');
}
export async function cancelPurchaseReceiptAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => cancelPurchaseReceipt(p, id(form)), 'Cancelled.');
}
export async function deletePurchaseReceiptAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return runAndOpen(async () => {
    await deletePurchaseReceipt(p, id(form));
    return { id: '' };
  }, () => '/erp/buying/receipts');
}
export async function invoiceFromReceiptAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return runAndOpen(() => makeInvoiceFromReceipt(p, id(form), dateField(form)), (x) => `/erp/buying/invoices/${x}`);
}

// ---------------------------------------------------------------- purchase invoices

export async function createPurchaseInvoiceAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return runAndOpen(() => createPurchaseInvoice(p, id(form, 'supplierId'), fields(form)), (x) => `/erp/buying/invoices/${x}`);
}
export async function updatePurchaseInvoiceAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => updatePurchaseInvoice(p, id(form), fields(form)), 'Saved.');
}
export async function addExpenseLineAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => addExpenseLine(p, id(form), fields(form)), 'Line added.');
}
export async function updatePurchaseInvoiceLineAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => updatePurchaseInvoiceLine(p, id(form), id(form, 'lineId'), fields(form)), 'Saved.');
}
export async function removePurchaseInvoiceLineAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => removePurchaseInvoiceLine(p, id(form), id(form, 'lineId')), 'Line removed.');
}
export async function submitPurchaseInvoiceAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => submitPurchaseInvoice(p, id(form)), 'Submitted. The supplier balance is updated.');
}
export async function cancelPurchaseInvoiceAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => cancelPurchaseInvoice(p, id(form)), 'Cancelled.');
}
export async function deletePurchaseInvoiceAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return runAndOpen(async () => {
    await deletePurchaseInvoice(p, id(form));
    return { id: '' };
  }, () => '/erp/buying/invoices');
}
