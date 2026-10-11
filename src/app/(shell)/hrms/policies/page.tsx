import { requirePrincipal } from '@/core/auth/session';
import { listPolicies } from '@/modules/hrms/services/document.service';
import { managesHr } from '@/modules/hrms/services/employee.service';
import { Card, PageHeader } from '@/components/ui';
import { DocumentTable, UploadForm } from '../_components/documents';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Company policies' };

/** Company policies and handbooks: HR publishes, everyone reads. */
export default async function PoliciesPage() {
  const principal = await requirePrincipal();
  const [policies, manage] = [await listPolicies(principal), managesHr(principal)];
  return (
    <div className="space-y-lg">
      <PageHeader title="Company policies" subtitle="Leave, attendance, conduct and other policies everyone at ACS Engitech follows." />
      <Card title="Policies">
        <DocumentTable documents={policies} manage={manage} showCategory={false} emptyHint={manage ? 'Publish the first policy below.' : 'HR has not published any policies yet.'} />
      </Card>
      {manage ? (
        <Card title="Publish a policy">
          <UploadForm />
        </Card>
      ) : null}
    </div>
  );
}
