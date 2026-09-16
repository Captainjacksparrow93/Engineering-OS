import { prisma } from '@/core/db/prisma';
import { can } from '@/core/rbac/engine';
import type { Principal } from '@/core/rbac/types';
import { addDays, startOfDay } from '@/core/utils/dates';
import { projectVisibilityWhere } from './access';
import { getWorkloads } from './availability.service';

export async function getDashboard(principal: Principal) {
  const today = startOfDay(new Date());
  const horizon = addDays(today, 14);
  const visibility = projectVisibilityWhere(principal);
  const isManagement =
    can(principal, 'pm.report.read') ||
    can(principal, 'pm.project.read.all') ||
    principal.grade === 'DIRECTOR' ||
    principal.grade === 'HEAD' ||
    principal.roleKeys.includes('DIRECTOR') ||
    principal.roleKeys.includes('DEPARTMENT_HEAD');

  const [
    projects,
    myAssignments,
    incomingHandovers,
    incomingProjectHandovers,
    activeRoadblocks,
    recentProgress,
    unreadCount,
    pendingReviewsCount,
  ] = await Promise.all([
    prisma.project.findMany({
      where: { ...visibility, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
      select: {
        id: true,
        code: true,
        name: true,
        clientName: true,
        status: true,
        priority: true,
        targetEndDate: true,
        startDate: true,
        manager: { select: { id: true, fullName: true, avatarColor: true, designation: true } },
        tasks: {
          select: {
            id: true,
            code: true,
            title: true,
            status: true,
            estimatedHours: true,
            percentComplete: true,
            plannedEnd: true,
          },
          orderBy: { code: 'asc' },
        },
      },
      orderBy: [{ priority: 'desc' }, { targetEndDate: 'asc' }],
      take: 25,
    }),
    prisma.taskAssignment.findMany({
      where: {
        userId: principal.userId,
        status: 'ACTIVE',
        task: { status: { notIn: ['COMPLETED', 'CANCELLED'] } },
      },
      include: {
        task: {
          select: {
            id: true,
            code: true,
            title: true,
            status: true,
            priority: true,
            percentComplete: true,
            plannedEnd: true,
            type: true,
            project: { select: { id: true, code: true, name: true } },
          },
        },
      },
      orderBy: { assignedAt: 'desc' },
      take: 20,
    }),
    prisma.taskHandover.findMany({
      where: { toUserId: principal.userId, status: 'PENDING' },
      include: {
        task: { select: { id: true, code: true, title: true, priority: true, plannedEnd: true } },
        fromUser: { select: { id: true, fullName: true, avatarColor: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.projectHandover.findMany({
      where: { toUserId: principal.userId, status: 'PENDING' },
      include: {
        project: { select: { id: true, name: true, clientName: true, priority: true, targetEndDate: true } },
        fromUser: { select: { id: true, fullName: true, avatarColor: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    isManagement
      ? prisma.taskProgressLog.findMany({
          where: {
            blocker: { not: null },
            task: { project: visibility, status: { in: ['BLOCKED', 'IN_PROGRESS', 'TODO'] } },
          },
          include: {
            user: { select: { id: true, fullName: true, avatarColor: true, designation: true, grade: true } },
            task: {
              select: {
                id: true,
                code: true,
                title: true,
                status: true,
                project: { select: { id: true, code: true, name: true, clientName: true } },
              },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        })
      : Promise.resolve([]),
    prisma.taskProgressLog.findMany({
      where: { task: { project: visibility } },
      include: {
        user: { select: { id: true, fullName: true, avatarColor: true } },
        task: { select: { id: true, code: true, title: true, project: { select: { id: true, code: true, name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 15,
    }),
    prisma.notification.count({ where: { userId: principal.userId, readAt: null } }),
    prisma.task.count({
      where: { project: visibility, status: 'IN_REVIEW' },
    }),
  ]);

  // Transform projects
  const projectCards = projects.map((project) => {
    const tasks = project.tasks;
    const totalHours = tasks.reduce((sum, t) => sum + t.estimatedHours, 0) || 1;
    const weighted = tasks.reduce((sum, t) => sum + t.percentComplete * t.estimatedHours, 0);
    const completedTasks = tasks.filter((t) => t.status === 'COMPLETED');
    const firstIncomplete = tasks.find((t) => !['COMPLETED', 'CANCELLED'].includes(t.status));

    const blockedCount = tasks.filter((t) => t.status === 'BLOCKED').length;
    const overdueCount = tasks.filter(
      (t) => t.plannedEnd && t.plannedEnd < today && !['COMPLETED', 'CANCELLED'].includes(t.status),
    ).length;

    let health: 'HEALTHY' | 'AT_RISK' | 'BLOCKED' = 'HEALTHY';
    if (blockedCount > 0) health = 'BLOCKED';
    else if (overdueCount > 0) health = 'AT_RISK';

    return {
      id: project.id,
      code: project.code,
      name: project.name,
      clientName: project.clientName,
      status: project.status,
      priority: project.priority,
      targetEndDate: project.targetEndDate,
      manager: project.manager,
      taskCount: tasks.length,
      completedTaskCount: completedTasks.length,
      currentStep: firstIncomplete ? firstIncomplete.title : 'All steps completed',
      blockedCount,
      overdueCount,
      progressPercent: Math.round(weighted / totalHours),
      dueSoon: Boolean(project.targetEndDate && project.targetEndDate <= horizon),
      health,
    };
  });

  // Calculate workloads for team operations if management
  let parthTeamWorkload: Array<any> = [];
  let parasTeamWorkload: Array<any> = [];

  if (isManagement) {
    try {
      const workloads = await getWorkloads(principal, { from: today, to: horizon });

      // Separate into teams by engineer names
      parthTeamWorkload = workloads
        .filter((w) =>
          ['Parth', 'Shivam', 'Agastya', 'Sahil', 'Abbasali', 'Het', 'Dhrupin', 'Jigar Girishbhai'].some((name) =>
            w.person.fullName.includes(name),
          ),
        )
        .slice(0, 10);

      parasTeamWorkload = workloads
        .filter((w) =>
          ['Paras', 'Ridhhi', 'Harsh', 'Chirag', 'Hitesh', 'Krupesh', 'Harmitsinh', 'Munaf', 'Ashish', 'Tejas'].some(
            (name) => w.person.fullName.includes(name),
          ),
        )
        .slice(0, 10);
    } catch {
      // Fallback
    }
  }

  return {
    isManagement,
    unreadCount,
    projects: projectCards,
    portfolio: {
      activeProjects: projectCards.length,
      atRisk: projectCards.filter((p) => p.health === 'AT_RISK').length,
      activeRoadblocks: activeRoadblocks.length,
      pendingReviews: pendingReviewsCount,
      overdueTasks: projectCards.reduce((sum, p) => sum + p.overdueCount, 0),
    },
    myWork: {
      total: myAssignments.length,
      overdue: myAssignments.filter((a) => a.task.plannedEnd && a.task.plannedEnd < today).length,
      dueThisWeek: myAssignments.filter(
        (a) => a.task.plannedEnd && a.task.plannedEnd >= today && a.task.plannedEnd <= horizon,
      ).length,
      blocked: myAssignments.filter((a) => a.task.status === 'BLOCKED').length,
      items: myAssignments,
    },
    incomingHandovers,
    incomingProjectHandovers,
    activeRoadblocks,
    recentProgress,
    teamOperations: {
      parthTeam: parthTeamWorkload,
      parasTeam: parasTeamWorkload,
    },
  };
}
