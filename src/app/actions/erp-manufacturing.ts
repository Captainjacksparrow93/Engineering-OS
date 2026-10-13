'use server';

import { requirePrincipal } from '@/core/auth/session';
import { DomainError } from '@/core/rbac/errors';
import type { ActionState } from '@/core/utils/actions';
import {
  addBomItem,
  addBomOperation,
  cancelBom,
  copyBom,
  createBom,
  createWorkstation,
  deleteBom,
  removeBomItem,
  removeBomOperation,
  setBomActive,
  setDefaultBom,
  setWorkstationActive,
  submitBom,
  updateBomCost,
  updateBomItem,
  updateWorkstation,
} from '@/modules/erp/services/bom.service';
import {
  cancelWorkOrder,
  cancelWorkOrderEntry,
  createWorkOrder,
  deleteWorkOrder,
  makeWorkOrdersFromSalesOrder,
  manufacture,
  setWorkOrderStopped,
  submitWorkOrder,
  transferMaterials,
  updateWorkOrderQty,
} from '@/modules/erp/services/work-order.service';
import { addJobCardLog, completeJobCard, removeJobCardLog } from '@/modules/erp/services/job-card.service';
import {
  addPlanItem,
  cancelProductionPlan,
  createProductionPlan,
  deleteProductionPlan,
  getItemsFromSalesOrders,
  makeMaterialRequestFromPlan,
  makeWorkOrdersFromPlan,
  removePlanItem,
  submitProductionPlan,
} from '@/modules/erp/services/production-plan.service';
import { field, fields, run, runAndOpen } from './erp-common';

const id = (form: FormData, key = 'id') => field(form, key) ?? '';
const today = () => new Date(`${new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10)}T00:00:00Z`);

export async function createWorkstationAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => createWorkstation(p, fields(form)), 'Workstation added.');
}
export async function updateWorkstationAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => updateWorkstation(p, id(form), fields(form)), 'Saved.');
}
export async function setWorkstationActiveAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => setWorkstationActive(p, id(form), field(form, 'active') === 'true'), 'Saved.');
}

export async function createBomAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return runAndOpen(() => createBom(p, fields(form)), (x) => `/erp/manufacturing/boms/${x}`);
}
export async function addBomItemAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => addBomItem(p, id(form), fields(form)), 'Material added.');
}
export async function updateBomItemAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => updateBomItem(p, id(form), id(form, 'lineId'), { qty: field(form, 'qty') ?? '' }), 'Saved.');
}
export async function removeBomItemAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => removeBomItem(p, id(form), id(form, 'lineId')), 'Removed.');
}
export async function addBomOperationAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => addBomOperation(p, id(form), fields(form)), 'Operation added.');
}
export async function removeBomOperationAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => removeBomOperation(p, id(form), id(form, 'lineId')), 'Removed.');
}
export async function submitBomAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => submitBom(p, id(form), today()), 'Submitted. Its cost is now in the Sales catalogue.');
}
export async function cancelBomAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => cancelBom(p, id(form)), 'Cancelled.');
}
export async function deleteBomAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return runAndOpen(async () => {
    await deleteBom(p, id(form));
    return { id: '' };
  }, () => '/erp/manufacturing/boms');
}
export async function defaultBomAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => setDefaultBom(p, id(form)), 'Now the default BOM.');
}
export async function bomActiveAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => setBomActive(p, id(form), field(form, 'active') === 'true'), 'Saved.');
}
export async function updateBomCostAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => updateBomCost(p, id(form), today()), 'Cost updated at today’s rates.');
}
export async function copyBomAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return runAndOpen(() => copyBom(p, id(form)), (x) => `/erp/manufacturing/boms/${x}`);
}

export async function createWorkOrderAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return runAndOpen(() => createWorkOrder(p, fields(form)), (x) => `/erp/manufacturing/work-orders/${x}`);
}
export async function workOrdersFromSalesOrderAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(async () => {
    const { made, missing } = await makeWorkOrdersFromSalesOrder(p, id(form));
    if (missing.length) throw new DomainError(`Made ${made.length}; no BOM for ${missing.join(', ')}.`);
  }, 'Draft work orders made. Open Manufacturing → Work orders to submit them.');
}
export async function updateWorkOrderQtyAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => updateWorkOrderQty(p, id(form), { qty: field(form, 'qty') ?? '' }), 'Saved.');
}
export async function submitWorkOrderAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => submitWorkOrder(p, id(form)), 'Submitted. Job cards are ready.');
}
export async function deleteWorkOrderAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return runAndOpen(async () => {
    await deleteWorkOrder(p, id(form));
    return { id: '' };
  }, () => '/erp/manufacturing/work-orders');
}
export async function cancelWorkOrderAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => cancelWorkOrder(p, id(form)), 'Cancelled.');
}
export async function stopWorkOrderAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  const stop = field(form, 'stop') === 'true';
  return run(() => setWorkOrderStopped(p, id(form), stop), stop ? 'Stopped.' : 'Resumed.');
}
export async function transferMaterialsAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => transferMaterials(p, id(form), { qty: field(form, 'qty') || null }, today()), 'Materials moved to Work In Progress.');
}
export async function manufactureAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => manufacture(p, id(form), { qty: field(form, 'qty') ?? '' }, today()), 'Finished goods are in stock.');
}
export async function cancelWorkOrderEntryAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => cancelWorkOrderEntry(p, id(form), id(form, 'entryId')), 'Entry cancelled.');
}

export async function addJobCardLogAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => addJobCardLog(p, id(form), fields(form)), 'Time logged.');
}
export async function removeJobCardLogAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => removeJobCardLog(p, id(form), id(form, 'logId')), 'Removed.');
}
export async function completeJobCardAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => completeJobCard(p, id(form)), 'Marked complete.');
}

export async function createProductionPlanAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return runAndOpen(() => createProductionPlan(p, fields(form)), (x) => `/erp/manufacturing/plans/${x}`);
}
export async function planFromOrdersAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => getItemsFromSalesOrders(p, id(form)), 'Open sales-order lines added.');
}
export async function addPlanItemAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => addPlanItem(p, id(form), fields(form)), 'Item added.');
}
export async function removePlanItemAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => removePlanItem(p, id(form), id(form, 'lineId')), 'Removed.');
}
export async function submitPlanAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => submitProductionPlan(p, id(form)), 'Submitted.');
}
export async function cancelPlanAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => cancelProductionPlan(p, id(form)), 'Cancelled.');
}
export async function deletePlanAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return runAndOpen(async () => {
    await deleteProductionPlan(p, id(form));
    return { id: '' };
  }, () => '/erp/manufacturing/plans');
}
export async function planWorkOrdersAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => makeWorkOrdersFromPlan(p, id(form)), 'Draft work orders made.');
}
export async function planMaterialRequestAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return runAndOpen(() => makeMaterialRequestFromPlan(p, id(form), today()), (x) => `/erp/buying/requests/${x}`);
}
