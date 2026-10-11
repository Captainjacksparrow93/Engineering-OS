import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { getQuote } from '@/modules/sales/services/quote.service';
import { getQuoteInsights } from '@/modules/sales/services/insight.service';
import {
  addLineAction,
  applyLineAdviceAction,
  applyMarginAction,
  approveQuoteAction,
  refreshPricesAction,
  reviseQuoteAction,
  sendBackQuoteAction,
  submitQuoteAction,
  updateQuoteTermsAction,
} from '@/app/actions/sales';
import { Alert, Card, PageHeader } from '@/components/ui';
import { SubmitButton } from '@/components/form';
import { ActionForm } from '@/components/action-form';
import { QuoteStatusBadge } from '../../_components/badges';
import { formatINR, inrShort, isoDay, pct, shortDate } from '../../_components/format';
import { BomGrid } from './bom-grid';
import { AddItem } from './add-item';
import { OutlookButton } from './outlook-button';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Quote' };

export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const principal = await requirePrincipal();
  const { id } = await params;
  let quote;
  let insights;
  try {
    [quote, insights] = await Promise.all([getQuote(principal, id), getQuoteInsights(principal, id)]);
  } catch {
    notFound();
  }
  const { flags, totals, config } = quote;
  const label = `${quote.number} R${quote.revision}`;
  const advice = Object.fromEntries(insights.lineAdvice.map((a) => [a.key, a]));
  const panels = quote.panels.map((p) => p.panel);
  const sendable = quote.status === 'APPROVED' || quote.status === 'SENT' || quote.status === 'ACCEPTED';
  const canRevise = flags.canEditDeal && ['PENDING_APPROVAL', 'APPROVED', 'SENT'].includes(quote.status) && quote.deal.stage !== 'WON' && quote.deal.stage !== 'LOST';
  const marginGap = Math.round((insights.margin.suggestedPct - totals.marginPct) * 10) / 10;

  return (
    <div className="space-y-lg">
      <PageHeader
        title={`Quote ${label}`}
        breadcrumb={[{ label: 'Deals', href: '/sales/deals' }, { label: quote.deal.code, href: `/sales/deals/${quote.dealId}` }, { label }]}
        subtitle={
          <span className="flex flex-wrap items-center gap-xs">
            <QuoteStatusBadge status={quote.status} />
            <span>{quote.deal.account.name}: {quote.deal.title}</span>
            <span>· valid until {shortDate(quote.validUntil)}</span>
          </span>
        }
        actions={
          <>
            <Link href={`/sales/quotes/${quote.id}/print`} target="_blank" className="btn btn-secondary">Print / PDF</Link>
            {sendable && flags.canEditDeal ? <OutlookButton quoteId={quote.id} primary={quote.status === 'APPROVED'} /> : null}
            {flags.editable ? (
              <ActionForm action={submitQuoteAction}>
                <input type="hidden" name="quoteId" value={quote.id} />
                <SubmitButton variant="primary" pendingLabel="Submitting…">{quote.belowMinimum ? 'Submit for approval' : 'Submit'}</SubmitButton>
              </ActionForm>
            ) : null}
            {canRevise ? (
              <ActionForm action={reviseQuoteAction}>
                <input type="hidden" name="quoteId" value={quote.id} />
                <SubmitButton pendingLabel="Creating…">Revise</SubmitButton>
              </ActionForm>
            ) : null}
          </>
        }
      />

      {quote.status === 'DRAFT' && quote.approvalNote ? <Alert tone="warning">Sent back: {quote.approvalNote}</Alert> : null}
      {quote.status === 'PENDING_APPROVAL' ? (
        <Alert tone="info">Waiting for a Director: the margin is {pct(totals.marginPct)}, below the {pct(config.minMarginPct)} minimum.</Alert>
      ) : null}
      {quote.status === 'APPROVED' ? (
        <Alert tone="success">
          Approved{quote.approvedBy ? ` by ${quote.approvedBy.fullName}` : ''}{quote.approvalNote ? `: ${quote.approvalNote}` : ''}. Use “Email via Outlook” to send it; that also schedules a follow-up.
        </Alert>
      ) : null}
      {flags.editable && quote.belowMinimum ? (
        <Alert tone="warning">The margin is {pct(totals.marginPct)}, below the {pct(config.minMarginPct)} minimum. A Director must approve it before it goes out.</Alert>
      ) : null}

      {flags.canApprove ? (
        <Card title="Your decision">
          <div className="grid gap-base md:grid-cols-2">
            <ActionForm action={approveQuoteAction} className="space-y-sm">
              <input type="hidden" name="quoteId" value={quote.id} />
              <input name="note" className="input w-full" placeholder="Note for the salesperson (optional)" aria-label="Approval note" />
              <SubmitButton variant="ink" pendingLabel="Approving…">Approve at {pct(totals.marginPct)}</SubmitButton>
            </ActionForm>
            <ActionForm action={sendBackQuoteAction} className="space-y-sm">
              <input type="hidden" name="quoteId" value={quote.id} />
              <input name="note" required className="input w-full" placeholder="What should change?" aria-label="What should change" />
              <SubmitButton variant="danger" pendingLabel="Sending back…">Send back</SubmitButton>
            </ActionForm>
          </div>
        </Card>
      ) : null}

      <div className="grid gap-lg xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-lg">
          <Card
            title="Bill of materials"
            bodyClassName="p-0"
            action={
              flags.editable ? (
                <ActionForm action={refreshPricesAction}>
                  <input type="hidden" name="quoteId" value={quote.id} />
                  <SubmitButton size="sm" pendingLabel="Checking…">{flags.priceChanges ? `Refresh prices (${flags.priceChanges} changed)` : 'Refresh prices'}</SubmitButton>
                </ActionForm>
              ) : null
            }
          >
            {flags.stalePrices ? (
              <p className="border-b border-hairline px-base py-xs text-caption text-error">
                {flags.stalePrices} line{flags.stalePrices === 1 ? ' uses' : 's use'} a price older than {config.priceStaleDays} days. Ask purchase for a fresh rate before you send.
              </p>
            ) : null}
            <BomGrid
              quoteId={quote.id}
              editable={flags.editable}
              advice={advice}
              lines={quote.lines.map((l) => ({ ...l, costDate: l.costDate ? l.costDate.toISOString() : null }))}
            />
            {flags.editable ? <AddItem quoteId={quote.id} panels={panels} defaultMargin={insights.margin.suggestedPct} /> : null}
          </Card>

          <Card title="Totals">
            <div className="grid gap-lg md:grid-cols-2">
              <dl className="grid grid-cols-2 content-start gap-y-xxs text-body-sm">
                <dt className="text-muted">BOM cost</dt><dd className="text-right">{formatINR(totals.cost)}</dd>
                <dt className="text-muted">Subtotal</dt><dd className="text-right">{formatINR(totals.subtotal)}</dd>
                {totals.discount ? <><dt className="text-muted">Discount ({pct(quote.discountPct)})</dt><dd className="text-right">−{formatINR(totals.discount)}</dd></> : null}
                {totals.freight ? <><dt className="text-muted">Freight</dt><dd className="text-right">{formatINR(totals.freight)}</dd></> : null}
                <dt className="text-muted">Taxable value</dt><dd className="text-right">{formatINR(totals.taxable)}</dd>
                <dt className="text-muted">GST @ {pct(quote.gstPct)}</dt><dd className="text-right">{formatINR(totals.gst)}</dd>
                <dt className="font-semibold text-ink">Grand total</dt><dd className="text-right font-semibold text-ink">{formatINR(totals.grandTotal)}</dd>
                <dt className="text-muted">Margin after discount</dt>
                <dd className={`text-right font-semibold ${quote.belowMinimum ? 'text-error' : 'text-success'}`}>{totals.net ? pct(totals.marginPct) : '—'}</dd>
              </dl>
              {flags.editable ? (
                <ActionForm action={updateQuoteTermsAction} className="space-y-sm">
                  <input type="hidden" name="quoteId" value={quote.id} />
                  <div className="grid grid-cols-3 gap-sm">
                    <div>
                      <label className="label" htmlFor="discountPct">Discount %</label>
                      <input id="discountPct" name="discountPct" type="number" min={0} max={50} step="any" defaultValue={quote.discountPct} className="input w-full" />
                    </div>
                    <div>
                      <label className="label" htmlFor="freight">Freight (₹)</label>
                      <input id="freight" name="freight" type="number" min={0} step="any" defaultValue={quote.freight} className="input w-full" />
                    </div>
                    <div>
                      <label className="label" htmlFor="validUntil">Valid until</label>
                      <input id="validUntil" name="validUntil" type="date" defaultValue={isoDay(quote.validUntil)} className="input w-full" />
                    </div>
                  </div>
                  <label className="flex items-center gap-xs text-body-sm">
                    <input type="checkbox" name="showLineItems" defaultChecked={quote.showLineItems} /> Show every BOM line to the client (off: one lump sum per panel)
                  </label>
                  <div>
                    <label className="label" htmlFor="terms">Terms and conditions</label>
                    <textarea id="terms" name="terms" rows={6} defaultValue={quote.terms} className="textarea w-full font-mono text-caption" />
                  </div>
                  <SubmitButton size="sm">Save terms</SubmitButton>
                </ActionForm>
              ) : (
                <div className="text-body-sm">
                  <p className="text-muted">{quote.showLineItems ? 'Client sees every BOM line.' : 'Client sees one lump sum per panel.'}</p>
                  <p className="mt-xs whitespace-pre-line text-caption text-muted">{quote.terms}</p>
                </div>
              )}
            </div>
          </Card>
        </div>

        <aside className="space-y-lg">
          <Card title="Pricing advice">
            <p className="text-caption text-muted">
              {insights.relationship.tierLabel} · {insights.relationship.wonOrders} past order{insights.relationship.wonOrders === 1 ? '' : 's'}
              {insights.relationship.totalWonValue ? ` · ${inrShort(insights.relationship.totalWonValue)}` : ''}
              {insights.relationship.yearsWithUs >= 1 ? ` · ${insights.relationship.yearsWithUs} yrs` : ''}
            </p>
            <div className="mt-sm flex items-baseline justify-between">
              <span className="text-body-sm text-muted">Suggested margin</span>
              <span className="text-display-sm text-ink">{pct(insights.margin.suggestedPct)}</span>
            </div>
            <p className="text-caption text-muted">
              Now {totals.net ? pct(totals.marginPct) : '—'} · confidence {insights.margin.confidence.toLowerCase()} · company target {pct(insights.margin.basePct)}
            </p>
            {insights.margin.reasons.length ? (
              <ul className="mt-sm space-y-xxs text-caption">
                {insights.margin.reasons.map((r, i) => (
                  <li key={i} className="flex justify-between gap-sm">
                    <span className="text-body">{r.label}</span>
                    <span className={r.deltaPct > 0 ? 'text-success' : r.deltaPct < 0 ? 'text-error' : 'text-muted'}>{r.deltaPct > 0 ? '+' : ''}{r.deltaPct}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-sm text-caption text-muted">No history for this client yet: the suggestion is the company target. Import past quotes to sharpen it.</p>
            )}
            {flags.editable && quote.lines.length && Math.abs(marginGap) >= 0.1 ? (
              <ActionForm action={applyMarginAction} className="mt-sm">
                <input type="hidden" name="quoteId" value={quote.id} />
                <input type="hidden" name="marginPct" value={insights.margin.suggestedPct} />
                <SubmitButton size="sm">Apply {pct(insights.margin.suggestedPct)} to every line</SubmitButton>
              </ActionForm>
            ) : null}
          </Card>

          {insights.lineAdvice.length ? (
            <Card title="Line prices to check">
              <ul className="space-y-xs text-caption">
                {insights.lineAdvice.map((a) => {
                  const line = quote.lines.find((l) => l.id === a.key);
                  return (
                    <li key={a.key}>
                      <span className={a.direction === 'RAISE' ? 'text-success' : 'text-error'}>{a.direction === 'RAISE' ? '↑' : '↓'} {line?.itemCode}</span>: {pct(line?.marginPct ?? 0)} → {pct(a.toMarginPct)}
                      <p className="text-muted">{a.reason}</p>
                    </li>
                  );
                })}
              </ul>
              {flags.editable ? (
                <ActionForm action={applyLineAdviceAction} className="mt-sm">
                  <input type="hidden" name="quoteId" value={quote.id} />
                  {insights.lineAdvice.map((a) => <input key={a.key} type="hidden" name="advice" value={`${a.key}:${a.toMarginPct}`} />)}
                  <SubmitButton size="sm">Apply these margins</SubmitButton>
                </ActionForm>
              ) : null}
            </Card>
          ) : null}

          {flags.editable && insights.bomSuggestions.length ? (
            <Card title={quote.lines.length ? 'Often added with this BOM' : 'Common items for this client'}>
              <ul className="space-y-sm">
                {insights.bomSuggestions.map((s) => (
                  <li key={s.code} className="flex items-start justify-between gap-sm">
                    <div className="min-w-0 text-caption">
                      <p className="truncate text-body-sm text-ink">{s.name}</p>
                      <p className="text-muted"><span className="code">{s.code}</span> · {s.reason}{s.latestCost !== null ? ` · ${formatINR(s.latestCost)}` : ''}</p>
                    </div>
                    {s.itemId ? (
                      <ActionForm action={addLineAction} quiet>
                        <input type="hidden" name="quoteId" value={quote.id} />
                        <input type="hidden" name="itemId" value={s.itemId} />
                        <input type="hidden" name="panel" value={panels[0] ?? 'Panel 1'} />
                        <input type="hidden" name="qty" value={s.typicalQty} />
                        <input type="hidden" name="marginPct" value={insights.margin.suggestedPct} />
                        <button type="submit" className="btn btn-sm btn-secondary whitespace-nowrap">Add {s.typicalQty}</button>
                      </ActionForm>
                    ) : (
                      <span className="shrink-0 text-caption text-muted">Not in catalogue</span>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <Card title="By panel">
            {quote.panels.length === 0 ? (
              <p className="text-caption text-muted">No lines yet.</p>
            ) : (
              <ul className="space-y-xxs text-body-sm">
                {quote.panels.map((p) => (
                  <li key={p.panel} className="flex justify-between gap-sm">
                    <span>{p.panel} <span className="text-caption text-muted">({p.lines})</span></span>
                    <span>{formatINR(p.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <p className="text-caption text-muted">
            Built by {quote.createdBy.fullName} on {shortDate(quote.createdAt)}. Cost and margin never appear on the client’s copy.
          </p>
        </aside>
      </div>
    </div>
  );
}
