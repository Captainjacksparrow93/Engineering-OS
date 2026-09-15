'use server';

import { revalidatePath } from 'next/cache';
import { requirePrincipal } from '@/core/auth/session';
import {
  updateTemplateItem,
  addTemplateItem,
  deleteTemplateItem,
} from '@/modules/project-management/services/template.service';

export async function updateTemplateItemAction(
  itemId: string,
  data: {
    title?: string;
    description?: string;
    recommendedSeniority?: string;
    defaultDurationDays?: number;
    dependsOnStep?: number | null;
  },
) {
  const principal = await requirePrincipal();
  try {
    const updated = await updateTemplateItem(principal, itemId, data);
    revalidatePath('/pm/templates');
    return { success: true, item: updated };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to update item.' };
  }
}

export async function addTemplateItemAction(
  templateId: string,
  data: {
    title: string;
    description?: string;
    recommendedSeniority?: string;
    defaultDurationDays?: number;
    dependsOnStep?: number | null;
  },
) {
  const principal = await requirePrincipal();
  try {
    const created = await addTemplateItem(principal, templateId, data);
    revalidatePath('/pm/templates');
    return { success: true, item: created };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to add item.' };
  }
}

export async function deleteTemplateItemAction(itemId: string) {
  const principal = await requirePrincipal();
  try {
    await deleteTemplateItem(principal, itemId);
    revalidatePath('/pm/templates');
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to delete item.' };
  }
}
