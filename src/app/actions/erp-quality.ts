'use server';

import { requirePrincipal } from '@/core/auth/session';
import type { ActionState } from '@/core/utils/actions';
import {
  addReading,
  addTemplateParameter,
  cancelInspection,
  createInspection,
  createTemplate,
  deleteInspection,
  recordReadings,
  removeTemplateParameter,
  submitInspection,
} from '@/modules/erp/services/quality.service';
import { advanceNonConformance, raiseNonConformance, reopenNonConformance, updateCapa } from '@/modules/erp/services/nc.service';
import { createDocument, decideRevision, recordCustomerApproval, setDocumentActive, uploadRevision } from '@/modules/erp/services/quality-doc.service';
import { field, fields, run, runAndOpen } from './erp-common';

const id = (form: FormData, key = 'id') => field(form, key) ?? '';

export async function createTemplateAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => createTemplate(p, { name: field(form, 'name') ?? '' }), 'Template added.');
}
export async function addTemplateParameterAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => addTemplateParameter(p, id(form), fields(form)), 'Parameter added.');
}
export async function removeTemplateParameterAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => removeTemplateParameter(p, id(form), id(form, 'parameterId')), 'Removed.');
}

export async function createInspectionAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return runAndOpen(() => createInspection(p, fields(form)), (x) => `/erp/quality/inspections/${x}`);
}
export async function recordReadingsAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  const values: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (k.startsWith('r_') && typeof v === 'string') values[k.slice(2)] = v;
  return run(() => recordReadings(p, id(form), values), 'Readings saved.');
}
export async function addReadingAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => addReading(p, id(form), { parameter: field(form, 'parameter') ?? '', value: field(form, 'value') }), 'Check added.');
}
export async function submitInspectionAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  let result = '';
  const state = await run(async () => {
    result = await submitInspection(p, id(form));
  }, 'Submitted.');
  return state.success ? { success: result === 'ACCEPTED' ? 'Accepted.' : 'Rejected. A non-conformance was raised.' } : state;
}
export async function cancelInspectionAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => cancelInspection(p, id(form)), 'Cancelled.');
}
export async function deleteInspectionAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return runAndOpen(async () => {
    await deleteInspection(p, id(form));
    return { id: '' };
  }, () => '/erp/quality/inspections');
}

export async function raiseNcAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return runAndOpen(() => raiseNonConformance(p, fields(form)), (x) => `/erp/quality/non-conformances/${x}`);
}
export async function updateCapaAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => updateCapa(p, id(form), fields(form)), 'Saved.');
}
export async function advanceNcAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => advanceNonConformance(p, id(form), field(form, 'closingNote')), 'Moved on.');
}
export async function reopenNcAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => reopenNonConformance(p, id(form)), 'Re-opened.');
}

export async function createDocumentAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return runAndOpen(() => createDocument(p, fields(form)), (x) => `/erp/quality/documents/${x}`);
}
export async function uploadRevisionAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  const raw = form.get('file');
  const file = raw instanceof File && raw.size > 0 ? { name: raw.name, bytes: new Uint8Array(await raw.arrayBuffer()) } : null;
  return run(() => uploadRevision(p, id(form), { changeNote: field(form, 'changeNote') ?? '' }, file), 'Uploaded. It waits for approval.');
}
export async function decideRevisionAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  const approve = field(form, 'approve') === 'true';
  return run(() => decideRevision(p, id(form, 'revisionId'), approve, field(form, 'note')), approve ? 'Released.' : 'Rejected.');
}
export async function customerApprovalAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => recordCustomerApproval(p, id(form, 'revisionId'), { decision: field(form, 'decision') ?? '', customerRef: field(form, 'customerRef'), customerNote: field(form, 'customerNote') }), "Customer's decision recorded.");
}
export async function documentActiveAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const p = await requirePrincipal();
  return run(() => setDocumentActive(p, id(form), field(form, 'active') === 'true'), 'Saved.');
}
