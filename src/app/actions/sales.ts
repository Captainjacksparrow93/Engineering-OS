'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { SalesDealStage } from '@prisma/client';
import { requirePrincipal } from '@/core/auth/session';
import { drainOutbox } from '@/core/events/bus';
import { toState, value, type ActionState } from '@/core/utils/actions';
import { PRICE_SOURCES, type PriceSource } from '@/modules/sales/domain/pricing';
import { addPrice, createItem, importPrices, listItems, updateItem } from '@/modules/sales/services/catalog.service';
import { addContact, createAccount, removeContact, updateAccount, updateRelationship } from '@/modules/sales/services/account.service';
import { addActivity, closeDeal, completeActivity, createDeal, moveStage, updateDeal } from '@/modules/sales/services/deal.service';
import {
  addLine,
  applyLineMargins,
  applyMargin,
  approveQuote,
  createQuote,
  markQuoteSent,
  refreshPrices,
  removeLine,
  reviseQuote,
  sendBackQuote,
  submitQuote,
  updateLine,
  updateQuoteTerms,
} from '@/modules/sales/services/quote.service';
import { deleteHistoryImport, importHistory } from '@/modules/sales/services/history.service';
import { updateSalesSettings } from '@/modules/sales/services/settings.service';

/**
 * Sales write path for the UI. Each action authenticates, hands the raw form to a service
 * (which validates and authorises) and refreshes the affected pages. No rules live here.
 */

async function run(fn: () => Promise<unknown>, success = 'Saved.'): Promise<ActionState> {
  try {
    await fn();
    await drainOutbox().catch(() => undefined);
    return { success };
  } catch (error) {
    return toState(error);
  }
}

const id = (form: FormData, key: string) => String(form.get(key) ?? '');
const checkbox = (form: FormData, key: string) => form.get(key) === 'on' || form.get(key) === 'true';

function refreshSales(...paths: string[]) {
  for (const p of ['/sales', ...paths]) revalidatePath(p);
}

// ---------------------------------------------------------------- deals

export async function createDealAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  let createdId: string | null = null;
  const state = await run(async () => {
    const deal = await createDeal(principal, {
      title: value(form, 'title'),
      accountId: value(form, 'accountId') ?? null,
      newAccountName: value(form, 'newAccountName'),
      contactId: value(form, 'contactId'),
      value: value(form, 'value'),
      expectedCloseDate: value(form, 'expectedCloseDate') ?? '',
      source: value(form, 'source'),
      notes: value(form, 'notes'),
      ownerId: value(form, 'ownerId'),
    });
    createdId = deal.id;
  });
  if (!createdId) return state;
  refreshSales('/sales/deals');
  redirect(`/sales/deals/${createdId}`);
}

export async function updateDealAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  const dealId = id(form, 'dealId');
  const state = await run(() =>
    updateDeal(principal, dealId, {
      title: value(form, 'title'),
      contactId: value(form, 'contactId'),
      value: value(form, 'value'),
      expectedCloseDate: value(form, 'expectedCloseDate') ?? '',
      source: value(form, 'source'),
      notes: value(form, 'notes'),
      ownerId: value(form, 'ownerId'),
    }),
  );
  refreshSales(`/sales/deals/${dealId}`, '/sales/deals');
  return state;
}

export async function moveStageAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  const dealId = id(form, 'dealId');
  const state = await run(() => moveStage(principal, dealId, id(form, 'stage') as SalesDealStage), 'Stage updated.');
  refreshSales(`/sales/deals/${dealId}`, '/sales/deals');
  return state;
}

export async function closeDealAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  const dealId = id(form, 'dealId');
  const state = await run(
    () =>
      closeDeal(principal, dealId, {
        outcome: value(form, 'outcome'),
        lostReason: value(form, 'lostReason'),
        erpSalesOrder: value(form, 'erpSalesOrder'),
        woNumber: value(form, 'woNumber'),
      }),
    'Deal closed.',
  );
  refreshSales(`/sales/deals/${dealId}`, '/sales/deals');
  return state;
}

