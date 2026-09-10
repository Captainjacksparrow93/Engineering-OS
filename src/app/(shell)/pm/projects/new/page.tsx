import { redirect } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { hasPermissionAnywhere } from '@/core/rbac/engine';
import { prisma } from '@/core/db/prisma';
import { PageHeader } from '@/components/ui';
import { NewProjectForm } from './new-project-form';

export const dynamic = 'force-dynamic';

/** Higher management defines the project here; the WBS is built afterwards. */
export default async function NewProjectPage() {
  const principal = await requirePrincipal();
  if (!hasPermissionAnywhere(principal, 'pm.project.create')) redirect('/pm/projects');

  const [candidates, departments] = await Promise.all([
    prisma.user.findMany({
      where: {
        companyId: principal.companyId,
        status: 'ACTIVE',
        grade: { in: ['SENIOR_ENGINEER', 'LEAD_ENGINEER', 'MANAGER', 'HEAD', 'DIRECTOR'] },
      },
      select: { id: true, fullName: true, designation: true },
      orderBy: { fullName: 'asc' },
    }),
    prisma.department.findMany({
      where: { companyId: principal.companyId },
      select: { id: true, name: true, code: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  return (
    <>
      <PageHeader
        title="Define a new project"
        subtitle="Creating a project also makes the chosen manager its owner, with rights scoped to this project alone."
        breadcrumb={[{ label: 'Projects', href: '/pm/projects' }, { label: 'New' }]}
      />
      <NewProjectForm managers={candidates} departments={departments} />
    </>
  );
}
