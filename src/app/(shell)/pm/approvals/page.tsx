import { requirePrincipal } from '@/core/auth/session';
import { can, hasPermissionAnywhere } from '@/core/rbac/engine';
import { listPendingApprovals } from '@/modules/project-management/services/task.service';
import { listPendingCommissioningApprovals } from '@/modules/project-management/services/commissioning.service';
import { listHandovers } from '@/modules/project-management/services/handover.service';
import { ApprovalsTable } from './approvals-table';
import { CommissioningApprovalsTable } from './commissioning-approvals-table';
import { HandoversApprovalsTable } from './handovers-approvals-table';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Approvals',
};

export default async function ApprovalsPage() {
  const principal = await requirePrincipal();
  const canApproveCommissioning = hasPermissionAnywhere(principal, 'pm.commissioning.approve');

  const [stepItems, commissioningLogs, handovers] = await Promise.all([
    listPendingApprovals(principal),
    canApproveCommissioning ? listPendingCommissioningApprovals(principal) : Promise.resolve([]),
    listHandovers(principal),
  ]);

  const isDirector = can(principal, 'pm.project.read.all');

  // Task handovers awaiting a decision:
  // - Incoming: explicitly assigned to principal
  // - Oversight: in projects visible to principal (all projects for Director, managed projects for PM)
  const pendingTaskHandovers = [
    ...handovers.incoming,
    ...(isDirector
      ? handovers.oversight
      : handovers.oversight.filter((h) => h.task.project.managerId === principal.userId)),
  ];

  // Project handovers awaiting a decision:
  // - Incoming: explicitly assigned to principal
  // - Oversight: Director can decide any project handover in the company
  const pendingProjectHandovers = [
    ...handovers.incomingProjects,
    ...(isDirector ? handovers.oversightProjects : []),
  ];

  const handoversCount = pendingTaskHandovers.length + pendingProjectHandovers.length;
  const totalActionable = stepItems.length + commissioningLogs.length + handoversCount;

  return (
    <div className="space-y-base p-base md:p-xl max-w-content mx-auto">
      <div>
        <h1 className="page-title text-ink">Approvals</h1>
        <p className="text-body-sm text-muted mt-xxs">
          Steps, handover requests, and site commissioning daily logs awaiting sign-off and approval.
        </p>
      </div>

      {totalActionable === 0 ? (
        <div className="card p-xl text-center">
          <p className="text-body font-medium text-ink">Nothing is waiting on you</p>
          <p className="text-caption text-muted mt-xs">
            All steps, handover requests, and site commissioning logs are clear.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {stepItems.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-body font-semibold text-ink">Project Steps</h2>
                <span className="badge badge-outline">{stepItems.length} pending</span>
              </div>
              <ApprovalsTable items={stepItems} />
            </div>
          )}

          {handoversCount > 0 && (
            <div className={stepItems.length > 0 ? 'pt-4 border-t border-hairline' : ''}>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="text-body font-semibold text-ink">Pending Handovers</h2>
                  <p className="text-caption text-muted">
                    Reassignment and project ownership requests awaiting decision
                  </p>
                </div>
                <span className="badge badge-outline">{handoversCount} pending</span>
              </div>
              <HandoversApprovalsTable
                taskHandovers={pendingTaskHandovers}
                projectHandovers={pendingProjectHandovers}
              />
            </div>
          )}

          {canApproveCommissioning && commissioningLogs.length > 0 && (
            <div className={stepItems.length > 0 || handoversCount > 0 ? 'pt-4 border-t border-hairline' : ''}>
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
      )}
    </div>
  );
}
