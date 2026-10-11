import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { hasPermissionAnywhere } from '@/core/rbac/engine';
import { getSalesSettings } from '@/modules/sales/services/settings.service';
import { PRICE_SOURCE_LABELS, PRICE_SOURCES } from '@/modules/sales/domain/pricing';
import { updateSettingsAction } from '@/app/actions/sales';
import { Card, PageHeader } from '@/components/ui';
import { SubmitButton } from '@/components/form';
import { ActionForm } from '@/components/action-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sales settings' };

export default async function SalesSettingsPage() {
  const principal = await requirePrincipal();
  if (!hasPermissionAnywhere(principal, 'sales.settings.manage')) notFound();
  const s = await getSalesSettings(principal);
  const field = (name: string, label: string, val: number, hint: string, step = 'any') => (
    <div>
      <label className="label" htmlFor={name}>{label}</label>
      <input id={name} name={name} type="number" step={step} min={0} defaultValue={val} required className="input w-full" />
      <p className="mt-xxs text-caption text-muted">{hint}</p>
    </div>
  );

  return (
    <div className="max-w-3xl space-y-lg">
      <PageHeader title="Sales settings" subtitle="Applies to every new quote. Existing quotes keep their GST, terms and validity." />
      <Card>
        <ActionForm action={updateSettingsAction} className="space-y-lg">
          <div className="grid gap-base sm:grid-cols-2">
            {field('targetMarginPct', 'Target margin %', s.targetMarginPct, 'Where the pricing advice starts before client and history adjustments.')}
            {field('minMarginPct', 'Minimum margin %', s.minMarginPct, 'Below this, after discount, a Director must approve the quote.')}
            {field('gstPct', 'GST %', s.gstPct, 'Shown on every quotation.')}
            {field('quoteValidityDays', 'Quote valid for (days)', s.quoteValidityDays, 'Sets “valid until” on new quotes.', '1')}
            {field('priceStaleDays', 'Price is old after (days)', s.priceStaleDays, 'Older prices are skipped for a fresher source and flagged.', '1')}
            {field('followUpDays', 'Follow up after (days)', s.followUpDays, 'A follow-up is scheduled this long after a quote is sent; quiet deals show on the overview.', '1')}
          </div>
          <fieldset>
            <legend className="label">Latest price: which source wins</legend>
            <div className="grid gap-sm sm:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <select key={i} name="pricePriority" defaultValue={s.pricePriority[i] ?? ''} className="select w-full" aria-label={`Priority ${i + 1}`} required={i === 0}>
                  {i > 0 ? <option value="">Not used</option> : null}
                  {PRICE_SOURCES.map((src) => <option key={src} value={src}>{i + 1}. {PRICE_SOURCE_LABELS[src]}</option>)}
                </select>
              ))}
            </div>
            <p className="mt-xxs text-caption text-muted">A BOM line takes the newest fresh price of the first source that has one.</p>
          </fieldset>
          <div>
            <label className="label" htmlFor="terms">Default terms and conditions</label>
            <textarea id="terms" name="terms" rows={8} defaultValue={s.terms} className="textarea w-full font-mono text-caption" />
          </div>
          <SubmitButton variant="primary">Save settings</SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}
