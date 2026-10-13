import type { ErpParty } from '@prisma/client';
import { INDIAN_STATES } from '@/modules/erp/domain/gst';
import { Field } from './parts';

/** Customer / supplier fields, shared by the new and edit forms. */
export function PartyFields({ party, customer }: { party?: ErpParty | null; customer?: boolean }) {
  return (
    <div className="grid gap-sm sm:grid-cols-3">
      <Field label="Name" name="name" defaultValue={party?.name} required className="sm:col-span-2" />
      <div>
        <label className="label" htmlFor="state">State (place of supply)</label>
        <select id="state" name="state" defaultValue={party?.state ?? ''} className="select w-full">
          <option value="">Not set</option>
          {INDIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <Field label="GSTIN" name="gstin" defaultValue={party?.gstin} placeholder="24ABCDE1234F1Z5" />
      <Field label="PAN" name="pan" defaultValue={party?.pan} />
      <Field label="Payment terms (days)" name="paymentTermsDays" type="number" defaultValue={party?.paymentTermsDays ?? 30} />
      <Field label="Contact person" name="contactPerson" defaultValue={party?.contactPerson} />
      <Field label="Email" name="email" type="email" defaultValue={party?.email} />
      <Field label="Phone" name="phone" defaultValue={party?.phone} />
      <Field label="Address" name="address" defaultValue={party?.address} className="sm:col-span-2" />
      <Field label="City" name="city" defaultValue={party?.city} />
      <Field label="PIN code" name="pincode" defaultValue={party?.pincode} />
      {customer ? <Field label="Credit limit (₹)" name="creditLimit" type="number" defaultValue={party?.creditLimit?.toString()} /> : null}
      <Field label="Notes" name="notes" defaultValue={party?.notes} className="sm:col-span-3" />
    </div>
  );
}
