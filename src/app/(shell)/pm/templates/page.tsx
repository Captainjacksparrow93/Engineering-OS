import { redirect } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { hasPermissionAnywhere } from '@/core/rbac/engine';
import { PageHeader } from '@/components/ui';
import { listChecklistTemplates } from '@/modules/project-management/services/template.service';
import { TemplateManagerClient } from './template-manager';

export const dynamic = 'force-dynamic';

export default async function ChecklistTemplatesPage() {
  const principal = await requirePrincipal();

  if (!hasPermissionAnywhere(principal, 'pm.template.manage')) {
    redirect('/pm/projects');
  }

  const templates = await listChecklistTemplates();

  return (
    <>
      <PageHeader
        title="Checklist Templates Management"
        subtitle="Manage the standard 13-task pipeline and default blocker rules for PLC, SCADA, and HMI. Accessible only to Directors and Department Heads."
        breadcrumb={[
          { label: 'Project Management', href: '/pm/projects' },
          { label: 'Checklist Templates' },
        ]}
      />
      <TemplateManagerClient templates={templates} />
    </>
  );
}
