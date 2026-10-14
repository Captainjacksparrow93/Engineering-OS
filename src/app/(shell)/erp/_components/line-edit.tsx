import type { ActionState } from '@/core/utils/actions';
import { ActionForm } from '@/components/action-form';
import { SubmitButton } from '@/components/form';

/** Inline edit of a draft line's quantity (and rate, and rejected qty where it applies). */
export function LineEdit({
  action,
  docId,
  lineId,
  qty,
  rate,
  rejectedQty,
  date,
}: {
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  docId: string;
  lineId: string;
  qty: string;
  rate?: string | null;
  rejectedQty?: string | null;
  /** Delivery date (yyyy-mm-dd), for sales order lines. */
  date?: string | null;
}) {
  return (
    <ActionForm action={action} quiet className="flex flex-wrap items-center justify-end gap-xxs">
      <input type="hidden" name="id" value={docId} />
      <input type="hidden" name="lineId" value={lineId} />
      <input name="qty" defaultValue={qty} type="number" step="any" min="0" className="input w-20 text-right" aria-label="Quantity" />
      {rejectedQty !== undefined ? <input name="rejectedQty" defaultValue={rejectedQty ?? '0'} type="number" step="any" min="0" className="input w-20 text-right" aria-label="Rejected quantity" title="Rejected" /> : null}
      {rate !== undefined ? <input name="rate" defaultValue={rate ?? ''} type="number" step="any" min="0" className="input w-24 text-right" aria-label="Rate" /> : null}
      {date !== undefined ? <input name="deliveryDate" defaultValue={date ?? ''} type="date" className="input w-36" aria-label="Delivery date" /> : null}
      <SubmitButton size="sm" pendingLabel="…">Save</SubmitButton>
    </ActionForm>
  );
}
