'use server';

import { requirePrincipal } from '@/core/auth/session';
import { DomainError } from '@/core/rbac/errors';
import { toState, type ActionState } from '@/core/utils/actions';
import {
  cancelAsset,
  createAsset,
  createCategory,
  deleteAsset,
  moveAsset,
  postDepreciation,
  scrapAsset,
  submitAsset,
  updateAsset,
  updateCategory,
} from '@/modules/erp/services/asset.service';
import { cancelLog, completeRepair, createSchedule, logScheduleDone, reportBreakdown, setScheduleActive, startRepair } from '@/modules/erp/services/maintenance.service';
import { formatMoney } from '@/modules/erp/domain/money';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { field, fields, run, runAndOpen } from './erp-common';

const id = (form: FormData, key = 'id') => field(form, key) ?? '';

export async function createCategoryAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => createCategory(p, fields(form)), 'Category added.');
}
export async function updateCategoryAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => updateCategory(p, id(form), fields(form)), 'Category saved.');
}

export async function createAssetAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return runAndOpen(() => createAsset(p, fields(form)), (x) => `/erp/assets/register/${x}`);
}
export async function updateAssetAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => updateAsset(p, id(form), fields(form)), 'Asset saved.');
}
export async function submitAssetAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => submitAsset(p, id(form)), 'Asset submitted. Its depreciation schedule is ready.');
}
export async function deleteAssetAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  try {
    await deleteAsset(p, id(form));
  } catch (error) {
    return toState(error);
  }
  revalidatePath('/erp', 'layout');
  redirect('/erp/assets/register');
}
export async function cancelAssetAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => cancelAsset(p, id(form)), 'Asset cancelled. Its accounting entries are reversed.');
}
export async function moveAssetAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => moveAsset(p, id(form), fields(form)), 'Move recorded.');
}
export async function scrapAssetAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => scrapAsset(p, id(form), { date: field(form, 'date') ?? '', note: field(form, 'note') }), 'Asset scrapped.');
}
export async function postDepreciationAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  const upTo = field(form, 'upTo') ?? '';
  let message = '';
  const state = await run(async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(upTo)) throw new DomainError('Pick the date to post up to.');
    const r = await postDepreciation(p, new Date(`${upTo}T00:00:00.000Z`), field(form, 'assetId') || null);
    message = r.count ? `Posted ${r.count} depreciation ${r.count === 1 ? 'entry' : 'entries'}, ${formatMoney(r.amount)}.` : 'Nothing was due.';
  }, 'Posted.');
  return state.success ? { success: message } : state;
}

export async function createScheduleAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => createSchedule(p, fields(form)), 'Maintenance task added.');
}
export async function setScheduleActiveAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => setScheduleActive(p, id(form), field(form, 'active') === '1'), 'Saved.');
}
export async function logScheduleDoneAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => logScheduleDone(p, id(form), fields(form)), 'Logged. The next due date has moved on.');
}
export async function reportBreakdownAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return runAndOpen(() => reportBreakdown(p, fields(form)), (x) => `/erp/assets/maintenance/${x}`);
}
export async function startRepairAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => startRepair(p, id(form)), 'Repair started.');
}
export async function completeRepairAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => completeRepair(p, id(form), fields(form)), 'Repair done. The machine is back in use.');
}
export async function cancelLogAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => cancelLog(p, id(form)), 'Cancelled.');
}
