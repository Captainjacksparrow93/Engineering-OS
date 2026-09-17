'use server';

import { redirect } from 'next/navigation';
import { ZodError } from 'zod';
import { requirePrincipal } from '@/core/auth/session';
import { createAutomationProjectSchema } from '@/modules/project-management/validation/schemas';
import {
  createAutomationProject,
  type CreateAutomationProjectInput,
} from '@/modules/project-management/services/automation-project.service';

export async function createAutomationProjectAction(rawInput: CreateAutomationProjectInput) {
  const principal = await requirePrincipal();
  let projectId: string | null = null;

  try {
    const input = createAutomationProjectSchema.parse(rawInput);
    const project = await createAutomationProject(principal, input);
    projectId = project.id;
  } catch (error) {
    console.error('Failed to create automation project:', error);
    return {
      success: false,
      error: error instanceof ZodError
        ? error.issues[0]?.message ?? 'Please check the form.'
        : error instanceof Error
          ? error.message : 'Failed to create automation project.',
    };
  }


  if (projectId) {
    redirect(`/pm/projects/${projectId}`);
  }
  return { success: true };
}
