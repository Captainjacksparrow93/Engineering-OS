import Link from 'next/link';
import type { getEmployee } from '@/modules/hrms/services/employee.service';
import { formatDate, todayInIndia } from '@/core/utils/dates';
import { EMPLOYMENT_TYPE_LABEL, GENDER_LABEL, MARITAL_LABEL, USER_STATUS_LABEL } from '@/modules/hrms/domain/labels';
import { dayString, yearsBetween } from '@/modules/hrms/domain/records';
import { BLOOD_GROUPS, EMPLOYMENT_TYPES, GENDERS, MARITAL_STATUSES } from '@/modules/hrms/validation';
import { updateJobAction, updatePersonalAction, updateStatutoryAction } from '@/app/actions/hrms';
import { ActionForm } from '@/components/action-form';
import { SubmitButton } from '@/components/form';
import { Avatar, Card } from '@/components/ui';
import { DocumentTable, UploadForm } from './documents';

type Record = Awaited<ReturnType<typeof getEmployee>>;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-caption text-muted">{label}</dt>
      <dd className="text-body-md text-ink">{children || <span className="text-muted-soft">Not set</span>}</dd>
    </div>
  );
}

function Fields({ children }: { children: React.ReactNode }) {
  return <dl className="grid gap-base sm:grid-cols-2">{children}</dl>;
}

function Edit({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <details className="mt-base border-t border-hairline-soft pt-sm">
      <summary className="cursor-pointer text-body-sm font-medium text-ink">{label}</summary>
      <div className="mt-sm">{children}</div>
    </details>
  );
}

function Input({ id, label, name, defaultValue, type = 'text', placeholder, maxLength }: { id: string; label: string; name: string; defaultValue: string | number | null | undefined; type?: string; placeholder?: string; maxLength?: number }) {
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      <input id={id} name={name} type={type} defaultValue={defaultValue ?? ''} placeholder={placeholder} maxLength={maxLength} className="input w-full" />
    </div>
  );
}

function Select({ id, label, name, defaultValue, options }: { id: string; label: string; name: string; defaultValue: string | null | undefined; options: Array<[string, string]> }) {
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      <select id={id} name={name} defaultValue={defaultValue ?? ''} className="select w-full">
        <option value="">Not set</option>
        {options.map(([value, text]) => (
          <option key={value} value={value}>{text}</option>
        ))}
      </select>
    </div>
  );
}

const date = (d: Date | null | undefined) => (d ? formatDate(d, { forceYear: true }) : null);

