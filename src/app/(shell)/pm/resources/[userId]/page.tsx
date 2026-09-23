import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { hasPermissionAnywhere } from '@/core/rbac/engine';
import { getEngineerPortfolio } from '@/modules/project-management/services/dashboard.service';
import { PageHeader } from '@/components/ui';
import { EngineerPortfolio } from './engineer-portfolio';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ userId: string }> }) {
  return {
    title: 'Engineer workload',
  };
}

export default async function EngineerResourcePage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ windowDays?: string }>;
}) {
  const principal = await requirePrincipal();
  if (!hasPermissionAnywhere(principal, 'pm.resource.read')) {
    redirect('/dashboard');
  }

  const { userId } = await params;
  const { windowDays } = await searchParams;
  const days = windowDays ? parseInt(windowDays, 10) : 14;

  try {
    const data = await getEngineerPortfolio(principal, userId, days);
    return (
      <div className="space-y-6">
        <PageHeader
          title={data.engineer.fullName}
          subtitle={`Capacity, owned panels and active tasks over the next ${days} days.`}
          actions={
            <Link href="/pm/resources" className="btn btn-secondary btn-sm">
              ← Back to Team Load
            </Link>
          }
        />
        <EngineerPortfolio data={data} />
      </div>
    );
  } catch (err) {
    notFound();
  }
}
