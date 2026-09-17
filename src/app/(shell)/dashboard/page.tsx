import { redirect } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { hasPermissionAnywhere } from '@/core/rbac/engine';
import { getDashboard } from '@/modules/project-management/services/dashboard.service';
import { getProjectTimeline } from '@/modules/project-management/services/project.service';
import { DirectorDashboard } from './director-dashboard';
import { PMDashboard } from './pm-dashboard';

export const dynamic = 'force-dynamic';

// The root layout's title template appends " · Engineering OS".
export const metadata = {
  title: 'Dashboard',
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const principal = await requirePrincipal();

  // Redirect users without report or oversight access directly to My work
  if (!hasPermissionAnywhere(principal, 'pm.oversight') && !hasPermissionAnywhere(principal, 'pm.report.read')) {
    redirect('/pm/my-work');
  }

  const { period } = await searchParams;
  const data = await getDashboard(principal, period === 'month' ? 'month' : 'week');

  if (data.kind === 'director') {
    // Pick the most at-risk or first live project for the timeline
    const topProject =
      data.projects.find((p) => p.health === 'LATE' || p.health === 'AT_RISK') ||
      data.projects[0];

    let initialTimeline;
    if (topProject) {
      try {
        initialTimeline = await getProjectTimeline(principal, topProject.id);
      } catch {
        // Fallback default
        initialTimeline = {
          projectId: topProject.id,
          projectName: topProject.name,
          projectCode: topProject.code,
          clientName: topProject.clientName,
          status: topProject.status,
          manager: topProject.manager,
          startDate: topProject.startDate,
          targetEndDate: topProject.targetEndDate,
          forecastEndDate: topProject.forecastEndDate,
          totalSteps: 0,
          completedSteps: 0,
          lanes: [],
        };
      }
    } else {
      initialTimeline = {
        projectId: 'none',
        projectName: 'No projects',
        projectCode: 'NONE',
        status: 'PLANNING',
        startDate: new Date(),
        targetEndDate: new Date(),
        totalSteps: 0,
        completedSteps: 0,
        lanes: [],
      };
    }

    return <DirectorDashboard data={data} initialTimeline={initialTimeline} />;
  }

  if (data.kind === 'pm') {
    return <PMDashboard data={data} />;
  }

  redirect('/pm/my-work');
}
