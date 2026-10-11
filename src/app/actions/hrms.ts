'use server';

import { revalidatePath } from 'next/cache';
import { requirePrincipal } from '@/core/auth/session';
import { toState, value, type ActionState } from '@/core/utils/actions';
import { removeDocument, uploadDocument } from '@/modules/hrms/services/document.service';
import { updateJob, updatePersonal, updateStatutory } from '@/modules/hrms/services/employee.service';
import { addHoliday, applyLeave, cancelLeave, decideLeave, removeHoliday, saveLeaveType, setAllocation } from '@/modules/hrms/services/leave.service';
import { decideRegularisation, importAttendance, requestRegularisation, saveShift } from '@/modules/hrms/services/attendance.service';

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
        biometricId: value(form, 'biometricId'),
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

// ---------------------------------------------------------------- phase 2: leave and attendance

const id = (form: FormData, key = 'id') => String(form.get(key) ?? '');
const decision = (form: FormData) => ({ decision: String(form.get('decision') ?? ''), note: value(form, 'note') });

export async function applyLeaveAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  return run(
    () =>
      applyLeave(principal, {
        leaveTypeId: id(form, 'leaveTypeId'),
        startDate: id(form, 'startDate'),
        endDate: value(form, 'endDate') ?? id(form, 'startDate'),
        halfDay: form.get('halfDay') === 'on',
        reason: id(form, 'reason'),
      }),
    'Leave applied. Your manager has been told.',
  );
}

export async function cancelLeaveAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  return run(() => cancelLeave(principal, id(form)), 'Leave cancelled.');
}

export async function decideLeaveAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  return run(() => decideLeave(principal, id(form), decision(form)), form.get('decision') === 'APPROVE' ? 'Approved.' : 'Rejected.');
}

export async function requestRegularisationAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  return run(
    () => requestRegularisation(principal, { date: id(form, 'date'), inTime: id(form, 'inTime'), outTime: id(form, 'outTime'), reason: id(form, 'reason') }),
    'Correction sent for approval.',
  );
}

export async function decideRegularisationAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  return run(() => decideRegularisation(principal, id(form), decision(form)), form.get('decision') === 'APPROVE' ? 'Approved. The day is corrected.' : 'Rejected.');
}

export async function importAttendanceAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) return { error: 'Choose the CSV file exported from the biometric machine.' };
  try {
    const result = await importAttendance(principal, file.name, await file.text());
    revalidatePath('/hrms', 'layout');
    const lines = [`Imported ${result.days} employee-day${result.days === 1 ? '' : 's'} from ${result.rows} row${result.rows === 1 ? '' : 's'}.`];
    if (result.keptCorrections) lines.push(`${result.keptCorrections} day${result.keptCorrections === 1 ? '' : 's'} kept as corrected by an approved request.`);
    if (result.problems.length) return { error: `${lines.join(' ')} ${result.skipped} skipped:\n${result.problems.slice(0, 10).join('\n')}` };
    return { success: lines.join(' ') };
  } catch (error) {
    return toState(error);
  }
}

export async function saveLeaveTypeAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  return run(
    () =>
      saveLeaveType(principal, {
        id: value(form, 'id'),
        code: id(form, 'code'),
        name: id(form, 'name'),
        annualDays: value(form, 'annualDays'),
        paid: form.get('paid') === 'on',
        allowHalfDay: form.get('allowHalfDay') === 'on',
        active: form.get('active') === 'on',
      }),
    'Leave type saved.',
  );
}

export async function setAllocationAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  return run(
    () => setAllocation(principal, { userId: id(form, 'userId'), leaveTypeId: id(form, 'leaveTypeId'), year: id(form, 'year'), days: id(form, 'days'), note: value(form, 'note') }),
    'Leave days set for that employee.',
  );
}

export async function addHolidayAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  return run(() => addHoliday(principal, { date: id(form, 'date'), name: id(form, 'name') }), 'Holiday added.');
}

export async function removeHolidayAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  return run(() => removeHoliday(principal, id(form)), 'Holiday removed.');
}

export async function saveShiftAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const principal = await requirePrincipal();
  return run(
    () => saveShift(principal, { shiftStart: id(form, 'shiftStart'), graceMinutes: id(form, 'graceMinutes'), fullDayHours: id(form, 'fullDayHours'), halfDayHours: id(form, 'halfDayHours') }),
    'Shift saved. Attendance is re-read with the new timings.',
  );
}
