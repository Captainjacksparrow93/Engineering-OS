import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { canManage, canRead } from '@/modules/erp/services/access';
import { listClosings } from '@/modules/erp/services/ledger.service';
import { getSettings } from '@/modules/erp/services/setup';
import { fiscalYear } from '@/modules/erp/domain/chart';
import { closeFiscalYearAction, reopenFiscalYearAction, setBooksLockAction } from '@/app/actions/erp-accounts';
import { ActionForm } from '@/components/action-form';
import { SubmitButton } from '@/components/form';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { DocButton } from '../../_components/doc-button';
import { DocStatus, Field, isoDay, Money, showDate } from '../../_components/parts';
import { AccountsTabs } from '../tabs';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Closing the books' };

export default async function ClosingPage() {
  const p = await requirePrincipal();
  if (!canRead(p, 'accounts')) notFound();
  const manage = canManage(p, 'accounts');
  const [closings, settings] = await Promise.all([listClosings(p), getSettings(p.companyId)]);
  const now = new Date();
  const ended = [1, 2, 3, 4].map((n) => fiscalYear(new Date(Date.UTC(now.getUTCFullYear() - n, 6, 1)))).filter((fy) => fy.end < now && !closings.some((c) => c.fiscalYear === fy.label && c.status === 'SUBMITTED'));
  const latest = closings.find((c) => c.status === 'SUBMITTED');
  return (
    <div className="space-y-lg">
      <PageHeader title="Closing the books" subtitle="Lock a period once it is filed, and close each fiscal year into Retained Earnings." breadcrumb={[{ label: 'ERP', href: '/erp' }, { label: 'Accounts', href: '/erp/accounts' }, { label: 'Closing' }]} />
      <AccountsTabs current="/erp/accounts/closing" />
      <Card title="Books locked up to">
        <p className="mb-sm text-body-sm">{settings.booksClosedUpTo ? `Nothing can be posted on or before ${showDate(settings.booksClosedUpTo)}.` : 'The books are open for every date.'}</p>
        {manage ? (
          <ActionForm action={setBooksLockAction} className="flex flex-wrap items-end gap-sm">
            <Field label="Lock up to" name="upTo" type="date" defaultValue={isoDay(settings.booksClosedUpTo)} />
            <SubmitButton size="sm">Save</SubmitButton>
          </ActionForm>
        ) : null}
      </Card>
      {manage && ended.length ? (
        <Card title="Close a fiscal year">
          <ActionForm action={closeFiscalYearAction} className="flex flex-wrap items-end gap-sm">
            <div>
              <label className="label" htmlFor="yearEnd">Fiscal year</label>
              <select id="yearEnd" name="yearEnd" className="select" defaultValue={isoDay(ended.at(-1)!.end)}>{ended.map((fy) => <option key={fy.label} value={isoDay(fy.end)}>{fy.label}</option>)}</select>
            </div>
            <Field label="Remarks" name="remarks" />
            <SubmitButton variant="primary" confirm="Close this year? Its profit moves to Retained Earnings and the books lock up to the year end.">Close year</SubmitButton>
          </ActionForm>
        </Card>
      ) : null}
      <Card title="Closed years">
        {closings.length === 0 ? <EmptyState title="No year closed yet" /> : (
          <table className="table">
            <thead><tr><th>Fiscal year</th><th>Period</th><th className="text-right">Net profit</th><th>Status</th><th /></tr></thead>
            <tbody>{closings.map((c) => (
              <tr key={c.id}>
                <td>{c.fiscalYear}</td>
                <td>{showDate(c.yearStart)} – {showDate(c.yearEnd)}</td>
                <td className="text-right"><Money value={c.netProfit} /></td>
                <td><DocStatus status={c.status === 'SUBMITTED' ? 'COMPLETED' : c.status} label={c.status === 'SUBMITTED' ? 'Closed' : 'Re-opened'} /></td>
                <td className="text-right">{manage && latest?.id === c.id ? <DocButton action={reopenFiscalYearAction} fields={{ id: c.id }} label="Re-open" confirm="Re-open this year? Its closing entries are reversed and the books unlock." /> : null}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
