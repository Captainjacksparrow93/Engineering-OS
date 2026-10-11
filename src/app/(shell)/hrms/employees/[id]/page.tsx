import { notFound, redirect } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { NotFoundError } from '@/core/rbac/errors';
import { getEmployee } from '@/modules/hrms/services/employee.service';
import { PageHeader } from '@/components/ui';
import { EmployeeRecord } from '../../_components/record';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Employee record' };

export default async function EmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const principal = await requirePrincipal();
  const { id } = await params;
  if (id === principal.userId) redirect('/hrms/me');
  const record = await getEmployee(principal, id).catch((error) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  return (
    <div>
      <PageHeader
        title={record.person.fullName}
        breadcrumb={[{ label: 'HR', href: '/hrms' }, { label: 'Employees', href: '/hrms/employees' }, { label: record.person.fullName }]}
      />
      <EmployeeRecord record={record} />
    </div>
  );
}
