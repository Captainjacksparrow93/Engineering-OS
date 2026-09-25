import { prisma } from '@/core/db/prisma';
import { hasPermissionAnywhere } from '@/core/rbac/engine';
import { DomainError, ForbiddenError, NotFoundError } from '@/core/rbac/errors';
import type { Principal } from '@/core/rbac/types';
import { audit } from '@/core/audit/audit';
import { projectVisibilityWhere } from './access';
import { projectProgress } from '../domain/portfolio';

export async function listClients(companyId: string) {
  return prisma.client.findMany({
    where: {
      companyId,
      isActive: true,
    },
    select: {
      id: true,
      name: true,
      refNumber: true,
      isActive: true,
    },
    orderBy: { name: 'asc' },
  });
}

export async function getClientById(companyId: string, id: string) {
  return prisma.client.findFirst({
    where: { id, companyId },
    select: { id: true, name: true, refNumber: true, isActive: true },
  });
}

export async function nextClientRef(companyId: string): Promise<string> {
  const clients = await prisma.client.findMany({
    where: { companyId },
    select: { refNumber: true },
  });

  let maxSeq = 0;
  for (const c of clients) {
    const match = c.refNumber.match(/^ACS-(\d{4})$/i);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxSeq) maxSeq = num;
    }
  }

  const nextNum = maxSeq + 1;
  return `ACS-${String(nextNum).padStart(4, '0')}`;
}

export async function createClient(
  principal: Principal,
  input: { name: string; refNumber: string }
) {
  if (!hasPermissionAnywhere(principal, 'pm.project.create')) {
    throw new ForbiddenError('Missing permission: pm.project.create');
  }

  const name = input.name.trim();
  const refNumber = input.refNumber.trim().toUpperCase();

  if (!name || name.length < 2) {
    throw new DomainError('Client name must be at least 2 characters.');
  }

  if (!refNumber || !/^ACS-\d{4}$/.test(refNumber)) {
    throw new DomainError('Client reference number must follow format ACS-XXXX (e.g. ACS-0042).');
  }

  const existingName = await prisma.client.findUnique({
    where: { companyId_name: { companyId: principal.companyId, name } },
  });
  if (existingName) {
    throw new DomainError(`Client with name "${name}" already exists.`);
  }

  const existingRef = await prisma.client.findUnique({
    where: { companyId_refNumber: { companyId: principal.companyId, refNumber } },
  });
  if (existingRef) {
    throw new DomainError(`Client reference number "${refNumber}" is already in use.`);
  }

  const client = await prisma.client.create({
    data: {
      companyId: principal.companyId,
      name,
      refNumber,
      isActive: true,
    },
  });

  await audit({
    actorId: principal.userId,
    module: 'pm',
    action: 'client.created',
    entityType: 'Client',
    entityId: client.id,
    diff: { name, refNumber },
  });

  return client;
}

export interface ClientWithStats {
  id: string;
  name: string;
  refNumber: string;
  isActive: boolean;
  activeProjectsCount: number;
  completedProjectsCount: number;
  totalProjectsCount: number;
  lastProjectDate: Date | null;
}

export async function listClientsWithStats(principal: Principal): Promise<ClientWithStats[]> {
  if (!hasPermissionAnywhere(principal, 'pm.project.read')) {
    throw new ForbiddenError('Missing permission: pm.project.read');
  }

  const [clients, visibleProjects] = await Promise.all([
    prisma.client.findMany({
      where: { companyId: principal.companyId },
      select: {
        id: true,
        name: true,
        refNumber: true,
        isActive: true,
      },
      orderBy: { name: 'asc' },
    }),
    prisma.project.findMany({
      where: projectVisibilityWhere(principal),
      select: {
        id: true,
        clientId: true,
        clientName: true,
        status: true,
        startDate: true,
        targetEndDate: true,
        actualEndDate: true,
        createdAt: true,
      },
    }),
  ]);

  const CURRENT_STATUSES = new Set(['DRAFT', 'PLANNING', 'IN_PROGRESS', 'ON_HOLD', 'COMMISSIONING']);

  return clients.map((c) => {
    const cNameLower = c.name.trim().toLowerCase();
    const matchedProjects = visibleProjects.filter(
      (p) => p.clientId === c.id || (p.clientName && p.clientName.trim().toLowerCase() === cNameLower)
    );

    let activeCount = 0;
    let completedCount = 0;
    let lastDate: Date | null = null;

    for (const p of matchedProjects) {
      if (CURRENT_STATUSES.has(p.status)) {
        activeCount++;
      } else {
        completedCount++;
      }

      const pDate = p.targetEndDate ?? p.actualEndDate ?? p.startDate ?? p.createdAt;
      if (pDate) {
        if (!lastDate || pDate > lastDate) {
          lastDate = pDate;
        }
      }
    }

    return {
      id: c.id,
      name: c.name,
      refNumber: c.refNumber,
      isActive: c.isActive,
      activeProjectsCount: activeCount,
      completedProjectsCount: completedCount,
      totalProjectsCount: matchedProjects.length,
      lastProjectDate: lastDate,
    };
  });
}

