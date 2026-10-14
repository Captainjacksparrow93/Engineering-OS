import type { ErpItem } from '@prisma/client';
import { Field } from '../../_components/parts';

/** Fields shared by the new-item and edit-item forms. */
export function ItemFields({ item, groups, warehouses, templates }: { item?: ErpItem; groups: string[]; warehouses: Array<{ id: string; name: string }>; templates: Array<{ id: string; name: string }> }) {
  const check = (name: keyof ErpItem, label: string, fallback: boolean) => (
    <label className="flex items-center gap-xs text-body-sm">
      <input type="checkbox" name={name} defaultChecked={item ? Boolean(item[name]) : fallback} /> {label}
    </label>
  );
  return (
    <div className="space-y-base">
      <div className="grid gap-sm sm:grid-cols-3">
        <Field label="Item code" name="code" defaultValue={item?.code} required placeholder="PLC-CPU-1214C" />
        <Field label="Name" name="name" defaultValue={item?.name} required className="sm:col-span-2" />
        <Field label="Item group" name="itemGroup" defaultValue={item?.itemGroup ?? 'General'} list="item-groups" />
        <Field label="Unit" name="uom" defaultValue={item?.uom ?? 'Nos'} />
        <Field label="HSN/SAC code" name="hsnCode" defaultValue={item?.hsnCode} />
        <Field label="Make" name="make" defaultValue={item?.make} placeholder="Siemens" />
        <Field label="Maker part no." name="makerPartNo" defaultValue={item?.makerPartNo} />
        <Field label="GST rate (%)" name="gstRate" type="number" defaultValue={item?.gstRate?.toString()} placeholder="Company default" />
        <Field label="Selling rate (₹)" name="standardRate" type="number" defaultValue={item?.standardRate?.toString()} />
        <Field label="Reorder level" name="reorderLevel" type="number" defaultValue={item?.reorderLevel?.toString()} />
        <Field label="Reorder quantity" name="reorderQty" type="number" defaultValue={item?.reorderQty?.toString()} />
        <Field label="Lead time (days)" name="leadTimeDays" type="number" defaultValue={item?.leadTimeDays} />
        <div>
          <label className="label" htmlFor="defaultWarehouseId">Default warehouse</label>
          <select id="defaultWarehouseId" name="defaultWarehouseId" defaultValue={item?.defaultWarehouseId ?? ''} className="select w-full">
            <option value="">Stores</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="qualityTemplateId">Inspection template</label>
          <select id="qualityTemplateId" name="qualityTemplateId" defaultValue={item?.qualityTemplateId ?? ''} className="select w-full">
            <option value="">None</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label className="label" htmlFor="description">Description</label>
        <textarea id="description" name="description" defaultValue={item?.description ?? ''} rows={2} className="input w-full" />
      </div>
      <div className="flex flex-wrap gap-lg">
        {check('isStockItem', 'Keep stock of this item', true)}
        {check('isPurchaseItem', 'Bought from suppliers', true)}
        {check('isSalesItem', 'Sold to customers', false)}
        {check('inspectionBeforePurchase', 'Inspect before accepting a receipt', false)}
        {check('inspectionBeforeDelivery', 'Inspect before delivery', false)}
      </div>
      <datalist id="item-groups">{groups.map((g) => <option key={g} value={g} />)}</datalist>
    </div>
  );
}
