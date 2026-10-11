import Link from 'next/link';
import { requirePrincipal } from '@/core/auth/session';
import { getEmployee } from '@/modules/hrms/services/employee.service';
import { PageHeader } from '@/components/ui';
import { EmployeeRecord } from '../_components/record';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'My profile' };

/** Self-service: every employee sees their own HR record and keeps personal details current. */
export default async function MyProfilePage() {
  const principal = await requirePrincipal();
  const record = await getEmployee(principal, principal.userId);
  return (
    <div>
      <PageHeader
        title="My profile"
        subtitle="Your HR record. Keep your personal details and emergency contact up to date; HR looks after the rest."
        actions={<Link href="/hrms/policies" className="btn btn-secondary">Company policies</Link>}
      />
      <EmployeeRecord record={record} />
    </div>
  );
}
