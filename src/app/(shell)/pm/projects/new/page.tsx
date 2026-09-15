import { redirect } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { hasPermissionAnywhere } from '@/core/rbac/engine';
import { PageHeader } from '@/components/ui';
import { getPMTeamData } from '@/modules/project-management/services/automation-project.service';
import { listChecklistTemplates } from '@/modules/project-management/services/template.service';
import { AutomationProjectWizard } from './automation-project-wizard';

export const dynamic = 'force-dynamic';

export default async function NewProjectPage() {
  const principal = await requirePrincipal();
  if (!hasPermissionAnywhere(principal, 'pm.project.create')) redirect('/pm/projects');

  const [{ managers, teamsByPM, allEngineers }, templates] = await Promise.all([
    getPMTeamData(principal.companyId),
    listChecklistTemplates(),
  ]);

  return (
    <>
      <PageHeader
        title="Create Automation Project"
        subtitle="Configure order details, select automation scope (PLC/SCADA/HMI), assign the Project Manager, and schedule the 13 sequential checklist tasks."
        breadcrumb={[{ label: 'Projects', href: '/pm/projects' }, { label: 'New Automation Project' }]}
      />
      <AutomationProjectWizard
        managers={managers}
        teamsByPM={teamsByPM}
        allEngineers={allEngineers}
        templates={templates}
      />
    </>
  );
}
