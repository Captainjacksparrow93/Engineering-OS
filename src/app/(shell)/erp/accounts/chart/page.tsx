import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { canManage, canRead } from '@/modules/erp/services/access';
import { canManageSettings, chartOfAccounts } from '@/modules/erp/services/settings.service';
import { prisma } from '@/core/db/prisma';
import { D } from '@/modules/erp/domain/money';
import { ACCOUNT_TYPES } from '@/modules/erp/validation';
import { createAccountAction, renameAccountAction, setAccountActiveAction } from '@/app/actions/erp-accounts';
import { ActionForm } from '@/components/action-form';
import { SubmitButton } from '@/components/form';
import { Card, PageHeader } from '@/components/ui';
import { DocButton } from '../../_components/doc-button';
import { Field, Money } from '../../_components/parts';
import { AccountsTabs } from '../tabs';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Chart of accounts' };

export default async function ChartPage() {
  const p = await requirePrincipal();
  if (!canRead(p, 'accounts')) notFound();
  const manage = canManage(p, 'accounts') || canManageSettings(p);
  const [chart, sums] = await Promise.all([chartOfAccounts(p.companyId), prisma.erpGlEntry.groupBy({ by: ['accountId'], where: { companyId: p.companyId, isCancelled: false }, _sum: { debit: true, credit: true } })]);
  const bal = new Map(sums.map((s) => [s.accountId, D(s._sum.debit).minus(D(s._sum.credit))]));
  const groups = chart.filter((a) => a.isGroup && a.isActive);
  return (
    <div className="space-y-lg">
      <PageHeader title="Chart of accounts" subtitle="Indian standard chart. System accounts are used by the posting engine and can't be switched off." breadcrumb={[{ label: 'ERP', href: '/erp' }, { label: 'Accounts', href: '/erp/accounts' }, { label: 'Chart of accounts' }]} />
      <AccountsTabs current="/erp/accounts/chart" />
      <Card>
        <table className="table">
          <thead><tr><th>Account</th><th>Type</th><th className="text-right">Balance (Dr +)</th>{manage ? <th /> : null}</tr></thead>
          <tbody>{chart.map((a) => (
            <tr key={a.id} className={a.isActive ? '' : 'text-muted'}>
              <td style={{ paddingLeft: `${0.75 + a.depth * 1.25}rem` }} className={a.isGroup ? 'font-medium' : ''}>
                {a.isGroup ? <><span className="code mr-xs">{a.code}</span>{a.name}</> : <Link href={`/erp/accounts/reports/general-ledger?account=${a.id}`} className="hover:underline"><span className="code mr-xs">{a.code}</span>{a.name}</Link>}
                {a.systemKey ? <span className="badge badge-outline ml-xs">system</span> : null}
                {!a.isActive ? <span className="badge badge-neutral ml-xs">off</span> : null}
              </td>
              <td className="text-caption text-muted">{a.accountType?.replaceAll('_', ' ').toLowerCase() ?? ''}</td>
              <td className="text-right">{a.isGroup || !bal.get(a.id) || bal.get(a.id)!.isZero() ? '' : <Money value={bal.get(a.id)} />}</td>
              {manage ? (
                <td className="text-right">
                  <details className="inline-block text-left">
                    <summary className="cursor-pointer text-caption text-muted">Edit</summary>
                    <ActionForm action={renameAccountAction} className="mt-xs flex items-end gap-xs">
                      <input type="hidden" name="id" value={a.id} />
                      <input name="name" defaultValue={a.name} className="input" aria-label="Account name" />
                      <SubmitButton size="sm">Rename</SubmitButton>
                    </ActionForm>
                    {!a.systemKey ? <div className="mt-xs"><DocButton action={setAccountActiveAction} fields={{ id: a.id, active: a.isActive ? '0' : '1' }} label={a.isActive ? 'Switch off' : 'Switch on'} /></div> : null}
                  </details>
                </td>
              ) : null}
            </tr>
          ))}</tbody>
        </table>
      </Card>
      {manage ? (
        <Card title="New account">
          <ActionForm action={createAccountAction} resetOnSuccess className="flex flex-wrap items-end gap-sm">
            <div>
              <label className="label" htmlFor="parentId">Under</label>
              <select id="parentId" name="parentId" className="select" required defaultValue=""><option value="" disabled>Pick a group</option>{groups.map((g) => <option key={g.id} value={g.id}>{'· '.repeat(g.depth)}{g.code} {g.name}</option>)}</select>
            </div>
            <Field label="Code" name="code" required placeholder="1122" />
            <Field label="Name" name="name" required placeholder="HDFC Current Account" />
            <div>
              <label className="label" htmlFor="accountType">Type</label>
              <select id="accountType" name="accountType" className="select" defaultValue=""><option value="">Ordinary</option>{ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{t.replaceAll('_', ' ').toLowerCase()}</option>)}</select>
            </div>
            <label className="flex items-center gap-xs pb-xs text-body-sm"><input type="checkbox" name="isGroup" /> Group</label>
            <SubmitButton variant="primary">Add account</SubmitButton>
          </ActionForm>
        </Card>
      ) : null}
    </div>
  );
}
