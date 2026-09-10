import { prisma } from '@/core/db/prisma';
import { DomainError } from '@/core/rbac/errors';
import type { Principal } from '@/core/rbac/types';
import { audit } from '@/core/audit/audit';
import { assertTaskPermission } from './access';
import { recomputeTaskDerivedState } from './task.service';
import { findCycle, type GraphEdge } from '../domain/scheduling';

/**
 * Dependency management.
 *
 * Two invariants are enforced on every insert: dependencies stay inside one project,
 * and the graph stays acyclic. The cycle check runs against the candidate edge BEFORE
 * the write, so an impossible plan can never be persisted.
 */
export async function addDependency(
  principal: Principal,
  input: {
    predecessorId: string;
    successorId: string;
    type?: 'FINISH_TO_START' | 'START_TO_START' | 'FINISH_TO_FINISH' | 'START_TO_FINISH';
    lagDays?: number;
  },
) {
  if (input.predecessorId === input.successorId) {
    throw new DomainError('A task cannot depend on itself.');
  }

  const successor = await assertTaskPermission(principal, input.successorId, 'pm.task.dependency.manage');
  const predecessor = await prisma.task.findUnique({
    where: { id: input.predecessorId },
    select: { id: true, code: true, projectId: true, title: true },
  });
  if (!predecessor) throw new DomainError('The predecessor task does not exist.');
  if (predecessor.projectId !== successor.projectId) {
    throw new DomainError('Cross-project dependencies are not supported yet.');
  }

  const existing = await prisma.taskDependency.findUnique({
    where: { predecessorId_successorId: { predecessorId: input.predecessorId, successorId: input.successorId } },
  });
  if (existing) throw new DomainError('That dependency already exists.');

  const edges = await loadEdges(successor.projectId);
  const candidate: GraphEdge = {
    predecessorId: input.predecessorId,
    successorId: input.successorId,
    type: input.type ?? 'FINISH_TO_START',
    lagDays: input.lagDays ?? 0,
  };

  const cycle = findCycle(edges, candidate);
  if (cycle) {
    const codes = await prisma.task.findMany({
      where: { id: { in: cycle } },
      select: { id: true, code: true },
    });
    const path = cycle.map((id) => codes.find((c) => c.id === id)?.code ?? id).join(' → ');
    throw new DomainError(`This would create a circular dependency: ${path}`);
  }

  const dependency = await prisma.$transaction(async (tx) => {
    const created = await tx.taskDependency.create({ data: candidate });
    await audit(
      {
        actorId: principal.userId,
        module: 'pm',
        action: 'dependency.added',
        entityType: 'Task',
        entityId: input.successorId,
        diff: { predecessorId: input.predecessorId, type: candidate.type, lagDays: candidate.lagDays },
      },
      tx,
    );
    return created;
  });

  await recomputeTaskDerivedState(successor.projectId);
  return dependency;
}

export async function removeDependency(principal: Principal, dependencyId: string) {
  const dependency = await prisma.taskDependency.findUnique({
    where: { id: dependencyId },
    include: { successor: { select: { id: true, projectId: true } } },
  });
  if (!dependency) throw new DomainError('That dependency no longer exists.');

  await assertTaskPermission(principal, dependency.successorId, 'pm.task.dependency.manage');

  await prisma.$transaction(async (tx) => {
    await tx.taskDependency.delete({ where: { id: dependencyId } });
    await audit(
      {
        actorId: principal.userId,
        module: 'pm',
        action: 'dependency.removed',
        entityType: 'Task',
        entityId: dependency.successorId,
        diff: { predecessorId: dependency.predecessorId },
      },
      tx,
    );
  });

  await recomputeTaskDerivedState(dependency.successor.projectId);
}

async function loadEdges(projectId: string): Promise<GraphEdge[]> {
  return prisma.taskDependency.findMany({
    where: { successor: { projectId } },
    select: { predecessorId: true, successorId: true, type: true, lagDays: true },
  });
}
