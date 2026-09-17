import { prisma } from '@/core/db/prisma';
import { hasPermissionAnywhere } from '@/core/rbac/engine';
import { ForbiddenError } from '@/core/rbac/errors';
import type { Principal } from '@/core/rbac/types';
import { audit } from '@/core/audit/audit';
import { recomputeTaskDerivedState } from './task.service';

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

function assertTemplateAdmin(principal: Principal) {
  if (!hasPermissionAnywhere(principal, 'pm.template.manage')) {
    throw new ForbiddenError('Only users with template management permissions can edit master checklist templates.');
  }
}

export async function syncTemplateDependenciesToProjects(templateId: string, tx: Tx = prisma) {
  const template = await tx.checklistTemplate.findUnique({
    where: { id: templateId },
    include: { items: { orderBy: { stepNumber: 'asc' } } },
  });
  if (!template || template.items.length === 0) return;

  const itemTitles = template.items.map((i) => i.title);

  // Find all tasks with matching titles in active/planned projects
  const matchingTasks = await tx.task.findMany({
    where: {
      title: { in: itemTitles },
      project: { status: { not: 'CANCELLED' } },
    },
    select: {
      id: true,
      title: true,
      projectId: true,
      parentId: true,
      status: true,
    },
  });

  // Group by (projectId, parentId)
  const groups = new Map<string, typeof matchingTasks>();
  for (const t of matchingTasks) {
    const key = `${t.projectId}::${t.parentId ?? 'root'}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }

  const affectedProjectIds = new Set<string>();

  for (const [, tasksInGroup] of groups) {
    if (tasksInGroup.length === 0) continue;
    const projectId = tasksInGroup[0].projectId;
    affectedProjectIds.add(projectId);

    // Map stepNumber -> task
    const stepToTask = new Map<number, (typeof matchingTasks)[0]>();
    for (const item of template.items) {
      const task = tasksInGroup.find((t) => t.title === item.title);
      if (task) {
        stepToTask.set(item.stepNumber, task);
      }
    }

    // Update dependencies for all steps in this template group
    for (const item of template.items) {
      const successorTask = stepToTask.get(item.stepNumber);
      if (!successorTask) continue;

      const existingDeps = await tx.taskDependency.findMany({
        where: { successorId: successorTask.id },
      });

      if (item.dependsOnStep === null || item.dependsOnStep === undefined) {
        // Delete any dependency where predecessor is in this group
        for (const dep of existingDeps) {
          if (Array.from(stepToTask.values()).some((t) => t.id === dep.predecessorId)) {
            await tx.taskDependency.delete({
              where: {
                predecessorId_successorId: {
                  predecessorId: dep.predecessorId,
                  successorId: successorTask.id,
                },
              },
            });
          }
        }
      } else {
        const predTask = stepToTask.get(item.dependsOnStep);
        if (predTask) {
          // Remove any outdated predecessor from this template group
          for (const dep of existingDeps) {
            if (
              dep.predecessorId !== predTask.id &&
              Array.from(stepToTask.values()).some((t) => t.id === dep.predecessorId)
            ) {
              await tx.taskDependency.delete({
                where: {
                  predecessorId_successorId: {
                    predecessorId: dep.predecessorId,
                    successorId: successorTask.id,
                  },
                },
              });
            }
          }
          // Ensure dependency to predTask exists
          const hasDep = existingDeps.some((d) => d.predecessorId === predTask.id);
          if (!hasDep) {
            await tx.taskDependency.create({
              data: {
                predecessorId: predTask.id,
                successorId: successorTask.id,
                type: 'FINISH_TO_START',
                lagDays: 0,
              },
            });
          }
        }
      }
    }
  }

  // Recompute task derived state for all affected projects
  for (const projId of affectedProjectIds) {
    await recomputeTaskDerivedState(projId, tx);
  }
}

export async function listChecklistTemplates() {
  return prisma.checklistTemplate.findMany({
    where: { isActive: true },
    include: {
      items: {
        orderBy: { stepNumber: 'asc' },
      },
    },
    orderBy: { code: 'asc' },
  });
}

export async function getChecklistTemplate(codeOrId: string) {
  return prisma.checklistTemplate.findFirst({
    where: {
      OR: [{ id: codeOrId }, { code: codeOrId }],
      isActive: true,
    },
    include: {
      items: {
        orderBy: { stepNumber: 'asc' },
      },
    },
  });
}

export async function updateTemplateItem(
  principal: Principal,
  itemId: string,
  data: {
    title?: string;
    description?: string;
    recommendedSeniority?: string;
    defaultDurationDays?: number;
    dependsOnStep?: number | null;
  },
) {
  assertTemplateAdmin(principal);

  const before = await prisma.checklistTemplateItem.findUniqueOrThrow({ where: { id: itemId } });

  const updated = await prisma.$transaction(async (tx) => {
    const item = await tx.checklistTemplateItem.update({
      where: { id: itemId },
      data: {
        title: data.title !== undefined ? data.title : before.title,
        description: data.description !== undefined ? data.description : before.description,
        recommendedSeniority: data.recommendedSeniority !== undefined ? data.recommendedSeniority : before.recommendedSeniority,
        defaultDurationDays: data.defaultDurationDays !== undefined ? data.defaultDurationDays : before.defaultDurationDays,
        dependsOnStep: data.dependsOnStep !== undefined ? data.dependsOnStep : before.dependsOnStep,
      },
    });

    await audit(
      {
        actorId: principal.userId,
        module: 'pm',
        action: 'checklist_template.item_updated',
        entityType: 'ChecklistTemplateItem',
        entityId: itemId,
        diff: { from: before, to: data },
      },
      tx,
    );

    await syncTemplateDependenciesToProjects(before.templateId, tx);

    return item;
  });

  return updated;
}

export async function addTemplateItem(
  principal: Principal,
  templateId: string,
  data: {
    title: string;
    description?: string;
    recommendedSeniority?: string;
    defaultDurationDays?: number;
    dependsOnStep?: number | null;
  },
) {
  assertTemplateAdmin(principal);

  const template = await prisma.checklistTemplate.findUniqueOrThrow({
    where: { id: templateId },
    include: { items: { orderBy: { stepNumber: 'desc' }, take: 1 } },
  });

  const nextStep = (template.items[0]?.stepNumber ?? 0) + 1;
  const code = `${template.code}_STEP_${String(nextStep).padStart(2, '0')}`;

  const created = await prisma.$transaction(async (tx) => {
    const item = await tx.checklistTemplateItem.create({
      data: {
        templateId,
        stepNumber: nextStep,
        code,
        title: data.title,
        description: data.description ?? null,
        recommendedSeniority: data.recommendedSeniority ?? 'JUNIOR',
        defaultDurationDays: data.defaultDurationDays ?? 1,
        dependsOnStep: data.dependsOnStep ?? (nextStep > 1 ? nextStep - 1 : null),
        sortOrder: nextStep,
      },
    });

    await audit(
      {
        actorId: principal.userId,
        module: 'pm',
        action: 'checklist_template.item_created',
        entityType: 'ChecklistTemplateItem',
        entityId: item.id,
        diff: { templateId, step: nextStep, title: data.title },
      },
      tx,
    );

    await syncTemplateDependenciesToProjects(templateId, tx);

    return item;
  });

  return created;
}

export async function deleteTemplateItem(principal: Principal, itemId: string) {
  assertTemplateAdmin(principal);

  const item = await prisma.checklistTemplateItem.findUniqueOrThrow({
    where: { id: itemId },
    include: { template: { select: { code: true } } },
  });

  await prisma.$transaction(async (tx) => {
    await tx.checklistTemplateItem.delete({ where: { id: itemId } });

    // Re-number remaining items in the template and remap dependencies
    const remaining = await tx.checklistTemplateItem.findMany({
      where: { templateId: item.templateId },
      orderBy: { stepNumber: 'asc' },
    });

    const oldToNew = new Map<number, number>();
    for (let i = 0; i < remaining.length; i++) {
      oldToNew.set(remaining[i]!.stepNumber, i + 1);
    }

    for (let i = 0; i < remaining.length; i++) {
      const current = remaining[i]!;
      const step = i + 1;
      const code = `${item.template.code}_STEP_${String(step).padStart(2, '0')}`;

      let newDependsOn: number | null = null;
      if (current.dependsOnStep === item.stepNumber) {
        // Pointed at the deleted step: bridge to deleted item's predecessor if valid
        newDependsOn = item.dependsOnStep ? (oldToNew.get(item.dependsOnStep) ?? null) : null;
      } else if (current.dependsOnStep) {
        newDependsOn = oldToNew.get(current.dependsOnStep) ?? null;
      }

      await tx.checklistTemplateItem.update({
        where: { id: current.id },
        data: {
          stepNumber: step,
          sortOrder: step,
          code,
          dependsOnStep: newDependsOn,
        },
      });
    }

    await audit(
      {
        actorId: principal.userId,
        module: 'pm',
        action: 'checklist_template.item_deleted',
        entityType: 'ChecklistTemplateItem',
        entityId: itemId,
        diff: { deletedItem: item.title, step: item.stepNumber },
      },
      tx,
    );

    await syncTemplateDependenciesToProjects(item.templateId, tx);
  });

  return { success: true };
}