export async function addActivityAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  const dealId = id(form, 'dealId');
  const state = await run(() => addActivity(principal, dealId, { type: value(form, 'type'), note: value(form, 'note'), dueAt: value(form, 'dueAt') ?? '' }), 'Logged.');
  refreshSales(`/sales/deals/${dealId}`);
  return state;
}

export async function completeActivityAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  const state = await run(() => completeActivity(principal, id(form, 'activityId')), 'Done.');
  refreshSales(`/sales/deals/${id(form, 'dealId')}`);
  return state;
}

// ---------------------------------------------------------------- accounts

export async function createAccountAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  let createdId: string | null = null;
  const state = await run(async () => {
    const account = await createAccount(principal, { name: value(form, 'name'), city: value(form, 'city'), industry: value(form, 'industry'), clientRef: value(form, 'clientRef') });
    createdId = account.id;
  });
  if (!createdId) return state;
  refreshSales('/sales/accounts');
  redirect(`/sales/accounts/${createdId}`);
}

export async function updateAccountAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  const accountId = id(form, 'accountId');
  const state = await run(() =>
    updateAccount(principal, accountId, { name: value(form, 'name'), city: value(form, 'city'), industry: value(form, 'industry'), clientRef: value(form, 'clientRef'), notes: value(form, 'notes') }),
  );
  refreshSales(`/sales/accounts/${accountId}`, '/sales/accounts');
  return state;
}

export async function updateRelationshipAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  const accountId = id(form, 'accountId');
  const state = await run(() =>
    updateRelationship(principal, accountId, { strategic: checkbox(form, 'strategic'), paymentDelayDays: value(form, 'paymentDelayDays') ?? null, customerSince: value(form, 'customerSince') ?? '' }),
  );
  refreshSales(`/sales/accounts/${accountId}`, '/sales/accounts');
  return state;
}

export async function addContactAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  const accountId = id(form, 'accountId');
  const state = await run(() => addContact(principal, accountId, { name: value(form, 'name'), email: value(form, 'email'), phone: value(form, 'phone'), designation: value(form, 'designation') }), 'Contact added.');
  refreshSales(`/sales/accounts/${accountId}`);
  const dealId = value(form, 'dealId');
  if (dealId) revalidatePath(`/sales/deals/${dealId}`);
  return state;
}

export async function removeContactAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  const state = await run(() => removeContact(principal, id(form, 'contactId')), 'Contact removed.');
  refreshSales(`/sales/accounts/${id(form, 'accountId')}`);
  return state;
}

// ---------------------------------------------------------------- catalogue

export async function createItemAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  const state = await run(async () => {
    const item = await createItem(principal, itemFields(form));
    const rate = value(form, 'rate');
    if (rate) {
      await addPrice(principal, { itemId: item.id, source: value(form, 'source') ?? 'PURCHASE', rate, effectiveDate: value(form, 'effectiveDate') });
    }
  }, 'Item added.');
  refreshSales('/sales/catalog');
  return state;
}

const itemFields = (form: FormData) => ({
  code: value(form, 'code'),
  name: value(form, 'name'),
  make: value(form, 'make'),
  makerPartNo: value(form, 'makerPartNo'),
  category: value(form, 'category'),
  uom: value(form, 'uom') ?? 'Nos',
  erpItemCode: value(form, 'erpItemCode'),
});

export async function updateItemAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  const itemId = id(form, 'itemId');
  const state = await run(() => updateItem(principal, itemId, itemFields(form)));
  refreshSales('/sales/catalog', `/sales/catalog/${itemId}`);
  return state;
}

