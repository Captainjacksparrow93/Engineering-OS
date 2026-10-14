import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { hasPermissionAnywhere } from '@/core/rbac/engine';
import { getDeal, listSalespeople } from '@/modules/sales/services/deal.service';
import { seesAllDeals } from '@/modules/sales/services/access';
import { OPEN_STAGES } from '@/modules/sales/validation';
import {
  addActivityAction,
  addContactAction,
  closeDealAction,
  completeActivityAction,
  createQuoteAction,
  moveStageAction,
  updateDealAction,
} from '@/app/actions/sales';
import { Card, PageHeader } from '@/components/ui';
import { SubmitButton } from '@/components/form';
import { ActionForm } from '@/components/action-form';
import { DealStageBadge, QuoteStatusBadge, STAGE_NAMES } from '../../_components/badges';
import { inrShort, isoDay, pct, shortDate } from '../../_components/format';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Deal' };

const ACTIVITY_LABELS: Record<string, string> = { NOTE: 'Note', CALL: 'Call', MEETING: 'Meeting', EMAIL: 'Email', FOLLOW_UP: 'Follow-up', STAGE: 'Stage' };

export default async function DealPage({ params }: { params: Promise<{ id: string }> }) {
  const principal = await requirePrincipal();
  const { id } = await params;
  let deal;
  try {
    deal = await getDeal(principal, id);
  } catch {
    notFound();
  }
  const team = seesAllDeals(principal);
  const people = team && deal.canEdit ? await listSalespeople(principal) : [];
  const open = (OPEN_STAGES as readonly string[]).includes(deal.stage);
  const edit = deal.canEdit && open;
  const liveQuote = deal.quotes.find((q) => q.status !== 'SUPERSEDED');

  return (
    <div className="space-y-lg">
      <PageHeader
        title={deal.title}
        breadcrumb={[{ label: 'Deals', href: '/sales/deals' }, { label: deal.code }]}
        subtitle={
          <span className="flex flex-wrap items-center gap-xs">
            <DealStageBadge stage={deal.stage} />
            <Link href={`/sales/accounts/${deal.account.id}`} className="link-muted">{deal.account.name}</Link>
            <span>· {deal.owner.fullName}</span>
            <span>· {deal.value ? inrShort(deal.value) : 'No value yet'}</span>
            {deal.expectedCloseDate ? <span>· order expected {shortDate(deal.expectedCloseDate)}</span> : null}
          </span>
        }
        actions={
          edit ? (
            <ActionForm action={createQuoteAction}>
              <input type="hidden" name="dealId" value={deal.id} />
              <SubmitButton variant="primary" pendingLabel="Building…">{liveQuote ? 'New quote from the latest' : 'Build quote'}</SubmitButton>
            </ActionForm>
          ) : null
        }
      />

      {edit ? (
        <div className="flex flex-wrap items-center gap-xs">
          <span className="text-caption text-muted">Move to</span>
          {OPEN_STAGES.map((s) => (
            <ActionForm key={s} action={moveStageAction} quiet>
              <input type="hidden" name="dealId" value={deal.id} />
              <input type="hidden" name="stage" value={s} />
              <button type="submit" disabled={deal.stage === s} className={`btn btn-sm ${deal.stage === s ? 'btn-ink' : 'btn-secondary'}`}>{STAGE_NAMES[s]}</button>
            </ActionForm>
          ))}
        </div>
      ) : null}

      {!open ? (
        <Card>
          <p className="text-body-sm text-ink">
            {deal.stage === 'WON' ? 'Won' : 'Lost'} on {shortDate(deal.closedAt)}.
            {deal.stage === 'LOST' && deal.lostReason ? ` Reason: ${deal.lostReason}` : ''}
            {deal.erpSalesOrder ? <> Sales order <Link href={`/erp/selling/orders/number/${encodeURIComponent(deal.erpSalesOrder)}`} className="code-chip hover:underline">{deal.erpSalesOrder}</Link></> : null}
            {deal.woNumber ? <> · WO <span className="code-chip">{deal.woNumber}</span></> : null}
          </p>
        </Card>
      ) : null}

      <div className="grid gap-lg lg:grid-cols-3">
        <div className="space-y-lg lg:col-span-2">
          <Card title="Quotes" bodyClassName="p-0">
            {deal.quotes.length === 0 ? (
              <p className="p-base text-body-sm text-muted">No quote yet. "Build quote" opens the BOM builder with today’s prices and a suggested margin.</p>
            ) : (
              <table className="table">
                <thead><tr><th>Quote</th><th>Status</th><th className="text-right">Value (before GST)</th><th className="text-right">Margin</th><th>By</th><th>Updated</th></tr></thead>
                <tbody>
                  {deal.quotes.map((q) => (
                    <tr key={q.id}>
                      <td><Link href={`/sales/quotes/${q.id}`} className="code-chip whitespace-nowrap hover:underline">{q.number} R{q.revision}</Link></td>
                      <td><QuoteStatusBadge status={q.status} /></td>
                      <td className="text-right">{inrShort(q.totals.net)}</td>
                      <td className="text-right">{q.lineCount ? pct(q.totals.marginPct) : '—'}</td>
                      <td>{q.createdBy.fullName}</td>
                      <td>{shortDate(q.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {edit && deal.accountQuotes.length ? (
              <ActionForm action={createQuoteAction} className="flex flex-wrap items-end gap-sm border-t border-hairline p-base">
                <input type="hidden" name="dealId" value={deal.id} />
                <div className="min-w-64 flex-1">
                  <label className="label" htmlFor="copyFromQuoteId">Or start from a past quote for {deal.account.name}</label>
                  <select id="copyFromQuoteId" name="copyFromQuoteId" className="select w-full" required>
                    {deal.accountQuotes.map((q) => <option key={q.id} value={q.id}>{q.number} R{q.revision}: {q.deal.title}</option>)}
                  </select>
                </div>
                <SubmitButton pendingLabel="Copying…">Copy at today’s prices</SubmitButton>
              </ActionForm>
            ) : null}
          </Card>

          <Card title="Activity">
            {edit ? (
              <ActionForm action={addActivityAction} resetOnSuccess quiet className="mb-base grid gap-sm sm:grid-cols-[140px_1fr_160px_auto] sm:items-end">
                <input type="hidden" name="dealId" value={deal.id} />
                <div>
                  <label className="label" htmlFor="type">Type</label>
                  <select id="type" name="type" className="select w-full" defaultValue="CALL">
                    {['CALL', 'MEETING', 'EMAIL', 'NOTE', 'FOLLOW_UP'].map((t) => <option key={t} value={t}>{ACTIVITY_LABELS[t]}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="note">What happened, or what to do</label>
                  <input id="note" name="note" required minLength={2} className="input w-full" placeholder="e.g. Client wants a separate VFD panel" />
                </div>
                <div>
                  <label className="label" htmlFor="dueAt">Follow up on</label>
                  <input id="dueAt" name="dueAt" type="date" className="input w-full" />
                </div>
                <SubmitButton>Log</SubmitButton>
              </ActionForm>
            ) : null}
            {deal.activities.length === 0 ? (
              <p className="text-body-sm text-muted">Nothing logged yet.</p>
            ) : (
              <ul className="space-y-sm">
                {deal.activities.map((a) => (
                  <li key={a.id} className="flex items-start justify-between gap-sm border-b border-hairline-soft pb-xs last:border-0">
                    <div>
                      <p className="text-body-sm text-ink">
                        <span className="badge badge-neutral mr-xs">{ACTIVITY_LABELS[a.type]}</span>
                        {a.note}
                      </p>
                      <p className="text-caption text-muted">
                        {a.user.fullName} · {shortDate(a.createdAt)}
                        {a.dueAt ? <> · {a.doneAt ? 'done' : <span className={a.dueAt < new Date() ? 'text-error' : ''}>due {shortDate(a.dueAt)}</span>}</> : null}
                      </p>
                    </div>
                    {a.dueAt && !a.doneAt && deal.canEdit ? (
                      <ActionForm action={completeActivityAction} quiet>
                        <input type="hidden" name="activityId" value={a.id} />
                        <input type="hidden" name="dealId" value={deal.id} />
                        <button type="submit" className="btn btn-sm btn-secondary">Done</button>
                      </ActionForm>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-lg">
          <Card title="Contact">
            {deal.contact ? (
              <div className="text-body-sm">
                <p className="text-ink">{deal.contact.name}{deal.contact.designation ? `, ${deal.contact.designation}` : ''}</p>
                {deal.contact.email ? <p><a href={`mailto:${deal.contact.email}`} className="link-muted">{deal.contact.email}</a></p> : null}
                {deal.contact.phone ? <p><a href={`tel:${deal.contact.phone}`} className="link-muted">{deal.contact.phone}</a></p> : null}
              </div>
            ) : (
              <p className="text-body-sm text-muted">No contact on this deal. The quote email goes to the deal contact.</p>
            )}
            {edit ? (
              <details className="mt-sm">
                <summary className="cursor-pointer text-body-sm text-muted">Add a contact at {deal.account.name}</summary>
                <ActionForm action={addContactAction} resetOnSuccess className="mt-sm space-y-xs">
                  <input type="hidden" name="accountId" value={deal.accountId} />
                  <input type="hidden" name="dealId" value={deal.id} />
                  <input name="name" required placeholder="Name" className="input w-full" aria-label="Name" />
                  <input name="designation" placeholder="Designation" className="input w-full" aria-label="Designation" />
                  <input name="email" type="email" placeholder="Email" className="input w-full" aria-label="Email" />
                  <input name="phone" placeholder="Phone" className="input w-full" aria-label="Phone" />
                  <SubmitButton size="sm">Add contact</SubmitButton>
                </ActionForm>
              </details>
            ) : null}
          </Card>

          {edit ? (
            <Card title="Details">
              <ActionForm action={updateDealAction} className="space-y-sm">
                <input type="hidden" name="dealId" value={deal.id} />
                <div>
                  <label className="label" htmlFor="d-title">Title</label>
                  <input id="d-title" name="title" defaultValue={deal.title} required className="input w-full" />
                </div>
                <div>
                  <label className="label" htmlFor="d-contact">Contact</label>
                  <select id="d-contact" name="contactId" defaultValue={deal.contactId ?? ''} className="select w-full">
                    <option value="">None</option>
                    {deal.contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-sm">
                  <div>
                    <label className="label" htmlFor="d-value">Value (₹)</label>
                    <input id="d-value" name="value" type="number" min={0} step="any" defaultValue={deal.value || ''} className="input w-full" disabled={deal.quotes.length > 0} title={deal.quotes.length ? 'Follows the latest quote' : undefined} />
                  </div>
                  <div>
                    <label className="label" htmlFor="d-close">Order expected</label>
                    <input id="d-close" name="expectedCloseDate" type="date" defaultValue={isoDay(deal.expectedCloseDate)} className="input w-full" />
                  </div>
                </div>
                <div>
                  <label className="label" htmlFor="d-source">Source</label>
                  <input id="d-source" name="source" defaultValue={deal.source ?? ''} className="input w-full" />
                </div>
                {team ? (
                  <div>
                    <label className="label" htmlFor="d-owner">Owner</label>
                    <select id="d-owner" name="ownerId" defaultValue={deal.ownerId} className="select w-full">
                      {people.map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}
                      {people.some((p) => p.id === deal.ownerId) ? null : <option value={deal.ownerId}>{deal.owner.fullName}</option>}
                    </select>
                  </div>
                ) : null}
                <div>
                  <label className="label" htmlFor="d-notes">Notes</label>
                  <textarea id="d-notes" name="notes" rows={3} defaultValue={deal.notes ?? ''} className="textarea w-full" />
                </div>
                <SubmitButton size="sm">Save details</SubmitButton>
              </ActionForm>
            </Card>
          ) : deal.notes ? (
            <Card title="Notes"><p className="whitespace-pre-line text-body-sm">{deal.notes}</p></Card>
          ) : null}

          {edit ? (
            <Card title="Close the deal">
              <ActionForm action={closeDealAction} className="space-y-sm">
                <input type="hidden" name="dealId" value={deal.id} />
                <input type="hidden" name="outcome" value="WON" />
                <p className="text-caption text-muted">Won: the approved quote is accepted, its prices teach the pricing advice, and a draft sales order is made from it in ERP for the Sales Head or a Director to check and submit.</p>
                <input name="woNumber" placeholder="WO number (digits, optional)" className="input w-full" aria-label="WO number" />
                <SubmitButton size="sm" variant="ink" confirm="Mark this deal won?">Mark won</SubmitButton>
              </ActionForm>
              <ActionForm action={closeDealAction} className="mt-base space-y-sm border-t border-hairline pt-base">
                <input type="hidden" name="dealId" value={deal.id} />
                <input type="hidden" name="outcome" value="LOST" />
                <input name="lostReason" required placeholder="Why was it lost? (price, delivery, competitor…)" className="input w-full" aria-label="Lost reason" />
                <SubmitButton size="sm" variant="danger" confirm="Mark this deal lost?">Mark lost</SubmitButton>
              </ActionForm>
            </Card>
          ) : null}
        </div>
      </div>

      {!hasPermissionAnywhere(principal, 'sales.deal.manage') ? <p className="text-caption text-muted">You can view this deal but not change it.</p> : null}
    </div>
  );
}
