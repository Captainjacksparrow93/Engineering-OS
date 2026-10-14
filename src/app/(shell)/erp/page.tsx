import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { hasPermissionAnywhere } from '@/core/rbac/engine';
import { ERP_AREAS } from '@/modules/erp/areas';
import { canRead } from '@/modules/erp/services/access';
import { canManageSettings } from '@/modules/erp/services/settings.service';
import { ensureErpSetup } from '@/modules/erp/services/setup';
import { erpHomeKpis, monthlyTrend } from '@/modules/erp/services/analytics.service';
import { formatMoney } from '@/modules/erp/domain/money';
import { Card, PageHeader, Stat } from '@/components/ui';
import { MonthBars } from './_components/charts';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'ERP' };

/** ERP home: one card per area the person can open, and the drafts waiting on them. */
export default async function ErpHomePage() {
  const p = await requirePrincipal();
  if (!hasPermissionAnywhere(p, 'erp.access')) notFound();
  await ensureErpSetup(p.companyId);
  const areas = ERP_AREAS.filter((a) => canRead(p, a.area));
  const [kpis, sales, purchases] = await Promise.all([
    erpHomeKpis(p),
    canRead(p, 'selling') ? monthlyTrend(p, 'sales') : null,
    canRead(p, 'buying') ? monthlyTrend(p, 'purchases') : null,
  ]);

  return (
    <div className="space-y-lg">
      <PageHeader
        title="ERP"
        subtitle="Stock, buying, selling, manufacturing, quality, maintenance and accounts in one place, wired into Projects and Sales."
        actions={canManageSettings(p) ? <Link href="/erp/settings" className="btn btn-secondary">ERP settings</Link> : null}
      />

      {kpis.length ? (
        <div className="grid gap-base sm:grid-cols-2 lg:grid-cols-4">
          {kpis.map((k) => (
            <Link key={k.label} href={k.href} className="block">
              <Stat label={k.label} value={k.money ? formatMoney(k.value) : k.value.toString()} tone={k.warn ? 'warning' : 'default'} />
            </Link>
          ))}
        </div>
      ) : null}

      {sales || purchases ? (
        <div className="grid gap-lg lg:grid-cols-2">
          {sales ? <Card title="Sales by month (net of GST)"><MonthBars points={sales} label="Sales" /></Card> : null}
          {purchases ? <Card title="Purchases by month (net of GST)"><MonthBars points={purchases} label="Purchases" /></Card> : null}
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
