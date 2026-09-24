import { requirePrincipal } from '@/core/auth/session';
import { hasPermissionAnywhere } from '@/core/rbac/engine';
import { listPendingApprovals } from '@/modules/project-management/services/task.service';
import { listPendingCommissioningApprovals } from '@/modules/project-management/services/commissioning.service';
import { ApprovalsTable } from './approvals-table';
import { CommissioningApprovalsTable } from './commissioning-approvals-table';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Approvals',
};

export default async function ApprovalsPage() {
  const principal = await requirePrincipal();
  const canApproveCommissioning = hasPermissionAnywhere(principal, 'pm.commissioning.approve');

  const [stepItems, commissioningLogs] = await Promise.all([
    listPendingApprovals(principal),
    canApproveCommissioning ? listPendingCommissioningApprovals(principal) : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-base p-base md:p-xl max-w-content mx-auto">
      <div>
        <h1 className="page-title text-ink">Approvals</h1>
        <p className="text-body-sm text-muted mt-xxs">
          Steps and site commissioning daily logs awaiting sign-off and approval.
        </p>
      </div>

      <div className="space-y-6">
        <div>
          <h2 className="text-body font-semibold text-ink mb-3">Project Steps</h2>
          <ApprovalsTable items={stepItems} />
        </div>

        {canApproveCommissioning && (
          <div className="pt-4 border-t border-hairline">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-body font-semibold text-ink">Site Commissioning Logs</h2>
                <p className="text-caption text-muted">Daily attendance and work reports recorded on site</p>
              </div>
              <span className="badge badge-outline">{commissioningLogs.length} pending</span>
            </div>
            <CommissioningApprovalsTable items={commissioningLogs} />
          </div>
        )}
      </div>
    </div>
  );
}

