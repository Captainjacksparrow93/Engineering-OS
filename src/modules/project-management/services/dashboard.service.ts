import { prisma } from '@/core/db/prisma';
import { can } from '@/core/rbac/engine';
import type { Principal } from '@/core/rbac/types';
import { addDays, startOfDay } from '@/core/utils/dates';
import { projectVisibilityWhere } from './access';

/**
 * The landing screen.
 *
 * One dashboard serves everyone, but the panels differ by what the person can see:
 * a director gets portfolio health and the blocker list; an engineer gets their queue
 * and their pending handovers. Both come from the same visibility rules as everything
 * else, so nothing leaks.
 */
export async function getDashboard(principal: Principal) {
  const today = startOfDay(new Date());
  const horizon = addDays(today, 7);
  const visibility = projectVisibilityWhere(principal);
  const isManagement = can(principal, 'pm.report.read') || can(principal, 'pm.project.read.all');

  const [projects, myAssignments, incomingHandovers, blockers, recentProgress, unreadCount] = await Promise.all([
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
        manager: { select: { id: true, fullName: true, avatarColor: true } },
        tasks: { select: { status: true, estimatedHours: true, percentComplete: true, plannedEnd: true } },
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
    isManagement
      ? prisma.taskProgressLog.findMany({
          where: {
            blocker: { not: null },
            createdAt: { gte: addDays(today, -14) },
            task: { project: visibility, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
          },
          include: {
            user: { select: { id: true, fullName: true, avatarColor: true } },
            task: {
              select: { id: true, code: true, title: true, status: true, project: { select: { id: true, code: true } } },
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
        task: { select: { id: true, code: true, title: true, project: { select: { id: true, code: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 12,
    }),
    prisma.notification.count({ where: { userId: principal.userId, readAt: null } }),
  ]);

  const projectCards = projects.map((project) => {
    const tasks = project.tasks;
    const totalHours = tasks.reduce((sum, t) => sum + t.estimatedHours, 0) || 1;
    const weighted = tasks.reduce((sum, t) => sum + t.percentComplete * t.estimatedHours, 0);
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
      blockedCount: tasks.filter((t) => t.status === 'BLOCKED').length,
      overdueCount: tasks.filter(
        (t) => t.plannedEnd && t.plannedEnd < today && !['COMPLETED', 'CANCELLED'].includes(t.status),
      ).length,
      progressPercent: Math.round(weighted / totalHours),
      dueSoon: Boolean(project.targetEndDate && project.targetEndDate <= horizon),
    };
  });

  return {
    isManagement,
    unreadCount,
    projects: projectCards,
    portfolio: {
      activeProjects: projectCards.length,
      atRisk: projectCards.filter((p) => p.blockedCount > 0 || p.overdueCount > 0).length,
      blockedTasks: projectCards.reduce((sum, p) => sum + p.blockedCount, 0),
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
    blockers,
    recentProgress,
  };
}
