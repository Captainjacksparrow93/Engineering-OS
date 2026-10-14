import type { ErpPayment } from '@prisma/client';
import { Field, isoDay, todayIso } from '../../_components/parts';
import { PartySelect } from './party-select';

type Option = { id: string; name: string };

export function PaymentFields({ pay, customers, suppliers, banks }: { pay?: ErpPayment; customers: Option[]; suppliers: Option[]; banks: Array<{ id: string; code: string; name: string }> }) {
  const bankSelect = (name: string, label: string, value: string | null | undefined, optional: boolean) => (
    <div>
      <label className="label" htmlFor={name}>{label}</label>
      <select id={name} name={name} defaultValue={value ?? ''} className="select w-full" required={!optional}>
        {optional ? <option value="">—</option> : null}
        {banks.map((b) => <option key={b.id} value={b.id}>{b.code} {b.name}</option>)}
      </select>
    </div>
  );
  return (
    <div className="grid gap-sm sm:grid-cols-4">
      <div>
        <label className="label" htmlFor="paymentType">Type</label>
        <select id="paymentType" name="paymentType" defaultValue={pay?.paymentType ?? 'RECEIVE'} className="select w-full">
          <option value="RECEIVE">Receive</option>
          <option value="PAY">Pay</option>
          <option value="INTERNAL_TRANSFER">Internal transfer</option>
        </select>
      </div>
      <PartySelect customers={customers} suppliers={suppliers} value={pay?.partyType && pay.partyId ? `${pay.partyType}|${pay.partyId}` : null} />
      {bankSelect('accountId', 'Bank or cash account', pay?.accountId, false)}
      {bankSelect('transferToAccountId', 'Transfer to (transfers only)', pay?.transferToAccountId, true)}
      <Field label="Date" name="postingDate" type="date" defaultValue={pay ? isoDay(pay.postingDate) : todayIso()} required />
      <Field label="Amount (₹)" name="amount" type="number" step="0.01" defaultValue={pay?.amount.toString()} required />
      <Field label="Mode" name="modeOfPayment" defaultValue={pay?.modeOfPayment} placeholder="NEFT, cheque, UPI" />
      <Field label="Reference no." name="referenceNo" defaultValue={pay?.referenceNo} placeholder="UTR or cheque no." />
      <Field label="Reference date" name="referenceDate" type="date" defaultValue={isoDay(pay?.referenceDate)} />
      <Field label="Remarks" name="remarks" defaultValue={pay?.remarks} className="sm:col-span-3" />
    </div>
  );
}
