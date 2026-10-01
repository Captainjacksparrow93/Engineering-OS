import { requirePrincipal } from '@/core/auth/session';
import { hasPermissionAnywhere } from '@/core/rbac/engine';
import { redirect } from 'next/navigation';
import { PageHeader, Alert } from '@/components/ui';
import { config } from '@/core/config';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'ERP',
};

export default async function ERPPage() {
  const principal = await requirePrincipal();
  if (!hasPermissionAnywhere(principal, 'erp.access')) {
    redirect('/dashboard');
  }

  const appConfig = config();
  const isConfigured = Boolean(appConfig.ERPNEXT_PUBLIC_URL && appConfig.ERP_SSO_SECRET);

  return (
    <div className="space-y-lg">
      <PageHeader
        title="ERP"
        subtitle="Opens ERPNext in a new tab; you will be signed in automatically."
      />

      <div className="card max-w-xl">
        <div className="card-body space-y-md">
          <p className="text-body-sm text-muted">
            Access sales orders, purchase, inventory, costing and accounts directly in ERPNext.
          </p>

          {!isConfigured ? (
            <Alert tone="warning">
              ERP connection is not configured yet. Set ERPNEXT_PUBLIC_URL and ERP_SSO_SECRET in the environment.
            </Alert>
          ) : (
            <div>
              <Link
                href="/erp/open"
                target="_blank"
                rel="noopener"
                className="btn-primary inline-flex items-center gap-xs"
              >
                Open ERP
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
