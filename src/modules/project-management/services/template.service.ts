import { prisma } from '@/core/db/prisma';
import { DomainError } from '@/core/rbac/errors';
import type { Principal } from '@/core/rbac/types';
import { audit } from '@/core/audit/audit';

function assertTemplateAdmin(principal: Principal) {
  const isDirectorOrHead =
    principal.grade === 'DIRECTOR' ||
    principal.grade === 'HEAD' ||
    principal.roleKeys.includes('DIRECTOR') ||
    principal.roleKeys.includes('DEPARTMENT_HEAD');
  if (!isDirectorOrHead) {
    throw new DomainError('Only Directors and Department Heads can edit master checklist templates.');
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
        defaultDurationDays: data.defaultDurationDays ?? 2,
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
  });

  return { success: true };
}
