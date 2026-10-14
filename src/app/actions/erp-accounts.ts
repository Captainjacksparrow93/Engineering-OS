'use server';

import { requirePrincipal } from '@/core/auth/session';
import { DomainError } from '@/core/rbac/errors';
import type { ActionState } from '@/core/utils/actions';
import {
  addAllocation,
  allocateOutstanding,
  cancelPayment,
  createPayment,
  createPaymentForInvoice,
  deletePayment,
  reconcileAdvance,
  removeAllocation,
  submitPayment,
  updatePayment,
} from '@/modules/erp/services/payment.service';
import { addJournalLine, cancelJournal, createJournal, deleteJournal, removeJournalLine, submitJournal, updateJournal } from '@/modules/erp/services/journal.service';
import { closeFiscalYear, createAccount, renameAccount, reopenFiscalYear, setAccountActive, setBooksLock, setClearance } from '@/modules/erp/services/ledger.service';
import { makeCreditNote } from '@/modules/erp/services/sales-invoice.service';
import { makeDebitNote } from '@/modules/erp/services/purchase-invoice.service';
import type { InvoiceType } from '@/modules/erp/services/outstanding';
import { field, fields, run, runAndOpen } from './erp-common';

const id = (form: FormData, key = 'id') => field(form, key) ?? '';
const date = (form: FormData, key: string) => {
  const v = field(form, key) ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new DomainError('Pick a date.');
  return new Date(`${v}T00:00:00.000Z`);
};
const today = () => new Date(`${new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10)}T00:00:00.000Z`);
const invoiceType = (form: FormData): InvoiceType => (field(form, 'invoiceType') === 'Purchase Invoice' ? 'Purchase Invoice' : 'Sales Invoice');

/** The party picker posts "CUSTOMER|id" or "SUPPLIER|id". */
function paymentFields(form: FormData) {
  const out = fields(form);
  const [partyType, partyId] = (out.party ?? '').split('|');
  return { ...out, partyType: partyType ?? '', partyId: partyId ?? '' };
}

// ---------------------------------------------------------------- payments

export async function createPaymentAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return runAndOpen(() => createPayment(p, paymentFields(form)), (x) => `/erp/accounts/payments/${x}`);
}
export async function createPaymentForInvoiceAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return runAndOpen(() => createPaymentForInvoice(p, invoiceType(form), id(form, 'invoiceId'), today()), (x) => `/erp/accounts/payments/${x}`);
}
export async function updatePaymentAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => updatePayment(p, id(form), paymentFields(form)), 'Payment saved.');
}
export async function deletePaymentAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return runAndOpen(async () => {
    await deletePayment(p, id(form));
    return { id: '' };
  }, () => '/erp/accounts/payments');
}
export async function submitPaymentAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => submitPayment(p, id(form)), 'Payment submitted.');
}
export async function cancelPaymentAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => cancelPayment(p, id(form)), 'Payment cancelled. Its invoices are open again.');
}
export async function addAllocationAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => addAllocation(p, id(form), fields(form)), 'Allocated.');
}
export async function removeAllocationAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => removeAllocation(p, id(form), id(form, 'allocationId')), 'Removed.');
}
export async function allocateOutstandingAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => allocateOutstanding(p, id(form)), 'Allocated to the oldest open invoices.');
}
export async function reconcileAdvanceAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => reconcileAdvance(p, id(form), fields(form), today()), 'Advance applied.');
}

// ---------------------------------------------------------------- returns

export async function makeCreditNoteAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return runAndOpen(() => makeCreditNote(p, id(form), today()), (x) => `/erp/selling/invoices/${x}`);
}
export async function makeDebitNoteAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return runAndOpen(() => makeDebitNote(p, id(form), today()), (x) => `/erp/buying/invoices/${x}`);
}

// ---------------------------------------------------------------- journals

export async function createJournalAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return runAndOpen(() => createJournal(p, fields(form)), (x) => `/erp/accounts/journals/${x}`);
}
export async function updateJournalAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => updateJournal(p, id(form), fields(form)), 'Saved.');
}
export async function addJournalLineAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => addJournalLine(p, id(form), paymentFields(form)), 'Line added.');
}
export async function removeJournalLineAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => removeJournalLine(p, id(form), id(form, 'lineId')), 'Removed.');
}
export async function submitJournalAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => submitJournal(p, id(form)), 'Journal entry submitted.');
}
export async function cancelJournalAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => cancelJournal(p, id(form)), 'Journal entry cancelled.');
}
export async function deleteJournalAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return runAndOpen(async () => {
    await deleteJournal(p, id(form));
    return { id: '' };
  }, () => '/erp/accounts/journals');
}

// ---------------------------------------------------------------- books

export async function setClearanceAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => setClearance(p, field(form, 'kind') === 'journal' ? 'journal' : 'payment', id(form), field(form, 'clearanceDate') || null), 'Saved.');
}
export async function createAccountAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => createAccount(p, fields(form)), 'Account added.');
}
export async function renameAccountAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => renameAccount(p, id(form), field(form, 'name') ?? ''), 'Renamed.');
}
export async function setAccountActiveAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => setAccountActive(p, id(form), field(form, 'active') === '1'), 'Saved.');
}
export async function closeFiscalYearAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(async () => closeFiscalYear(p, date(form, 'yearEnd'), field(form, 'remarks')), 'Year closed. Its profit is in Retained Earnings and the books are locked.');
}
export async function reopenFiscalYearAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => reopenFiscalYear(p, id(form)), 'Year re-opened.');
}
export async function setBooksLockAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => setBooksLock(p, field(form, 'upTo') || null), 'Saved.');
}
