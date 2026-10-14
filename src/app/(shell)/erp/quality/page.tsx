import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { prisma } from '@/core/db/prisma';
import { canRead } from '@/modules/erp/services/access';
import { listNonConformances, NC_STATUS_LABEL } from '@/modules/erp/services/nc.service';
import { listDocuments } from '@/modules/erp/services/quality-doc.service';
import { Card, EmptyState, PageHeader, Stat } from '@/components/ui';
import { DocStatus, showDate } from '../_components/parts';
import { QualityTabs } from './tabs';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Quality' };

export default async function QualityPage() {
  const p = await requirePrincipal();
  if (!canRead(p, 'quality')) notFound();
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [open, docs, drafts, results] = await Promise.all([
    listNonConformances(p, { status: 'OPEN_ALL' }),
    listDocuments(p),
    prisma.erpQualityInspection.count({ where: { companyId: p.companyId, status: 'DRAFT' } }),
    prisma.erpQualityInspection.groupBy({ by: ['result'], where: { companyId: p.companyId, status: 'SUBMITTED', inspectionDate: { gte: since } }, _count: true }),
  ]);
  const accepted = results.find((r) => r.result === 'ACCEPTED')?._count ?? 0;
  const rejected = results.find((r) => r.result === 'REJECTED')?._count ?? 0;
  const waiting = docs.filter((d) => d.latest?.status === 'PENDING_APPROVAL');
  return (
    <div className="space-y-lg">
      <PageHeader title="Quality" breadcrumb={[{ label: 'ERP', href: '/erp' }, { label: 'Quality' }]} />
      <QualityTabs current="/erp/quality" />
      <div className="grid gap-base sm:grid-cols-4">
        <Stat label="Open non-conformances" value={open.length} tone={open.some((n) => n.severity === 'CRITICAL') ? 'warning' : 'default'} />
        <Stat label="Inspections in progress" value={drafts} />
        <Stat label="First-pass yield, 30 days" value={accepted + rejected ? `${Math.round((accepted / (accepted + rejected)) * 100)}%` : '—'} hint={`${accepted} accepted, ${rejected} rejected`} />
        <Stat label="Revisions to approve" value={waiting.length} />
      </div>
      <div className="grid gap-lg lg:grid-cols-2">
        <Card title="Open non-conformances" action={<Link href="/erp/quality/non-conformances" className="link-muted text-caption">All</Link>}>
          {open.length === 0 ? <EmptyState title="Nothing open" /> : (
            <table className="table"><tbody>{open.slice(0, 10).map((n) => <tr key={n.id}><td><Link href={`/erp/quality/non-conformances/${n.id}`} className="code hover:underline">{n.number}</Link></td><td>{n.title}</td><td>{n.dueDate ? showDate(n.dueDate) : ''}</td><td><DocStatus status={n.status} label={NC_STATUS_LABEL[n.status]} /></td></tr>)}</tbody></table>
          )}
        </Card>
        <Card title="Revisions waiting for approval" action={<Link href="/erp/quality/documents" className="link-muted text-caption">All</Link>}>
          {waiting.length === 0 ? <EmptyState title="Nothing waiting" /> : (
            <table className="table"><tbody>{waiting.map((d) => <tr key={d.id}><td><Link href={`/erp/quality/documents/${d.id}`} className="code hover:underline">{d.code}</Link></td><td>{d.title}</td><td>Rev {d.latest?.revision}</td></tr>)}</tbody></table>
          )}
        </Card>
      </div>
    </div>
  );
}