export async function addPriceAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  const itemId = id(form, 'itemId');
  const state = await run(
    () =>
      addPrice(principal, {
        itemId,
        source: value(form, 'source'),
        rate: value(form, 'rate') ?? null,
        listPrice: value(form, 'listPrice') ?? null,
        discountPct: value(form, 'discountPct') ?? null,
        supplier: value(form, 'supplier'),
        reference: value(form, 'reference'),
        effectiveDate: value(form, 'effectiveDate'),
      }),
    'Price added.',
  );
  refreshSales('/sales/catalog', `/sales/catalog/${itemId}`);
  return state;
}

async function fileText(form: FormData, key: string): Promise<string> {
  const file = form.get(key);
  if (file && typeof file === 'object' && 'text' in file) return (file as File).text();
  return String(file ?? '');
}

const plural = (n: number, word: string) => `${n.toLocaleString('en-IN')} ${word}${n === 1 ? '' : 's'}`;

export async function importPricesAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  try {
    const source = value(form, 'source');
    const result = await importPrices(principal, await fileText(form, 'file'), (PRICE_SOURCES as readonly string[]).includes(source ?? '') ? (source as PriceSource) : 'PRICE_LIST');
    refreshSales('/sales/catalog');
    if (result.errors.length) return { error: `Nothing imported. Fix these rows and try again:\n${result.errors.map((e) => `Row ${e.row}: ${e.message}`).join('\n')}` };
    return { success: `Imported ${plural(result.imported, 'price')} and added ${plural(result.itemsCreated, 'new item')}.` };
  } catch (error) {
    return toState(error);
  }
}

export async function searchItemsAction(q: string) {
  const principal = await requirePrincipal();
  const items = await listItems(principal, { q, take: 15 });
  return items.map((i) => ({ id: i.id, code: i.code, name: i.name, make: i.make, uom: i.uom, rate: i.price?.rate ?? null, stale: i.price?.stale ?? false, source: i.price?.source ?? null }));
}

// ---------------------------------------------------------------- quotes

export async function createQuoteAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  let createdId: string | null = null;
  const state = await run(async () => {
    const quote = await createQuote(principal, id(form, 'dealId'), { copyFromQuoteId: value(form, 'copyFromQuoteId') ?? null });
    createdId = quote.id;
  });
  if (!createdId) return state;
  refreshSales(`/sales/deals/${id(form, 'dealId')}`);
  redirect(`/sales/quotes/${createdId}`);
}

function refreshQuote(form: FormData) {
  refreshSales(`/sales/quotes/${id(form, 'quoteId')}`);
}

export async function addLineAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  const state = await run(
    () =>
      addLine(principal, id(form, 'quoteId'), {
        panel: value(form, 'panel'),
        itemId: value(form, 'itemId'),
        description: value(form, 'description'),
        uom: value(form, 'uom'),
        qty: value(form, 'qty') ?? 1,
        unitCost: value(form, 'unitCost') ?? null,
        marginPct: value(form, 'marginPct') ?? null,
      }),
    'Line added.',
  );
  refreshQuote(form);
  return state;
}

/** Called from the BOM grid when a cell changes. Exactly one of qty / marginPct / unitPrice / unitCost / description / panel. */
export async function updateLineAction(quoteId: string, lineId: string, field: 'qty' | 'marginPct' | 'unitPrice' | 'unitCost' | 'description' | 'panel', raw: string): Promise<ActionState> {
  const principal = await requirePrincipal();
  const state = await run(() => updateLine(principal, lineId, { [field]: raw }));
  revalidatePath(`/sales/quotes/${quoteId}`);
  return state;
}

export async function removeLineAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  const state = await run(() => removeLine(principal, id(form, 'lineId')), 'Line removed.');
  refreshQuote(form);
  return state;
}

export async function applyMarginAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  const state = await run(() => applyMargin(principal, id(form, 'quoteId'), Number(value(form, 'marginPct')), value(form, 'panel') ?? null), 'Margin applied.');
  refreshQuote(form);
  return state;
}

