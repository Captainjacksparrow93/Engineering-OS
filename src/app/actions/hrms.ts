'use server';

import { revalidatePath } from 'next/cache';
import { requirePrincipal } from '@/core/auth/session';
import { toState, value, type ActionState } from '@/core/utils/actions';
import { removeDocument, uploadDocument } from '@/modules/hrms/services/document.service';
import { updateJob, updatePersonal, updateStatutory } from '@/modules/hrms/services/employee.service';

/**
 * HRMS write path for the UI. Each action authenticates, hands the raw form to the service
 * (which validates and authorises) and refreshes the HR pages. No rules live here.
 */

async function run(fn: () => Promise<unknown>, success: string): Promise<ActionState> {
  try {
    await fn();
    revalidatePath('/hrms', 'layout');
    return { success };
  } catch (error) {
    return toState(error);
  }
}

const userId = (form: FormData) => String(form.get('userId') ?? '');

export async function updatePersonalAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  return run(
    () =>
      updatePersonal(principal, userId(form), {
        dateOfBirth: value(form, 'dateOfBirth'),
        gender: value(form, 'gender'),
        maritalStatus: value(form, 'maritalStatus'),
        bloodGroup: value(form, 'bloodGroup'),
        personalEmail: value(form, 'personalEmail'),
        currentAddress: value(form, 'currentAddress'),
        permanentAddress: value(form, 'permanentAddress'),
        emergencyName: value(form, 'emergencyName'),
        emergencyRelation: value(form, 'emergencyRelation'),
        emergencyPhone: value(form, 'emergencyPhone'),
      }),
    'Personal details saved.',
  );
}

export async function updateJobAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  return run(
    () =>
      updateJob(principal, userId(form), {
        dateOfJoining: value(form, 'dateOfJoining'),
        employmentType: value(form, 'employmentType'),
        probationEndDate: value(form, 'probationEndDate'),
        confirmationDate: value(form, 'confirmationDate'),
        workLocation: value(form, 'workLocation'),
        noticePeriodDays: value(form, 'noticePeriodDays'),
      }),
    'Job details saved.',
  );
}

export async function updateStatutoryAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  return run(
    () =>
      updateStatutory(principal, userId(form), {
        pan: value(form, 'pan'),
        aadhaar: value(form, 'aadhaar'),
        uan: value(form, 'uan'),
        esicNumber: value(form, 'esicNumber'),
        bankName: value(form, 'bankName'),
        bankAccountNo: value(form, 'bankAccountNo'),
        bankIfsc: value(form, 'bankIfsc'),
      }),
    'ID and bank details saved.',
  );
}

export async function uploadDocumentAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  const raw = form.get('file');
  const file = raw instanceof File && raw.size > 0 ? { name: raw.name, type: raw.type, bytes: new Uint8Array(await raw.arrayBuffer()) } : null;
  return run(
    () =>
      uploadDocument(
        principal,
        {
          userId: value(form, 'userId'),
          category: String(form.get('category') ?? ''),
          title: String(form.get('title') ?? ''),
          visibleToEmployee: form.get('hrOnly') !== 'on',
        },
        file,
      ),
    'Document uploaded.',
  );
}

export async function removeDocumentAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  return run(() => removeDocument(principal, String(form.get('documentId') ?? '')), 'Document removed.');
}
