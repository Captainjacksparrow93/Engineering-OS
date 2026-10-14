'use server';

import { requirePrincipal } from '@/core/auth/session';
import type { ActionState } from '@/core/utils/actions';
import { createParty, setPartyActive, updateParty } from '@/modules/erp/services/party.service';
import {
  addSalesOrderLine,
  cancelSalesOrder,
  createSalesOrder,
  deleteSalesOrder,
  removeSalesOrderLine,
  setSalesOrderClosed,
  setSalesOrderOnHold,
  submitSalesOrder,
  updateSalesOrder,
  updateSalesOrderLine,
  updateSubmittedSalesOrder,
} from '@/modules/erp/services/sales-order.service';
import {
  cancelDeliveryNote,
  deleteDeliveryNote,
  makeDeliveryFromOrder,
  removeDeliveryLine,
  submitDeliveryNote,
  updateDeliveryLine,
  updateDeliveryNote,
} from '@/modules/erp/services/delivery-note.service';
import {
  addIncomeLine,
  cancelSalesInvoice,
  createSalesInvoice,
  deleteSalesInvoice,
  makeInvoiceFromDelivery,
  makeInvoiceFromSalesOrder,
  removeSalesInvoiceLine,
  submitSalesInvoice,
  updateSalesInvoice,
  updateSalesInvoiceLine,
} from '@/modules/erp/services/sales-invoice.service';
import { field, fields, run, runAndOpen } from './erp-common';

const id = (form: FormData, key = 'id') => field(form, key) ?? '';
const today = () => new Date(`${new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10)}T00:00:00Z`);

export async function createCustomerAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return runAndOpen(() => createParty(p, 'CUSTOMER', fields(form)), (x) => `/erp/selling/customers/${x}`);
}
export async function updateCustomerAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => updateParty(p, 'CUSTOMER', id(form), fields(form)), 'Customer saved.');
}
export async function setCustomerActiveAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => setPartyActive(p, 'CUSTOMER', id(form), field(form, 'active') === 'true'), 'Saved.');
}

export async function createSalesOrderAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return runAndOpen(() => createSalesOrder(p, fields(form)), (x) => `/erp/selling/orders/${x}`);
}
export async function updateSalesOrderAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => updateSalesOrder(p, id(form), fields(form)), 'Saved.');
}
export async function updateSubmittedSalesOrderAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => updateSubmittedSalesOrder(p, id(form), fields(form)), 'Saved. The project picks this up next time it is opened.');
}
export async function addSalesOrderLineAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => addSalesOrderLine(p, id(form), fields(form)), 'Line added.');
}
export async function updateSalesOrderLineAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => updateSalesOrderLine(p, id(form), id(form, 'lineId'), fields(form)), 'Saved.');
}
export async function removeSalesOrderLineAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => removeSalesOrderLine(p, id(form), id(form, 'lineId')), 'Line removed.');
}
export async function submitSalesOrderAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => submitSalesOrder(p, id(form)), 'Submitted. It now waits for a project in New project.');
}
export async function cancelSalesOrderAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => cancelSalesOrder(p, id(form)), 'Cancelled.');
}
export async function closeSalesOrderAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  const close = field(form, 'close') === 'true';
  return run(() => setSalesOrderClosed(p, id(form), close), close ? 'Closed.' : 'Re-opened.');
}
export async function holdSalesOrderAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  const hold = field(form, 'hold') === 'true';
  return run(() => setSalesOrderOnHold(p, id(form), hold), hold ? 'On hold.' : 'Released.');
}
export async function deleteSalesOrderAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return runAndOpen(async () => {
    await deleteSalesOrder(p, id(form));
    return { id: '' };
  }, () => '/erp/selling/orders');
}
export async function deliveryFromOrderAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return runAndOpen(() => makeDeliveryFromOrder(p, id(form), today()), (x) => `/erp/selling/deliveries/${x}`);
}
export async function invoiceFromSalesOrderAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return runAndOpen(() => makeInvoiceFromSalesOrder(p, id(form), today()), (x) => `/erp/selling/invoices/${x}`);
}

export async function updateDeliveryNoteAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => updateDeliveryNote(p, id(form), fields(form)), 'Saved.');
}
export async function updateDeliveryLineAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => updateDeliveryLine(p, id(form), id(form, 'lineId'), fields(form)), 'Saved.');
}
export async function removeDeliveryLineAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => removeDeliveryLine(p, id(form), id(form, 'lineId')), 'Line removed.');
}
export async function submitDeliveryNoteAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => submitDeliveryNote(p, id(form)), 'Submitted. Stock and accounts are updated.');
}
export async function cancelDeliveryNoteAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => cancelDeliveryNote(p, id(form)), 'Cancelled.');
}
export async function deleteDeliveryNoteAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return runAndOpen(async () => {
    await deleteDeliveryNote(p, id(form));
    return { id: '' };
  }, () => '/erp/selling/deliveries');
}
export async function invoiceFromDeliveryAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return runAndOpen(() => makeInvoiceFromDelivery(p, id(form), today()), (x) => `/erp/selling/invoices/${x}`);
}

export async function createSalesInvoiceAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return runAndOpen(() => createSalesInvoice(p, id(form, 'customerId'), fields(form)), (x) => `/erp/selling/invoices/${x}`);
}
export async function updateSalesInvoiceAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => updateSalesInvoice(p, id(form), fields(form)), 'Saved.');
}
export async function addIncomeLineAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => addIncomeLine(p, id(form), fields(form)), 'Line added.');
}
export async function updateSalesInvoiceLineAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => updateSalesInvoiceLine(p, id(form), id(form, 'lineId'), fields(form)), 'Saved.');
}
export async function removeSalesInvoiceLineAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => removeSalesInvoiceLine(p, id(form), id(form, 'lineId')), 'Line removed.');
}
export async function submitSalesInvoiceAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => submitSalesInvoice(p, id(form)), 'Submitted. The customer balance is updated.');
}
export async function cancelSalesInvoiceAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => cancelSalesInvoice(p, id(form)), 'Cancelled.');
}
export async function deleteSalesInvoiceAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return runAndOpen(async () => {
    await deleteSalesInvoice(p, id(form));
    return { id: '' };
  }, () => '/erp/selling/invoices');
}