export async function applyLineAdviceAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  const margins = form.getAll('advice').map((raw) => {
    const [lineId, pct] = String(raw).split(':');
    return { lineId: lineId!, marginPct: Number(pct) };
  });
  const state = await run(() => applyLineMargins(principal, id(form, 'quoteId'), margins), 'Advice applied.');
  refreshQuote(form);
  return state;
}

export async function refreshPricesAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  try {
    const changed = await refreshPrices(principal, id(form, 'quoteId'));
    refreshQuote(form);
    return { success: changed ? `Updated ${plural(changed, 'line')} to the latest price.` : 'All lines already use the latest price.' };
  } catch (error) {
    return toState(error);
  }
}

export async function updateQuoteTermsAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  const state = await run(() =>
    updateQuoteTerms(principal, id(form, 'quoteId'), {
      discountPct: value(form, 'discountPct') ?? 0,
      freight: value(form, 'freight') ?? 0,
      validUntil: value(form, 'validUntil'),
      terms: String(form.get('terms') ?? ''),
      showLineItems: checkbox(form, 'showLineItems'),
    }),
  );
  refreshQuote(form);
  return state;
}

export async function submitQuoteAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  try {
    const quote = await submitQuote(principal, id(form, 'quoteId'));
    await drainOutbox().catch(() => undefined);
    refreshQuote(form);
    revalidatePath('/sales/approvals');
    return { success: quote.status === 'APPROVED' ? 'Approved. You can send it now.' : 'Sent to a Director for approval.' };
  } catch (error) {
    return toState(error);
  }
}

export async function approveQuoteAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  const state = await run(() => approveQuote(principal, id(form, 'quoteId'), value(form, 'note') ?? null), 'Approved.');
  refreshQuote(form);
  revalidatePath('/sales/approvals');
  return state;
}

export async function sendBackQuoteAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  const state = await run(() => sendBackQuote(principal, id(form, 'quoteId'), value(form, 'note') ?? ''), 'Sent back to the salesperson.');
  refreshQuote(form);
  revalidatePath('/sales/approvals');
  return state;
}

export async function reviseQuoteAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  let createdId: string | null = null;
  const state = await run(async () => {
    createdId = (await reviseQuote(principal, id(form, 'quoteId'))).id;
  });
  if (!createdId) return state;
  refreshQuote(form);
  redirect(`/sales/quotes/${createdId}`);
}

export async function markSentAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  const state = await run(() => markQuoteSent(principal, id(form, 'quoteId')), 'Marked as sent. A follow-up is on your list.');
  refreshQuote(form);
  return state;
}

// ---------------------------------------------------------------- history + settings

export async function importHistoryAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  try {
    const result = await importHistory(principal, await fileText(form, 'file'));
    revalidatePath('/sales/history');
    if (result.errors.length) return { error: `Nothing imported. Fix these rows and try again:\n${result.errors.map((e) => (e.row ? `Row ${e.row}: ${e.message}` : e.message)).join('\n')}` };
    return { success: `Imported ${plural(result.refs, 'past quote')} (${plural(result.lines, 'line')}) and added ${plural(result.accountsCreated, 'new client')}.` };
  } catch (error) {
    return toState(error);
  }
}

export async function deleteHistoryImportAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  const state = await run(() => deleteHistoryImport(principal, id(form, 'batchId')), 'Import deleted.');
  revalidatePath('/sales/history');
  return state;
}

export async function updateSettingsAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  const state = await run(() =>
    updateSalesSettings(principal, {
      targetMarginPct: Number(value(form, 'targetMarginPct')),
      minMarginPct: Number(value(form, 'minMarginPct')),
      gstPct: Number(value(form, 'gstPct')),
      priceStaleDays: Number(value(form, 'priceStaleDays')),
      pricePriority: form.getAll('pricePriority').map(String).filter(Boolean) as PriceSource[],
      quoteValidityDays: Number(value(form, 'quoteValidityDays')),
      followUpDays: Number(value(form, 'followUpDays')),
      terms: String(form.get('terms') ?? ''),
    }),
  );
  revalidatePath('/sales/settings');
  return state;
}
