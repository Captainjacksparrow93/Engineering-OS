import type { ErpAsset } from '@prisma/client';
import { Field, isoDay } from '../../_components/parts';

type Option = { id: string; name: string };

/** Fields shared by the new-asset and edit-asset forms. */
export function AssetFields({ asset, categories, staff, workstations, suppliers, invoiceNo, itemCode }: { asset?: ErpAsset; categories: Array<Option & { usefulLifeMonths: number }>; staff: Array<{ id: string; fullName: string }>; workstations: Option[]; suppliers: Option[]; invoiceNo?: string | null; itemCode?: string | null }) {
  const select = (name: string, label: string, options: Option[], value: string | null | undefined, empty: string | null) => (
    <div>
      <label className="label" htmlFor={name}>{label}</label>
      <select id={name} name={name} defaultValue={value ?? ''} className="select w-full" required={empty === null}>
        {empty !== null ? <option value="">{empty}</option> : <option value="" disabled>Pick one</option>}
        {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
    </div>
  );
  return (
    <div className="space-y-base">
      <div className="grid gap-sm sm:grid-cols-3">
        <Field label="Asset name" name="name" defaultValue={asset?.name} required placeholder="Hipot tester 5 kV" className="sm:col-span-2" />
        {select('categoryId', 'Category', categories.map((c) => ({ id: c.id, name: `${c.name} (${c.usefulLifeMonths} months)` })), asset?.categoryId, null)}
        <Field label="Purchase date" name="purchaseDate" type="date" defaultValue={isoDay(asset?.purchaseDate)} required />
        <Field label="In use from" name="availableForUseDate" type="date" defaultValue={isoDay(asset?.availableForUseDate)} />
        <Field label="Purchase value (₹)" name="grossValue" type="number" step="0.01" defaultValue={asset?.grossValue?.toString()} required />
        <Field label="Salvage value (₹)" name="salvageValue" type="number" step="0.01" defaultValue={asset?.salvageValue?.toString()} placeholder="0" />
        <Field label="Useful life (months)" name="usefulLifeMonths" type="number" defaultValue={asset?.usefulLifeMonths} placeholder="From the category" />
        <Field label="Purchase invoice no." name="purchaseInvoiceNo" defaultValue={invoiceNo} placeholder="ACC-PINV-2026-00012" />
        {select('supplierId', 'Supplier', suppliers, asset?.supplierId, 'None')}
        <Field label="Serial no." name="serialNo" defaultValue={asset?.serialNo} />
        <Field label="Item code" name="itemCode" defaultValue={itemCode} placeholder="Optional" />
        <Field label="Location" name="location" defaultValue={asset?.location} placeholder="Test bay" />
        {select('custodianId', 'Custodian', staff.map((s) => ({ id: s.id, name: s.fullName })), asset?.custodianId, 'None')}
        {select('workstationId', 'Workstation (if a machine)', workstations, asset?.workstationId, 'None')}
      </div>
      <fieldset className="rounded-md border border-hairline p-base">
        <legend className="px-xs text-caption text-muted">Owned before going live on ERP</legend>
        <label className="flex items-center gap-xs text-body-sm"><input type="checkbox" name="isExisting" defaultChecked={asset?.isExisting ?? false} /> Existing asset (its purchase is in the opening balances)</label>
        <div className="mt-sm grid gap-sm sm:grid-cols-2">
          <Field label="Depreciation already booked (₹)" name="openingAccumulated" type="number" step="0.01" defaultValue={asset?.openingAccumulated?.toString()} placeholder="0" />
          <Field label="Months already depreciated" name="openingMonths" type="number" defaultValue={asset?.openingMonths} placeholder="0" />
        </div>
      </fieldset>
      <div>
        <label className="label" htmlFor="notes">Notes</label>
        <textarea id="notes" name="notes" defaultValue={asset?.notes ?? ''} rows={2} className="input w-full" />
      </div>
      <label className="flex items-center gap-xs text-body-sm"><input type="checkbox" name="maintenanceRequired" defaultChecked={asset?.maintenanceRequired ?? false} /> Needs planned maintenance</label>
    </div>
  );
}
