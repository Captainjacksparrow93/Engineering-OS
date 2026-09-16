import { requirePrincipal } from '@/core/auth/session';
import { listPendingApprovals } from '@/modules/project-management/services/task.service';
import { ApprovalsTable } from './approvals-table';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Approvals · Engineering OS',
};

export default async function ApprovalsPage() {
  const principal = await requirePrincipal();
  const items = await listPendingApprovals(principal);

  return (
    <div className="space-y-base p-base md:p-xl max-w-content mx-auto">
      <div>
        <h1 className="page-title text-ink">Approvals</h1>
        <p className="text-body-sm text-muted mt-xxs">
          Steps submitted by engineers awaiting quality sign-off and approval.
        </p>
      </div>

      <ApprovalsTable items={items} />
    </div>
  );
}
