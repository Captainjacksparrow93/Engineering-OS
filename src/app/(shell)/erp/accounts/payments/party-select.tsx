/** One picker for customers and suppliers; posts "CUSTOMER|id" or "SUPPLIER|id". */
export function PartySelect({ customers, suppliers, value, name = 'party', label = 'Party', optional }: { customers: Array<{ id: string; name: string }>; suppliers: Array<{ id: string; name: string }>; value?: string | null; name?: string; label?: string; optional?: boolean }) {
  return (
    <div>
      <label className="label" htmlFor={name}>{label}</label>
      <select id={name} name={name} defaultValue={value ?? ''} className="select w-full">
        <option value="">{optional ? 'None' : 'Pick one (not needed for a transfer)'}</option>
        <optgroup label="Customers">{customers.map((c) => <option key={c.id} value={`CUSTOMER|${c.id}`}>{c.name}</option>)}</optgroup>
        <optgroup label="Suppliers">{suppliers.map((s) => <option key={s.id} value={`SUPPLIER|${s.id}`}>{s.name}</option>)}</optgroup>
      </select>
    </div>
  );
}
