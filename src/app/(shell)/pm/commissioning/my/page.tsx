import { redirect } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { hasPermissionAnywhere } from '@/core/rbac/engine';
import { PageHeader } from '@/components/ui';
import {
  getMyCommissioningProjects,
  getMyCommissioningLogs,
} from '@/modules/project-management/services/commissioning.service';
import { MyCommissioningClient } from './my-commissioning-client';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'My Commissioning',
};

export default async function MyCommissioningPage() {
  const principal = await requirePrincipal();

  if (!hasPermissionAnywhere(principal, 'pm.commissioning.log')) {
    redirect('/dashboard');
  }

  const [projects, recentLogs] = await Promise.all([
    getMyCommissioningProjects(principal),
    getMyCommissioningLogs(principal, 50),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Commissioning Daily Logs"
        subtitle="Record your daily site activities and progress for assigned commissioning projects."
      />

      <MyCommissioningClient projects={projects} recentLogs={recentLogs} />
    </div>
  );
}
