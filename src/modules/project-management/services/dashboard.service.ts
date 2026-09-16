import { prisma } from '@/core/db/prisma';
import { can, hasPermissionAnywhere } from '@/core/rbac/engine';
import type { Principal } from '@/core/rbac/types';
import { addDays, startOfDay } from '@/core/utils/dates';
import { projectVisibilityWhere } from './access';
import { getWorkloads } from './availability.service';
import { projectHealth, projectProgress, timeElapsedPercent, type HealthStatus } from '../domain/portfolio';
import { cleanTaskTitle, formatName } from '@/core/utils/strings';

export interface DirectorDashboardData {
  kind: 'director';
  period: 'week' | 'month';
  headline: {
    onTime: { current: number; total: number; lateCount: number };
    deliveriesNext30Days: { count: number; nextDate: Date | string | null };
    waitingDecisions: { count: number; oldestDays: number };
  };
  needsAttention: Array<{
    id: string;
    type: 'late_project' | 'stale_approval' | 'open_problem' | 'overloaded_engineer' | 'stale_handover';
    title: string;
    subtitle: string;
    severity: 'error' | 'warning';
    link: string;
    actionLabel: string;
  }>;
  teamCapacity: {
    departmentName: string;
    committedPercent: number;
    overloadedCount: number;
    freeNextWeekCount: number;
    onLeaveCount: number;
  };
  projects: Array<{
    id: string;
    code: string;
    name: string;
    clientName: string;
    manager: { id: string; fullName: string; avatarColor?: string | null };
    orderValueLakh: number | null;
    progressPercent: number;
    timeElapsedPercent: number;
    startDate: Date | string;
    targetEndDate: Date | string;
    forecastEndDate: Date | string;
    daysLate: number;
    health: HealthStatus;
    status: string;
  }>;
  projectManagers: Array<{
    manager: { id: string; fullName: string; avatarColor?: string | null };
    liveProjectsCount: number;
    onTimePercent: number;
    pendingApprovalsCount: number;
  }>;
  periodStats: {
    tasksApproved: number;
    tasksSentBack: number;
    problemsReported: number;
    problemsSolved: number;
    avgApprovalTimeHours: number;
  };
}

export interface PMDashboardData {
  kind: 'pm';
  headline: {
    overdueSteps: number;
    problemsReported: number;
    awaitingMyApproval: number;
    handoversWaiting: number;
  };
  needsAttention: Array<{
    id: string;
    type: 'problem' | 'approval' | 'overdue' | 'handover';
    title: string;
    subtitle: string;
    link: string;
    actionLabel: string;
  }>;
  projects: Array<{
    id: string;
    code: string;
    name: string;
    clientName: string;
    status: string;
    progressPercent: number;
    timeElapsedPercent: number;
    startDate: Date | string;
    targetEndDate: Date | string;
    forecastEndDate: Date | string;
    daysLate: number;
    health: HealthStatus;
    blockedCount: number;
    overdueCount: number;
  }>;
  teamLoadSummary: {
    overloaded: Array<{ id: string; fullName: string; loadPercent: number }>;
    free: Array<{ id: string; fullName: string; loadPercent: number }>;
  };
}

export type UnifiedDashboardResult = DirectorDashboardData | PMDashboardData | { kind: 'engineer' };