export interface ClientPortfolioProject {
  id: string;
  code: string;
  workOrderNo?: string | null;
  name: string;
  clientName: string;
  status: string;
  priority: string;
  startDate: Date | null;
  targetEndDate: Date | null;
  actualEndDate: Date | null;
  progressPercent: number;
  manager: {
    id: string;
    fullName: string;
    avatarColor?: string | null;
  } | null;
}

export interface ClientPortfolioData {
  client: {
    id: string;
    name: string;
    refNumber: string;
    isActive: boolean;
  };
  stats: {
    activeCount: number;
    completedCount: number;
    totalCount: number;
  };
  currentProjects: ClientPortfolioProject[];
  pastProjects: ClientPortfolioProject[];
}

export async function getClientPortfolio(
  principal: Principal,
  clientId: string
): Promise<ClientPortfolioData> {
  if (!hasPermissionAnywhere(principal, 'pm.project.read')) {
    throw new ForbiddenError('Missing permission: pm.project.read');
  }

  const client = await prisma.client.findFirst({
    where: {
      OR: [
        { id: clientId },
        { refNumber: clientId },
      ],
    },
  });

  if (!client || client.companyId !== principal.companyId) {
    throw new NotFoundError('Client not found.');
  }

  const visibility = projectVisibilityWhere(principal);
  const projects = await prisma.project.findMany({
    where: {
      AND: [
        visibility,
        {
          OR: [
            { clientId: client.id },
            { clientName: { equals: client.name, mode: 'insensitive' } },
          ],
        },
      ],
    },
    select: {
      id: true,
      code: true,
      workOrderNo: true,
      name: true,
      clientName: true,
      status: true,
      priority: true,
      startDate: true,
      targetEndDate: true,
      actualEndDate: true,
      createdAt: true,
      manager: {
        select: {
          id: true,
          fullName: true,
          avatarColor: true,
        },
      },
      tasks: {
        where: { status: { not: 'CANCELLED' } },
        select: {
          id: true,
          type: true,
          parentId: true,
          status: true,
          estimatedHours: true,
          percentComplete: true,
        },
      },
    },
    orderBy: [{ targetEndDate: 'asc' }, { createdAt: 'desc' }],
  });

  const CURRENT_STATUSES = new Set(['DRAFT', 'PLANNING', 'IN_PROGRESS', 'ON_HOLD', 'COMMISSIONING']);
  const currentProjects: ClientPortfolioProject[] = [];
  const pastProjects: ClientPortfolioProject[] = [];

  for (const p of projects) {
    const progressPercent = projectProgress(p.tasks);
    const item: ClientPortfolioProject = {
      id: p.id,
      code: p.code,
      workOrderNo: p.workOrderNo,
      name: p.name,
      clientName: p.clientName,
      status: p.status,
      priority: p.priority,
      startDate: p.startDate,
      targetEndDate: p.targetEndDate,
      actualEndDate: p.actualEndDate,
      progressPercent,
      manager: p.manager
        ? {
            id: p.manager.id,
            fullName: p.manager.fullName,
            avatarColor: p.manager.avatarColor,
          }
        : null,
    };

    if (CURRENT_STATUSES.has(p.status)) {
      currentProjects.push(item);
    } else {
      pastProjects.push(item);
    }
  }

  pastProjects.sort((a, b) => {
    const dateA = a.actualEndDate ?? a.targetEndDate ?? a.startDate;
    const dateB = b.actualEndDate ?? b.targetEndDate ?? b.startDate;
    if (dateA && dateB) return dateB.getTime() - dateA.getTime();
    if (dateA) return -1;
    if (dateB) return 1;
    return 0;
  });

  return {
    client: {
      id: client.id,
      name: client.name,
      refNumber: client.refNumber,
      isActive: client.isActive,
    },
    stats: {
      activeCount: currentProjects.length,
      completedCount: pastProjects.length,
      totalCount: projects.length,
    },
    currentProjects,
    pastProjects,
  };
}