/** One employee's HR record: job, personal, ID and bank, documents. Editing follows the viewer's rights. */
export function EmployeeRecord({ record }: { record: Record }) {
  const { person, profile: p, isSelf } = record;
  const today = todayInIndia();
  const tenure = p?.dateOfJoining ? yearsBetween(p.dateOfJoining, today) : null;

  return (
    <div className="space-y-lg">
      <Card>
        <div className="flex flex-wrap items-center gap-base">
          <Avatar name={person.fullName} color={person.avatarColor} size={48} />
          <div className="min-w-0 flex-1">
            <p className="text-title-sm text-ink">{person.fullName}</p>
            <p className="text-body-sm text-muted">
              {person.employeeCode} · {person.designation ?? 'No designation'} · {person.department?.name ?? 'No department'}
              {person.status !== 'ACTIVE' ? <span className="badge badge-error ml-xs">{USER_STATUS_LABEL[person.status]}</span> : null}
            </p>
          </div>
          {record.canManage && !isSelf ? (
            <Link href="/admin/users" className="btn btn-secondary btn-sm">Edit account in People</Link>
          ) : null}
        </div>
        <dl className="mt-base grid gap-base sm:grid-cols-4">
          <Field label="Work email">{person.email}</Field>
          <Field label="Work phone">{person.phone}</Field>
          <Field label="Reports to">{person.manager?.fullName}</Field>
          <Field label="Time with us">{tenure === null ? null : tenure < 1 ? 'Less than a year' : `${tenure} year${tenure === 1 ? '' : 's'}`}</Field>
        </dl>
      </Card>

      <div className="grid gap-lg lg:grid-cols-2">
        <Card title="Job">
          <Fields>
            <Field label="Joining date">{date(p?.dateOfJoining)}</Field>
            <Field label="Employment type">{p?.employmentType ? EMPLOYMENT_TYPE_LABEL[p.employmentType] : null}</Field>
            <Field label="Probation ends">{date(p?.probationEndDate)}</Field>
            <Field label="Confirmed on">{date(p?.confirmationDate)}</Field>
            <Field label="Work location">{p?.workLocation}</Field>
            <Field label="Notice period">{p?.noticePeriodDays != null ? `${p.noticePeriodDays} days` : null}</Field>
          </Fields>
          {record.canManage ? (
            <Edit label="Edit job details">
              <ActionForm action={updateJobAction} className="space-y-base">
                <input type="hidden" name="userId" value={person.id} />
                <div className="grid gap-base sm:grid-cols-2">
                  <Input id="job-doj" label="Joining date" name="dateOfJoining" type="date" defaultValue={dayString(p?.dateOfJoining)} />
                  <Select id="job-type" label="Employment type" name="employmentType" defaultValue={p?.employmentType} options={EMPLOYMENT_TYPES.map((t) => [t, EMPLOYMENT_TYPE_LABEL[t]])} />
                  <Input id="job-prob" label="Probation ends" name="probationEndDate" type="date" defaultValue={dayString(p?.probationEndDate)} />
                  <Input id="job-conf" label="Confirmed on" name="confirmationDate" type="date" defaultValue={dayString(p?.confirmationDate)} />
                  <Input id="job-loc" label="Work location" name="workLocation" defaultValue={p?.workLocation} maxLength={120} placeholder="e.g. Vadodara works" />
                  <Input id="job-notice" label="Notice period (days)" name="noticePeriodDays" type="number" defaultValue={p?.noticePeriodDays} />
                </div>
                <SubmitButton variant="primary" pendingLabel="Saving…">Save job details</SubmitButton>
              </ActionForm>
            </Edit>
          ) : null}
        </Card>

        <Card title="Personal">
          <Fields>
            <Field label="Date of birth">{date(p?.dateOfBirth)}</Field>
            <Field label="Gender">{p?.gender ? GENDER_LABEL[p.gender] : null}</Field>
            <Field label="Marital status">{p?.maritalStatus ? MARITAL_LABEL[p.maritalStatus] : null}</Field>
            <Field label="Blood group">{p?.bloodGroup}</Field>
            <Field label="Personal email">{p?.personalEmail}</Field>
            <Field label="Emergency contact">
              {p?.emergencyName ? `${p.emergencyName}${p.emergencyRelation ? ` (${p.emergencyRelation})` : ''}${p.emergencyPhone ? `, ${p.emergencyPhone}` : ''}` : null}
            </Field>
            <Field label="Current address">{p?.currentAddress}</Field>
            <Field label="Permanent address">{p?.permanentAddress}</Field>
          </Fields>
          {record.canEditPersonal ? (
            <Edit label={isSelf ? 'Update my details' : 'Edit personal details'}>
              <ActionForm action={updatePersonalAction} className="space-y-base">
                <input type="hidden" name="userId" value={person.id} />
                <div className="grid gap-base sm:grid-cols-2">
                  <Input id="per-dob" label="Date of birth" name="dateOfBirth" type="date" defaultValue={dayString(p?.dateOfBirth)} />
                  <Select id="per-gender" label="Gender" name="gender" defaultValue={p?.gender} options={GENDERS.map((g) => [g, GENDER_LABEL[g]])} />
                  <Select id="per-marital" label="Marital status" name="maritalStatus" defaultValue={p?.maritalStatus} options={MARITAL_STATUSES.map((m) => [m, MARITAL_LABEL[m]])} />
                  <Select id="per-blood" label="Blood group" name="bloodGroup" defaultValue={p?.bloodGroup} options={BLOOD_GROUPS.map((b) => [b, b])} />
                  <Input id="per-email" label="Personal email" name="personalEmail" type="email" defaultValue={p?.personalEmail} />
                </div>
                <div>
                  <label className="label" htmlFor="per-cur">Current address</label>
                  <textarea id="per-cur" name="currentAddress" rows={2} maxLength={400} defaultValue={p?.currentAddress ?? ''} className="textarea w-full" />
                </div>
                <div>
                  <label className="label" htmlFor="per-perm">Permanent address</label>
                  <textarea id="per-perm" name="permanentAddress" rows={2} maxLength={400} defaultValue={p?.permanentAddress ?? ''} className="textarea w-full" />
                </div>
                <div className="grid gap-base sm:grid-cols-3">
                  <Input id="per-ename" label="Emergency contact" name="emergencyName" defaultValue={p?.emergencyName} maxLength={120} />
                  <Input id="per-erel" label="Relation" name="emergencyRelation" defaultValue={p?.emergencyRelation} maxLength={60} placeholder="e.g. Mother" />
                  <Input id="per-ephone" label="Their phone" name="emergencyPhone" type="tel" defaultValue={p?.emergencyPhone} placeholder="98250 12345" />
                </div>
                <SubmitButton variant="primary" pendingLabel="Saving…">Save details</SubmitButton>
              </ActionForm>
            </Edit>
          ) : null}
        </Card>
      </div>

      <Card title="ID and bank">
        <Fields>
          <Field label="PAN">{p?.pan}</Field>
          <Field label="Aadhaar">{p?.aadhaar}</Field>
          <Field label="UAN (PF)">{p?.uan}</Field>
          <Field label="ESIC number">{p?.esicNumber}</Field>
          <Field label="Bank">{p?.bankName}</Field>
          <Field label="Account number">{p?.bankAccountNo}</Field>
          <Field label="IFSC">{p?.bankIfsc}</Field>
        </Fields>
        {!record.sensitiveVisible ? <p className="mt-base text-caption text-muted">Numbers are partly hidden. Only HR sees them in full.</p> : null}
        {isSelf && !record.canManage ? <p className="mt-base text-caption text-muted">To change these, send HR the new document.</p> : null}
        {record.canEditStatutory ? (
          <Edit label="Edit ID and bank details">
            <ActionForm action={updateStatutoryAction} className="space-y-base">
              <input type="hidden" name="userId" value={person.id} />
              <div className="grid gap-base sm:grid-cols-2">
                <Input id="st-pan" label="PAN" name="pan" defaultValue={p?.pan} placeholder="ABCDE1234F" />
                <Input id="st-aadhaar" label="Aadhaar" name="aadhaar" defaultValue={p?.aadhaar} placeholder="12 digits" />
                <Input id="st-uan" label="UAN (PF)" name="uan" defaultValue={p?.uan} placeholder="12 digits" />
                <Input id="st-esic" label="ESIC number" name="esicNumber" defaultValue={p?.esicNumber} />
                <Input id="st-bank" label="Bank" name="bankName" defaultValue={p?.bankName} maxLength={120} />
                <Input id="st-acc" label="Account number" name="bankAccountNo" defaultValue={p?.bankAccountNo} />
                <Input id="st-ifsc" label="IFSC" name="bankIfsc" defaultValue={p?.bankIfsc} placeholder="HDFC0001234" />
              </div>
              <SubmitButton variant="primary" pendingLabel="Saving…">Save ID and bank details</SubmitButton>
            </ActionForm>
          </Edit>
        ) : null}
      </Card>

      {record.canSeeDocuments ? (
        <Card title={isSelf ? 'My documents' : 'Documents'}>
          <DocumentTable
            documents={record.documents}
            manage={record.canManage}
            emptyHint={record.canManage ? 'Upload offer letters, ID proofs and certificates below.' : 'Documents HR files for you appear here.'}
          />
          {record.canManage ? (
            <Edit label="Upload a document">
              <UploadForm userId={person.id} />
            </Edit>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
