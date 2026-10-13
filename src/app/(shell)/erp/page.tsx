import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { hasPermissionAnywhere } from '@/core/rbac/engine';
import { ERP_AREAS } from '@/modules/erp/areas';
import { canRead } from '@/modules/erp/services/access';
import { canManageSettings } from '@/modules/erp/services/settings.service';
import { ensureErpSetup } from '@/modules/erp/services/setup';
import { prisma } from '@/core/db/prisma';
import { PageHeader, Stat } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'ERP' };

/** ERP home: one card per area the person can open, and the drafts waiting on them. */
export default async function ErpHomePage() {
  const p = await requirePrincipal();
  if (!hasPermissionAnywhere(p, 'erp.access')) notFound();
  await ensureErpSetup(p.companyId);
  const areas = ERP_AREAS.filter((a) => canRead(p, a.area));
  const stock = canRead(p, 'stock');
  const [drafts, itemCount] = stock
    ? await Promise.all([
        prisma.erpStockEntry.count({ where: { companyId: p.companyId, status: 'DRAFT' } }),
        prisma.erpItem.count({ where: { companyId: p.companyId, isActive: true } }),
      ])
    : [0, 0];

  return (
    <div className="space-y-lg">
      <PageHeader
        title="ERP"
        subtitle="Stock, buying, selling, manufacturing, quality, maintenance and accounts in one place, wired into Projects and Sales."
        actions={canManageSettings(p) ? <Link href="/erp/settings" className="btn btn-secondary">ERP settings</Link> : null}
      />

      {stock ? (
        <div className="grid gap-base sm:grid-cols-3">
          <Stat label="Active items" value={itemCount} />
          <Stat label="Draft stock entries" value={drafts} hint={drafts ? 'Waiting to be submitted' : undefined} />
        </div>
      ) : null}

      <div className="grid gap-base sm:grid-cols-2 lg:grid-cols-3">
        {areas.map((a) =>
          a.live ? (
            <Link key={a.area} href={a.href} className="card block p-lg transition-colors hover:border-ink">
              <h2 className="text-title-sm text-ink">{a.name}</h2>
              <p className="mt-xs text-body-sm text-muted">{a.description}</p>
            </Link>
          ) : (
            <div key={a.area} className="card p-lg opacity-70">
              <h2 className="text-title-sm text-ink">{a.name} <span className="badge badge-outline ml-xs align-middle">Coming next</span></h2>
              <p className="mt-xs text-body-sm text-muted">{a.description}</p>
            </div>
          ),
        )}
      </div>
    </div>
  );
}
