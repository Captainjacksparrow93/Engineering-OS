'use server';

import { requirePrincipal } from '@/core/auth/session';
import type { ActionState } from '@/core/utils/actions';
import { createItem, createWarehouse, renameWarehouse, setItemActive, setWarehouseActive, updateItem } from '@/modules/erp/services/item.service';
import {
  addStockEntryLine,
  cancelStockEntry,
  createStockEntry,
  deleteStockEntry,
  removeStockEntryLine,
  submitStockEntry,
  updateStockEntry,
} from '@/modules/erp/services/stock-entry.service';
import {
  addReconciliationLine,
  cancelReconciliation,
  createReconciliation,
  deleteReconciliation,
  removeReconciliationLine,
  submitReconciliation,
} from '@/modules/erp/services/reconciliation.service';
import { updateSettings } from '@/modules/erp/services/settings.service';
import { field, fields, run, runAndOpen } from './erp-common';

// ---------------------------------------------------------------- items and warehouses

export async function createItemAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return runAndOpen(() => createItem(p, fields(form)), (id) => `/erp/stock/items/${id}`);
}

export async function updateItemAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => updateItem(p, field(form, 'itemId') ?? '', fields(form)), 'Item saved.');
}

export async function setItemActiveAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  const active = field(form, 'active') === 'true';
  return run(() => setItemActive(p, field(form, 'itemId') ?? '', active), active ? 'Item switched on.' : 'Item switched off.');
}

export async function createWarehouseAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => createWarehouse(p, { name: field(form, 'name') ?? '' }), 'Warehouse added.');
}

export async function renameWarehouseAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => renameWarehouse(p, field(form, 'warehouseId') ?? '', { name: field(form, 'name') ?? '' }), 'Warehouse renamed.');
}

export async function setWarehouseActiveAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  const active = field(form, 'active') === 'true';
  return run(() => setWarehouseActive(p, field(form, 'warehouseId') ?? '', active), active ? 'Warehouse switched on.' : 'Warehouse switched off.');
}

// ---------------------------------------------------------------- stock entries

export async function createStockEntryAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return runAndOpen(() => createStockEntry(p, fields(form)), (id) => `/erp/stock/entries/${id}`);
}

export async function updateStockEntryAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => updateStockEntry(p, field(form, 'entryId') ?? '', fields(form)), 'Saved.');
}

export async function addStockEntryLineAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => addStockEntryLine(p, field(form, 'entryId') ?? '', fields(form)), 'Line added.');
}

export async function removeStockEntryLineAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => removeStockEntryLine(p, field(form, 'entryId') ?? '', field(form, 'lineId') ?? ''), 'Line removed.');
}

export async function submitStockEntryAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => submitStockEntry(p, field(form, 'entryId') ?? ''), 'Submitted. Stock and accounts are updated.');
}

export async function cancelStockEntryAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => cancelStockEntry(p, field(form, 'entryId') ?? ''), 'Cancelled. Stock and accounts are reversed.');
}

export async function deleteStockEntryAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return runAndOpen(async () => {
    await deleteStockEntry(p, field(form, 'entryId') ?? '');
    return { id: '' };
  }, () => '/erp/stock/entries');
}

// ---------------------------------------------------------------- reconciliation

export async function createReconciliationAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return runAndOpen(() => createReconciliation(p, fields(form)), (id) => `/erp/stock/reconciliations/${id}`);
}

export async function addReconciliationLineAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => addReconciliationLine(p, field(form, 'reconId') ?? '', fields(form)), 'Line added.');
}

export async function removeReconciliationLineAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => removeReconciliationLine(p, field(form, 'reconId') ?? '', field(form, 'lineId') ?? ''), 'Line removed.');
}

export async function submitReconciliationAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => submitReconciliation(p, field(form, 'reconId') ?? ''), 'Submitted. Stock and accounts are updated.');
}

export async function cancelReconciliationAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => cancelReconciliation(p, field(form, 'reconId') ?? ''), 'Cancelled.');
}

export async function deleteReconciliationAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return runAndOpen(async () => {
    await deleteReconciliation(p, field(form, 'reconId') ?? '');
    return { id: '' };
  }, () => '/erp/stock/reconciliations');
}

// ---------------------------------------------------------------- settings

export async function updateErpSettingsAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => updateSettings(p, fields(form)), 'ERP settings saved.');
}
