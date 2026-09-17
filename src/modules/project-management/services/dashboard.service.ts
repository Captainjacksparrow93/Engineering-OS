import { prisma } from '@/core/db/prisma';
import { hasPermissionAnywhere } from '@/core/rbac/engine';
import type { Principal } from '@/core/rbac/types';
import { addDays, startOfDay, todayInIndia } from '@/core/utils/dates';
import { projectVisibilityWhere } from './access';
import { getWorkloads } from './availability.service';
import { isExecutionStaff, type Workload } from '../domain/availability';
import {
  daysLate as computeDaysLate,
  forecastFinish,
  projectHealth,
  projectProgress,
  timeElapsedPercent,
  type HealthStatus,
} from '../domain/portfolio';
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
    openProblems: number;
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

const DAY_MS = 86400000;
const STALE_DAYS = 2;

export async function getDashboard(
  principal: Principal,
  period: 'week' | 'month' = 'week'
): Promise<UnifiedDashboardResult> {
  const hasOversight = hasPermissionAnywhere(principal, 'pm.oversight');
  const hasReportRead = hasPermissionAnywhere(principal, 'pm.report.read');

  if (!hasOversight && !hasReportRead) {
    return { kind: 'engineer' };
  }

  const today = todayInIndia();
  const horizon30 = addDays(today, 30);
  const periodStart = addDays(today, period === 'week' ? -7 : -30);
  const visibility = projectVisibilityWhere(principal);
  const ageInDays = (d: Date) => Math.max(0, Math.round((today.getTime() - startOfDay(d).getTime()) / DAY_MS));

  // 1. All projects in scope, with their steps
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
        },
      },
    },
    orderBy: [{ targetEndDate: 'asc' }, { priority: 'desc' }],
  });
  const taskIds = projects.flatMap((p) => p.tasks.map((t) => t.id));

  // 2. Approvals, handovers, problem history, send-backs, workloads
  const [pendingApprovals, taskHandovers, projectHandovers, problemLogs, sentBackCount, workloads] = await Promise.all([
    prisma.task.findMany({
      where: { project: visibility, status: 'IN_REVIEW' },
      select: {
        id: true,
        title: true,
        submittedAt: true,
        project: { select: { id: true, name: true, managerId: true } },
      },
      orderBy: { submittedAt: 'asc' },
    }),
    prisma.taskHandover.findMany({
      where: { status: 'PENDING', OR: [{ task: { project: visibility } }, { toUserId: principal.userId }] },
      select: {
        id: true,
        createdAt: true,
        toUserId: true,
        fromUser: { select: { fullName: true } },
        toUser: { select: { fullName: true } },
        task: { select: { id: true, title: true, project: { select: { name: true } } } },
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.projectHandover.findMany({
      where: { status: 'PENDING', OR: [{ project: visibility }, { toUserId: principal.userId }] },
      select: {
        id: true,
        createdAt: true,
        toUserId: true,
        fromUser: { select: { fullName: true } },
        toUser: { select: { fullName: true } },
        project: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
    }),
    // ponytail: full progress-log history in scope (small today); bound by date if it grows.
    prisma.taskProgressLog.findMany({
      where: { taskId: { in: taskIds } },
      select: {
        id: true,
        taskId: true,
        blocker: true,
        createdAt: true,
        task: { select: { id: true, title: true, status: true, projectId: true, project: { select: { name: true } } } },
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.auditLog.count({
      where: {
        action: 'task.status_changed',
        entityId: { in: taskIds },
        createdAt: { gte: periodStart },
        AND: [
          { diff: { path: ['status', 'from'], equals: 'IN_REVIEW' } },
          { diff: { path: ['status', 'to'], equals: 'IN_PROGRESS' } },
        ],
      },
    }),
    getWorkloads(principal, { from: today, to: addDays(today, 7) }).catch(() => [] as Workload[]),
  ]);

  const problems = summariseProblems(problemLogs, periodStart);

  // 3. Per-project progress, forecast and health (one rule for tiles, table and attention list)
  const processedProjects = projects.map((p) => {
    const parentIds = new Set(p.tasks.map((t) => t.parentId).filter(Boolean));
    const leafTasks = p.tasks.filter((t) => t.type !== 'PHASE' && !parentIds.has(t.id));
    const startDate = p.startDate ?? today;
    const targetEndDate = p.targetEndDate ?? today;

    const progressPercent = projectProgress(p.tasks);
    const forecastEndDate = forecastFinish(leafTasks, targetEndDate, today);
    const health = projectHealth({
      status: p.status,
      startDate,
      targetEndDate,
      forecastEndDate,
      progressPercent,
      hasOpenRoadblock: problems.open.some((log) => log.task.projectId === p.id),
      hasStaleApprovals: pendingApprovals.some(
        (a) => a.project.id === p.id && a.submittedAt && ageInDays(a.submittedAt) >= STALE_DAYS,
      ),
      asOfDate: today,
    });

    // Overdue = the engineer's work is late. Steps waiting for approval are listed under
    // approvals instead, and paused / finished projects raise no overdue alarms.
    const projectActive = p.status !== 'ON_HOLD' && p.status !== 'COMPLETED';
    const overdueTasks = leafTasks
      .filter((t) => projectActive && t.plannedEnd && startOfDay(t.plannedEnd) < today && t.status !== 'COMPLETED' && t.status !== 'IN_REVIEW')
      .map((t) => ({ id: t.id, title: t.title, plannedEnd: t.plannedEnd! }));

    return {
      id: p.id,
      code: p.code,
      name: p.name,
      clientName: p.clientName,
      manager: p.manager,
      orderValueLakh: p.orderValue ? Math.round((Number(p.orderValue) / 100000) * 10) / 10 : null,
      orderValueNum: p.orderValue ? Number(p.orderValue) : 0,
      progressPercent,
      timeElapsedPercent: timeElapsedPercent(startDate, targetEndDate, today),
      startDate,
      targetEndDate,
      forecastEndDate,
      daysLate: computeDaysLate(forecastEndDate, targetEndDate, today, health),
      health,
      status: p.status,
      blockedCount: leafTasks.filter((t) => t.status === 'BLOCKED').length,
      overdueCount: overdueTasks.length,
      overdueTasks,
    };
  });

  // Live = not finished. On-hold projects stay listed but out of on-time counts.
  const listedProjects = processedProjects.filter((p) => p.status !== 'COMPLETED');
  const liveProjects = listedProjects.filter((p) => p.status !== 'ON_HOLD');

  // Engineers only (no PMs / heads) so "free" and "overloaded" mean the same as in auto-assign.
  const engineers = workloads.filter((w) => isExecutionStaff(w.person));
  const overloadedEngineers = engineers.filter((w) => w.status === 'OVERLOADED');
  const freeEngineers = engineers.filter((w) => w.status === 'FREE');
  const loadPercent = (w: Workload) => Math.round((w.committedHours / Math.max(w.capacityHours, 1)) * 100);

  if (hasOversight) {
    const lateProjects = liveProjects.filter((p) => p.health === 'LATE');
    const onTimeProjects = liveProjects.filter((p) => p.health !== 'LATE');

    const deliveries30 = liveProjects.filter((p) => {
      const t = startOfDay(p.targetEndDate).getTime();
      return t >= today.getTime() && t <= horizon30.getTime();
    });

    const decisionDates = [
      ...pendingApprovals.map((a) => a.submittedAt).filter((d): d is Date => Boolean(d)),
      ...taskHandovers.map((h) => h.createdAt),
      ...projectHandovers.map((h) => h.createdAt),
    ];
    const oldestDecisionDays = decisionDates.reduce((max, d) => Math.max(max, ageInDays(d)), 0);

    const attention = {
      late_project: [...lateProjects]
        .sort((a, b) => b.daysLate * (b.orderValueNum || 1) - a.daysLate * (a.orderValueNum || 1))
        .map((lp) => ({
          id: `late-${lp.id}`,
          type: 'late_project' as const,
          title: `${lp.name} is ${lp.daysLate} ${lp.daysLate === 1 ? 'day' : 'days'} late`,
          subtitle: `PM: ${lp.manager ? formatName(lp.manager.fullName) : 'Unassigned'} · Target ${pDate(lp.targetEndDate)} · Forecast ${pDate(lp.forecastEndDate)}`,
          severity: 'error' as const,
          link: `/pm/projects/${lp.id}`,
          actionLabel: 'View plan',
        })),
      open_problem: problems.open.map((log) => ({
        id: `rb-${log.taskId}`,
        type: 'open_problem' as const,
        title: `Problem on ${cleanTaskTitle(log.task.title)}`,
        subtitle: `${log.task.project.name} · ${ageInDays(log.createdAt) > 0 ? `${ageInDays(log.createdAt)}d old · ` : ''}"${log.blocker}"`,
        severity: 'error' as const,
        link: `/pm/tasks/${log.taskId}`,
        actionLabel: 'Resolve',
      })),
      stale_approval: pendingApprovals
        .filter((a) => a.submittedAt && ageInDays(a.submittedAt) >= STALE_DAYS)
        .map((a) => ({
          id: `app-${a.id}`,
          type: 'stale_approval' as const,
          title: `Review waiting: ${cleanTaskTitle(a.title)}`,
          subtitle: `${a.project.name} · Submitted ${ageInDays(a.submittedAt!)} days ago`,
          severity: 'warning' as const,
          link: `/pm/approvals`,
          actionLabel: 'Review',
        })),
      overloaded_engineer: overloadedEngineers.map((eng) => ({
        id: `eng-${eng.person.id}`,
        type: 'overloaded_engineer' as const,
        title: `${formatName(eng.person.fullName)} is at ${loadPercent(eng)}% load`,
        subtitle: `${eng.committedHours}h booked of ${eng.capacityHours}h available in the next 7 days · ${eng.assignments.length} open steps overall`,
        severity: 'warning' as const,
        link: `/pm/resources`,
        actionLabel: 'Rebalance',
      })),
      stale_handover: [
        ...taskHandovers
          .filter((h) => ageInDays(h.createdAt) >= STALE_DAYS)
          .map((h) => ({
            id: `ho-${h.id}`,
            title: `No reply for ${ageInDays(h.createdAt)} days: ${cleanTaskTitle(h.task.title)}`,
            subtitle: `${h.task.project.name} · ${formatName(h.fromUser.fullName)} → ${formatName(h.toUser.fullName)}`,
          })),
        ...projectHandovers
          .filter((h) => ageInDays(h.createdAt) >= STALE_DAYS)
          .map((h) => ({
            id: `pho-${h.id}`,
            title: `No reply for ${ageInDays(h.createdAt)} days: ${h.project.name}`,
            subtitle: `Project handover · ${formatName(h.fromUser.fullName)} → ${formatName(h.toUser.fullName)}`,
          })),
      ].map((h) => ({ ...h, type: 'stale_handover' as const, severity: 'warning' as const, link: '/pm/handovers', actionLabel: 'View' })),
    };

    // Round-robin across types so one busy category can't hide the others in the first rows.
    const needsAttention = interleave<DirectorDashboardData['needsAttention'][number]>([
      attention.late_project,
      attention.open_problem,
      attention.stale_approval,
      attention.overloaded_engineer,
      attention.stale_handover,
    ]);

    const totalCapacity = engineers.reduce((sum, w) => sum + w.capacityHours, 0);
    const totalCommitted = engineers.reduce((sum, w) => sum + w.committedHours, 0);

    const pmMap = new Map<string, { manager: DirectorDashboardData['projectManagers'][number]['manager']; live: number; onTime: number; pendingApprovals: number }>();
    for (const p of liveProjects) {
      if (!p.manager) continue;
      const entry = pmMap.get(p.manager.id) ?? {
        manager: p.manager,
        live: 0,
        onTime: 0,
        pendingApprovals: pendingApprovals.filter((a) => a.project.managerId === p.manager.id).length,
      };
      entry.live += 1;
      if (p.health !== 'LATE') entry.onTime += 1;
      pmMap.set(p.manager.id, entry);
    }

    const completedInPeriod = projects.flatMap((p) =>
      p.tasks.filter((t) => t.status === 'COMPLETED' && t.completedAt && t.completedAt >= periodStart),
    );
    const approvalHours = completedInPeriod
      .filter((t) => t.submittedAt && t.completedAt! > t.submittedAt)
      .map((t) => (t.completedAt!.getTime() - t.submittedAt!.getTime()) / 3600000);
    const avgApprovalTimeHours = approvalHours.length
      ? Math.round((approvalHours.reduce((a, b) => a + b, 0) / approvalHours.length) * 10) / 10
      : 0;

    return {
      kind: 'director',
      period,
      headline: {
        onTime: { current: onTimeProjects.length, total: liveProjects.length, lateCount: lateProjects.length },
        deliveriesNext30Days: { count: deliveries30.length, nextDate: deliveries30[0]?.targetEndDate ?? null },
        waitingDecisions: {
          count: pendingApprovals.length + taskHandovers.length + projectHandovers.length,
          oldestDays: oldestDecisionDays,
        },
      },
      needsAttention,
      teamCapacity: {
        departmentName: 'TECH',
        // Not capped at 100: an overcommitted team must be visible as such.
        committedPercent: totalCapacity > 0 ? Math.round((totalCommitted / totalCapacity) * 100) : 0,
        overloadedCount: overloadedEngineers.length,
        freeNextWeekCount: freeEngineers.length,
        onLeaveCount: engineers.filter((w) => w.status === 'ON_LEAVE' || (w.workingDays > 0 && w.leaveDays * 2 >= w.workingDays)).length,
      },
      projects: listedProjects,
      projectManagers: Array.from(pmMap.values()).map((e) => ({
        manager: e.manager,
        liveProjectsCount: e.live,
        onTimePercent: e.live > 0 ? Math.round((e.onTime / e.live) * 100) : 100,
        pendingApprovalsCount: e.pendingApprovals,
      })),
      periodStats: {
        tasksApproved: completedInPeriod.length,
        tasksSentBack: sentBackCount,
        problemsReported: problems.reported,
        problemsSolved: problems.solved,
        openProblems: problems.open.length,
        avgApprovalTimeHours,
      },
    };
  }

  // ---------------------------------------------------------------
  // PM DASHBOARD
  // ---------------------------------------------------------------
  const myProjects = listedProjects.filter((p) => p.manager?.id === principal.userId);
  const myProjectIds = new Set(myProjects.map((p) => p.id));
  const myApprovals = pendingApprovals.filter((a) => a.project.managerId === principal.userId);
  const myOpenProblems = problems.open.filter((log) => myProjectIds.has(log.task.projectId));
  const handoversToMe = [
    ...taskHandovers
      .filter((h) => h.toUserId === principal.userId)
      .map((h) => ({ id: `ho-${h.id}`, title: `Handover for you: ${cleanTaskTitle(h.task.title)}`, subtitle: `${h.task.project.name} · from ${formatName(h.fromUser.fullName)}` })),
    ...projectHandovers
      .filter((h) => h.toUserId === principal.userId)
      .map((h) => ({ id: `pho-${h.id}`, title: `Project handover for you: ${h.project.name}`, subtitle: `from ${formatName(h.fromUser.fullName)}` })),
  ];
  const myOverdue = myProjects
    .flatMap((p) => p.overdueTasks.map((t) => ({ ...t, projectName: p.name })))
    .sort((a, b) => a.plannedEnd.getTime() - b.plannedEnd.getTime());

  const needsAttention = interleave<PMDashboardData['needsAttention'][number]>([
    myApprovals.map((a) => ({
      id: `app-${a.id}`,
      type: 'approval',
      title: `Awaiting your approval: ${cleanTaskTitle(a.title)}`,
      subtitle: a.project.name,
      link: `/pm/approvals`,
      actionLabel: 'Review',
    })),
    myOpenProblems.map((log) => ({
      id: `rb-${log.taskId}`,
      type: 'problem',
      title: `Problem reported: ${cleanTaskTitle(log.task.title)}`,
      subtitle: `${log.task.project.name} · "${log.blocker}"`,
      link: `/pm/tasks/${log.taskId}`,
      actionLabel: 'Resolve',
    })),
    myOverdue.map((t) => ({
      id: `od-${t.id}`,
      type: 'overdue',
      title: `Overdue: ${cleanTaskTitle(t.title)}`,
      subtitle: `${t.projectName} · was due ${pDate(t.plannedEnd)}`,
      link: `/pm/tasks/${t.id}`,
      actionLabel: 'Open',
    })),
    handoversToMe.map((h) => ({ ...h, type: 'handover', link: '/pm/handovers', actionLabel: 'Decide' })),
  ]);

  return {
    kind: 'pm',
    headline: {
      overdueSteps: myOverdue.length,
      problemsReported: myOpenProblems.length,
      awaitingMyApproval: myApprovals.length,
      handoversWaiting: handoversToMe.length,
    },
    needsAttention,
    projects: myProjects,
    teamLoadSummary: {
      overloaded: overloadedEngineers.map((w) => ({ id: w.person.id, fullName: formatName(w.person.fullName), loadPercent: loadPercent(w) })),
      free: freeEngineers.map((w) => ({ id: w.person.id, fullName: formatName(w.person.fullName), loadPercent: loadPercent(w) })),
    },
  };
}

interface ProblemLog {
  taskId: string;
  blocker: string | null;
  createdAt: Date;
  task: { id: string; title: string; status: string; projectId: string; project: { name: string } };
}

/**
 * Same rule the task engine uses to keep a step BLOCKED: a problem is open while the step's
 * latest progress log carries a blocker. A log without a blocker after one with a blocker
 * solves it. Logs must be in ascending time order.
 */
export function summariseProblems<T extends ProblemLog>(logs: T[], periodStart: Date) {
  const latest = new Map<string, T>();
  let reported = 0;
  let solved = 0;
  for (const log of logs) {
    const isProblem = Boolean(log.blocker?.trim());
    const wasProblem = Boolean(latest.get(log.taskId)?.blocker?.trim());
    if (log.createdAt >= periodStart) {
      if (isProblem && !wasProblem) reported += 1;
      if (!isProblem && wasProblem) solved += 1;
    }
    latest.set(log.taskId, log);
  }
  const open = [...latest.values()]
    .filter((log) => log.blocker?.trim() && log.task.status !== 'COMPLETED' && log.task.status !== 'CANCELLED')
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return { open, reported, solved };
}

function interleave<T>(groups: T[][]): T[] {
  const out: T[] = [];
  const longest = Math.max(0, ...groups.map((g) => g.length));
  for (let i = 0; i < longest; i += 1) {
    for (const group of groups) if (i < group.length) out.push(group[i]!);
  }
  return out;
}

function pDate(d: Date | string | null | undefined): string {
  if (!d) return '-';
  const dt = typeof d === 'string' ? new Date(d) : d;
  return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}
