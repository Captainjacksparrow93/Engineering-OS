'use server';

import { revalidatePath } from 'next/cache';
import { requirePrincipal } from '@/core/auth/session';
import {
  templateItemSchema,
  updateTemplateItemSchema,
} from '@/modules/project-management/validation/schemas';
import {
  updateTemplateItem,
  addTemplateItem,
  deleteTemplateItem,
} from '@/modules/project-management/services/template.service';

export async function updateTemplateItemAction(
  itemId: string,
  data: unknown,
) {
  const principal = await requirePrincipal();
  try {
    const validated = updateTemplateItemSchema.parse(data);
    const updated = await updateTemplateItem(principal, itemId, validated);
    revalidatePath('/pm/templates');
    return { success: true, item: updated };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to update item.' };
  }
}

export async function addTemplateItemAction(
  templateId: string,
  data: unknown,
) {
  const principal = await requirePrincipal();
  try {
    const validated = templateItemSchema.parse(data);
    const created = await addTemplateItem(principal, templateId, validated);
    revalidatePath('/pm/templates');
    return { success: true, item: created };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to add item.' };
  }
}

export async function deleteTemplateItemAction(itemId: string) {
  const principal = await requirePrincipal();
  if (!itemId || typeof itemId !== 'string') {
    return { success: false, error: 'Valid item ID is required.' };
  }
  try {
    await deleteTemplateItem(principal, itemId);
    revalidatePath('/pm/templates');
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to delete item.' };
  }
}
