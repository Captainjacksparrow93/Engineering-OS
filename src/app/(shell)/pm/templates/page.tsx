import { redirect } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { hasPermissionAnywhere } from '@/core/rbac/engine';
import { PageHeader } from '@/components/ui';
import { listChecklistTemplates } from '@/modules/project-management/services/template.service';
import { TemplateManagerClient } from './template-manager';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Checklists',
};

export default async function ChecklistTemplatesPage() {
  const principal = await requirePrincipal();

  if (!hasPermissionAnywhere(principal, 'pm.template.read')) {
    redirect('/pm/projects');
  }
  const canManage = hasPermissionAnywhere(principal, 'pm.template.manage');

  const templates = await listChecklistTemplates();

  return (
    <>
      <PageHeader
        title="Checklists"
        subtitle="Standard task pipelines and step sequences for PLC, SCADA, and HMI templates."
        breadcrumb={[
          { label: 'Projects', href: '/pm/projects' },
          { label: 'Checklists' },
        ]}
      />

      <TemplateManagerClient templates={templates} canManage={canManage} />
    </>
  );
}