export async function getDashboard(
  principal: Principal,
  period: 'week' | 'month' = 'week'
): Promise<UnifiedDashboardResult> {
  const isDirectorOrAdmin =
    hasPermissionAnywhere(principal, 'pm.project.read.all') ||
    principal.roleKeys.includes('DIRECTOR') ||
    principal.roleKeys.includes('SUPER_ADMIN') ||
    principal.roleKeys.includes('DEPARTMENT_HEAD') ||
    principal.roleKeys.includes('TECHNICAL_HEAD');
  const hasOversight =
    isDirectorOrAdmin ||
    can(principal, 'pm.oversight') ||
    hasPermissionAnywhere(principal, 'pm.oversight');
  const hasReportRead =
    isDirectorOrAdmin ||
    can(principal, 'pm.report.read') ||
    hasPermissionAnywhere(principal, 'pm.report.read');

  if (!hasOversight && !hasReportRead) {
    return { kind: 'engineer' };
  }

  const today = startOfDay(new Date());
  const horizon30 = addDays(today, 30);
  const periodDays = period === 'week' ? 7 : 30;
  const periodStart = addDays(today, -periodDays);
  const visibility = projectVisibilityWhere(principal);

  // 1. Single efficient fetch of all relevant projects in scope
  const projects = await prisma.project.findMany({
    where: { ...visibility, status: { not: 'CANCELLED' } },
    select: {
      id: true,
      code: true,
      name: true,
      clientName: true,
      status: true,
      priority: true,
      startDate: true,
      targetEndDate: true,
      orderValue: true,
      manager: { select: { id: true, fullName: true, avatarColor: true } },
      tasks: {
        where: { status: { not: 'CANCELLED' } },
        select: {
          id: true,
          code: true,
          title: true,
          status: true,
          parentId: true,
          type: true,
          estimatedHours: true,
          percentComplete: true,
          plannedStart: true,
          plannedEnd: true,
          submittedAt: true,
          completedAt: true,
          assignments: {
            where: { status: 'ACTIVE' },
            select: { userId: true, user: { select: { fullName: true } } },
          },
        },
      },
    },
    orderBy: [{ targetEndDate: 'asc' }, { priority: 'desc' }],
  });

  // 2. Fetch pending approvals, handovers, roadblocks
  const [pendingApprovals, taskHandovers, projectHandovers, roadblocks, workloads] = await Promise.all([
    prisma.task.findMany({
      where: { project: visibility, status: 'IN_REVIEW' },
      select: {
        id: true,
        code: true,
        title: true,
        submittedAt: true,
        project: { select: { id: true, code: true, name: true, managerId: true } },
      },
      orderBy: { submittedAt: 'asc' },
    }),
    prisma.taskHandover.findMany({
      where: { status: 'PENDING', task: { project: visibility } },
      select: {
        id: true,
        createdAt: true,
        fromUser: { select: { fullName: true } },
        toUser: { select: { fullName: true } },
        task: { select: { id: true, title: true, projectId: true } },
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.projectHandover.findMany({
      where: { status: 'PENDING', project: visibility },
      select: {
        id: true,
        createdAt: true,
        fromUser: { select: { fullName: true } },
        toUser: { select: { fullName: true } },
        project: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.taskProgressLog.findMany({
      where: {
        blocker: { not: null },
        task: { project: visibility, status: 'BLOCKED' },
      },
      select: {
        id: true,
        createdAt: true,
        blocker: true,
        task: {
          select: {
            id: true,
            title: true,
            projectId: true,
            project: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
    getWorkloads(principal, { from: today, to: addDays(today, 7) }).catch(() => []),
  ]);

  // Compute stats per project
  const processedProjects = projects.map((p) => {
    const pProgress = projectProgress(p.tasks);
    const leafTasks = p.tasks.filter((t) => t.type !== 'PHASE' && !p.tasks.some((c) => c.parentId === t.id));

    const startDate = p.startDate ?? new Date();
    const targetEndDate = p.targetEndDate ?? new Date();

    let latestLeafEnd: Date = targetEndDate;
    for (const t of leafTasks) {
      if (t.plannedEnd && t.plannedEnd > latestLeafEnd) {
        latestLeafEnd = t.plannedEnd;
      }
    }

    const hasOpenRoadblock = p.tasks.some((t) => t.status === 'BLOCKED');
    const hasStaleApprovals = pendingApprovals.some(
      (a) => a.project.id === p.id && a.submittedAt && a.submittedAt.getTime() < today.getTime() - 2 * 86400000
    );

    const health = projectHealth({
      status: p.status,
      startDate,
      targetEndDate,
      forecastEndDate: latestLeafEnd,
      progressPercent: pProgress,
      hasOpenRoadblock,
      hasStaleApprovals,
      asOfDate: today,
    });

    const elapsed = timeElapsedPercent(startDate, targetEndDate, today);
    const targetEndMs = startOfDay(targetEndDate).getTime();
    const forecastEndMs = startOfDay(latestLeafEnd).getTime();
    const daysLate = Math.max(0, Math.round((forecastEndMs - targetEndMs) / 86400000));

    const blockedCount = p.tasks.filter((t) => t.status === 'BLOCKED').length;
    const overdueCount = p.tasks.filter(
      (t) => t.plannedEnd && startOfDay(t.plannedEnd).getTime() < today.getTime() && !['COMPLETED', 'CANCELLED'].includes(t.status)
    ).length;

    const orderValueLakh = p.orderValue ? Math.round((Number(p.orderValue) / 100000) * 10) / 10 : null;

    return {
      id: p.id,
      code: p.code,
      name: p.name,
      clientName: p.clientName,
      manager: p.manager,
      orderValueLakh,
      orderValueNum: p.orderValue ? Number(p.orderValue) : 0,
      progressPercent: pProgress,
      timeElapsedPercent: elapsed,
      startDate,
      targetEndDate,
      forecastEndDate: latestLeafEnd,
      daysLate,
      health,
      status: p.status,
      blockedCount,
      overdueCount,
    };
  });

  const liveProjects = processedProjects.filter((p) => p.status !== 'COMPLETED' && p.status !== 'ON_HOLD');

  if (hasOversight) {
    // -------------------------------------------------------------
    // DIRECTOR / TECHNICAL HEAD DASHBOARD (UX-3a)
    // -------------------------------------------------------------
    const onTimeProjects = liveProjects.filter((p) => p.daysLate === 0);
    const lateProjects = liveProjects.filter((p) => p.daysLate > 0);

    const deliveries30 = liveProjects.filter(
      (p) => startOfDay(p.targetEndDate).getTime() >= today.getTime() && startOfDay(p.targetEndDate).getTime() <= horizon30.getTime()
    );
    const nextDelivery = deliveries30[0]?.targetEndDate ?? null;

    const totalDecisions = pendingApprovals.length + taskHandovers.length + projectHandovers.length;
    let oldestDecisionDays = 0;
    for (const a of pendingApprovals) {
      if (a.submittedAt) {
        const days = Math.round((today.getTime() - startOfDay(a.submittedAt).getTime()) / 86400000);
        if (days > oldestDecisionDays) oldestDecisionDays = days;
      }
    }
    for (const h of taskHandovers) {
      const days = Math.round((today.getTime() - startOfDay(h.createdAt).getTime()) / 86400000);
      if (days > oldestDecisionDays) oldestDecisionDays = days;
    }

    // Build Needs Attention Queue (ranked)
    const needsAttention: DirectorDashboardData['needsAttention'] = [];

    // 1. Late projects
    for (const lp of lateProjects.sort((a, b) => b.daysLate * (b.orderValueNum || 1) - a.daysLate * (a.orderValueNum || 1))) {
      needsAttention.push({
        id: `late-${lp.id}`,
        type: 'late_project',
        title: `${lp.name} is ${lp.daysLate} days late`,
        subtitle: `PM: ${formatName(lp.manager.fullName)} · Target finish was ${pDate(lp.targetEndDate)}`,
        severity: 'error',
        link: `/pm/projects/${lp.id}`,
        actionLabel: 'View plan',
      });
    }

    // 2. Approvals waiting > 2 days
    for (const app of pendingApprovals) {
      if (app.submittedAt) {
        const age = Math.round((today.getTime() - startOfDay(app.submittedAt).getTime()) / 86400000);
        if (age >= 2) {
          needsAttention.push({
            id: `app-${app.id}`,
            type: 'stale_approval',
            title: `Review waiting: ${cleanTaskTitle(app.title)}`,
            subtitle: `${app.project.name} · Submitted ${age} days ago`,
            severity: 'warning',
            link: `/pm/approvals`,
            actionLabel: 'Review',
          });
        }
      }
    }

    // 3. Roadblocks open > 1 day
    for (const rb of roadblocks) {
      const age = Math.round((today.getTime() - startOfDay(rb.createdAt).getTime()) / 86400000);
      needsAttention.push({
        id: `rb-${rb.id}`,
        type: 'open_problem',
        title: `Problem on ${cleanTaskTitle(rb.task.title)}`,
        subtitle: `${rb.task.project.name} · ${age > 0 ? `${age}d old · ` : ''}"${rb.blocker}"`,
        severity: 'error',
        link: `/pm/tasks/${rb.task.id}`,
        actionLabel: 'Resolve',
      });
    }

    // 4. Overloaded engineers
    const overloadedEngineers = workloads.filter((w) => w.committedHours > w.capacityHours);
    for (const eng of overloadedEngineers) {
      const pct = Math.round((eng.committedHours / Math.max(eng.capacityHours, 1)) * 100);
      needsAttention.push({
        id: `eng-${eng.person.id}`,
        type: 'overloaded_engineer',
        title: `${formatName(eng.person.fullName)} is at ${pct}% load`,
        subtitle: `${eng.assignments.length} tasks scheduled in next 7 days`,
        severity: 'warning',
        link: `/pm/resources`,
        actionLabel: 'Rebalance',
      });
    }

    // Team Capacity Summary
    const totalCapacity = workloads.reduce((sum, w) => sum + w.capacityHours, 0) || 1;
    const totalCommitted = workloads.reduce((sum, w) => sum + w.committedHours, 0);
    const capacityPercent = Math.min(100, Math.round((totalCommitted / totalCapacity) * 100));

    const freeNextWeek = workloads.filter((w) => w.committedHours === 0).length;
    const onLeave = workloads.filter((w) => w.status === 'ON_LEAVE' || w.leaveDays > 0).length;

    // PM breakdown
    const pmMap = new Map<string, { manager: any; live: number; onTime: number; pendingApprovals: number }>();
    for (const p of liveProjects) {
      const pmId = p.manager.id;
      if (!pmMap.has(pmId)) {
        pmMap.set(pmId, {
          manager: p.manager,
          live: 0,
          onTime: 0,
          pendingApprovals: pendingApprovals.filter((a) => a.project.managerId === pmId).length,
        });
      }
      const entry = pmMap.get(pmId)!;
      entry.live += 1;
      if (p.daysLate === 0) entry.onTime += 1;
    }

    const projectManagers = Array.from(pmMap.values()).map((e) => ({
      manager: e.manager,
      liveProjectsCount: e.live,
      onTimePercent: e.live > 0 ? Math.round((e.onTime / e.live) * 100) : 100,
      pendingApprovalsCount: e.pendingApprovals,
    }));

    // Period completed tasks and average approval time
    const completedInPeriod = projects.flatMap((p) =>
      p.tasks.filter((t) => t.completedAt && t.completedAt >= periodStart && t.status === 'COMPLETED')
    );

    let approvalDurationSumHours = 0;
    let approvalCount = 0;
    for (const t of completedInPeriod) {
      if (t.completedAt && t.submittedAt) {
        const diffHours = (t.completedAt.getTime() - t.submittedAt.getTime()) / 3600000;
        if (diffHours > 0) {
          approvalDurationSumHours += diffHours;
          approvalCount += 1;
        }
      }
    }
    const avgApprovalTimeHours = approvalCount > 0 ? Math.round((approvalDurationSumHours / approvalCount) * 10) / 10 : 0;

    return {
      kind: 'director',
      period,
      headline: {
        onTime: {
          current: onTimeProjects.length,
          total: liveProjects.length,
          lateCount: lateProjects.length,
        },
        deliveriesNext30Days: {
          count: deliveries30.length,
          nextDate: nextDelivery,
        },
        waitingDecisions: {
          count: totalDecisions,
          oldestDays: oldestDecisionDays,
        },
      },
      needsAttention: needsAttention.slice(0, 6),
      teamCapacity: {
        departmentName: 'TECH',
        committedPercent: capacityPercent,
        overloadedCount: overloadedEngineers.length,
        freeNextWeekCount: freeNextWeek,
        onLeaveCount: onLeave,
      },
      projects: processedProjects,
      projectManagers,
      periodStats: {
        tasksApproved: completedInPeriod.length,
        tasksSentBack: 0,
        problemsReported: roadblocks.length,
        problemsSolved: 0,
        avgApprovalTimeHours,
      },
    };
  }

  // ---------------------------------------------------------------
  // PM DASHBOARD (UX-3)
  // ---------------------------------------------------------------
  const myProjects = processedProjects.filter((p) => p.manager.id === principal.userId);
  const myApprovals = pendingApprovals.filter((a) => a.project.managerId === principal.userId);
  const myHandovers = taskHandovers.length + projectHandovers.length;

  const overdueSteps = myProjects.reduce((sum, p) => sum + p.overdueCount, 0);
  const problemsReported = myProjects.reduce((sum, p) => sum + p.blockedCount, 0);

  const needsAttention: PMDashboardData['needsAttention'] = [];

  for (const a of myApprovals) {
    needsAttention.push({
      id: `app-${a.id}`,
      type: 'approval',
      title: `Awaiting your approval: ${cleanTaskTitle(a.title)}`,
      subtitle: `${a.project.name}`,
      link: `/pm/approvals`,
      actionLabel: 'Review',
    });
  }

  for (const rb of roadblocks.filter((r) => myProjects.some((p) => p.id === r.task.projectId))) {
    needsAttention.push({
      id: `rb-${rb.id}`,
      type: 'problem',
      title: `Problem reported: ${cleanTaskTitle(rb.task.title)}`,
      subtitle: `${rb.task.project.name} · "${rb.blocker}"`,
      link: `/pm/tasks/${rb.task.id}`,
      actionLabel: 'Resolve',
    });
  }

  const overloaded = workloads
    .filter((w) => w.committedHours > w.capacityHours)
    .map((w) => ({
      id: w.person.id,
      fullName: formatName(w.person.fullName),
      loadPercent: Math.round((w.committedHours / Math.max(w.capacityHours, 1)) * 100),
    }));

  const free = workloads
    .filter((w) => w.committedHours === 0)
    .map((w) => ({
      id: w.person.id,
      fullName: formatName(w.person.fullName),
      loadPercent: 0,
    }));

  return {
    kind: 'pm',
    headline: {
      overdueSteps,
      problemsReported,
      awaitingMyApproval: myApprovals.length,
      handoversWaiting: myHandovers,
    },
    needsAttention: needsAttention.slice(0, 6),
    projects: myProjects,
    teamLoadSummary: {
      overloaded,
      free,
    },
  };
}

function pDate(d: Date | string | null | undefined): string {
  if (!d) return '-';
  const dt = typeof d === 'string' ? new Date(d) : d;
  return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
