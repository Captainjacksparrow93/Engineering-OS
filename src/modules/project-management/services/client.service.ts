import { prisma } from '@/core/db/prisma';
import { assertCan } from '@/core/rbac/guard';
import { DomainError } from '@/core/rbac/errors';
import type { Principal } from '@/core/rbac/types';
import { audit } from '@/core/audit/audit';

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
  assertCan(principal, 'pm.project.create');

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
