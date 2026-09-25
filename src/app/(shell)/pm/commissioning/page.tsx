import { redirect } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { hasPermissionAnywhere } from '@/core/rbac/engine';
import { PageHeader } from '@/components/ui';
import {
  listCommissioningProjects,
  listEligibleEngineers,
} from '@/modules/project-management/services/commissioning.service';
import { CommissioningClient } from './commissioning-client';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Site Commissioning',
};

export default async function SiteCommissioningPage() {
  const principal = await requirePrincipal();

  if (!hasPermissionAnywhere(principal, 'pm.commissioning.read')) {
    redirect('/dashboard');
  }
  const canManage = hasPermissionAnywhere(principal, 'pm.commissioning.manage');

  const [projectsData, engineers] = await Promise.all([
    listCommissioningProjects(principal),
    canManage ? listEligibleEngineers(principal) : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Site Commissioning"
        subtitle="Deploy and manage site engineers on completed projects, track daily site logs, and close commissioning."
      />

      <CommissioningClient
        pendingProjects={projectsData.pending}
        inCommissioningProjects={projectsData.inCommissioning}
        engineers={engineers}
        canManage={canManage}
      />
    </div>
  );
}
