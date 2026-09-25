import { requirePrincipal } from '@/core/auth/session';
import { hasPermissionAnywhere } from '@/core/rbac/engine';
import { listClientsWithStats, nextClientRef } from '@/modules/project-management/services/client.service';
import { PageHeader } from '@/components/ui';
import { ClientsClient } from './clients-client';
import { AddClientDialog } from './add-client-dialog';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Clients',
};

export default async function ClientsPage() {
  const principal = await requirePrincipal();
  const clients = await listClientsWithStats(principal);
  const canCreate = hasPermissionAnywhere(principal, 'pm.project.create');
  const defaultRef = canCreate ? await nextClientRef(principal.companyId) : 'ACS-0001';

  return (
    <div className="space-y-4">
      <PageHeader
        title="Clients"
        subtitle={`${clients.length} client${clients.length === 1 ? '' : 's'}`}
        actions={canCreate ? <AddClientDialog initialDefaultRef={defaultRef} /> : null}
      />

      <ClientsClient clients={clients} canCreate={canCreate} />
    </div>
  );
}
