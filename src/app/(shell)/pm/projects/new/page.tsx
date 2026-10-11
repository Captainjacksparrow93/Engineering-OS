import { redirect } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { hasPermissionAnywhere } from '@/core/rbac/engine';
import { PageHeader } from '@/components/ui';
import { getPMTeamData } from '@/modules/project-management/services/automation-project.service';
import { listChecklistTemplates } from '@/modules/project-management/services/template.service';
import { listClients, nextClientRef } from '@/modules/project-management/services/client.service';
import { listExistingProjectCodes } from '@/modules/project-management/services/project.service';
import { config } from '@/core/config';
import { isErpEnabled } from '@/modules/erp/client';
import { AutomationProjectWizard } from './automation-project-wizard';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'New project',
};

export default async function NewProjectPage() {
  const principal = await requirePrincipal();
  if (!hasPermissionAnywhere(principal, 'pm.project.create')) redirect('/pm/projects');

  const [{ managers, teamsByPM, allEngineers }, templates, clients, defaultClientRef, existingCodes] = await Promise.all([
    getPMTeamData(principal.companyId),
    listChecklistTemplates(),
    listClients(principal.companyId),
    nextClientRef(principal.companyId),
    listExistingProjectCodes(principal.companyId),
  ]);

  const erpPublicUrl = config().ERPNEXT_PUBLIC_URL?.replace(/\/+$/, '');

  return (
    <>
      <PageHeader
        title="New project"
        breadcrumb={[{ label: 'Projects', href: '/pm/projects' }, { label: 'New project' }]}
      />

      <AutomationProjectWizard
        managers={managers}
        teamsByPM={teamsByPM}
        allEngineers={allEngineers}
        templates={templates}
        initialClients={clients}
        defaultClientRef={defaultClientRef}
        existingProjectCodes={existingCodes}
        erpEnabled={isErpEnabled()}
        erpOrderUrlBase={erpPublicUrl ? `${erpPublicUrl}/app/sales-order/` : null}
      />
    </>
  );
}
