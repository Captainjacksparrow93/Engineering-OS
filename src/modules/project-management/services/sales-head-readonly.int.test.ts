import { describe, it, expect } from 'vitest';
import { prisma } from '@/core/db/prisma';
import { loadPrincipal } from '@/core/rbac/principal';
import { ForbiddenError } from '@/core/rbac/errors';
import { hasPermissionAnywhere, isReadOnly } from '@/core/rbac/engine';
import {
  assignEngineerToCommissioning,
  closeCommissioning,
  listCommissioningProjects,
  releaseEngineerFromCommissioning,
} from './commissioning.service';
import { addTemplateItem, deleteTemplateItem, updateTemplateItem } from './template.service';
import { addComment } from './task.service';
import { getDashboard } from './dashboard.service';

// Relies on prisma/scripts/grant-read-permissions.ts having run (it runs on every container start).
async function salesHead() {
  const user = await prisma.user.findUniqueOrThrow({ where: { email: 'dharmesh.thummar@acsengitech.com' } });
  return (await loadPrincipal(user.id))!;
}

describe('Sales Head is read-only everywhere (#12)', () => {
  it('holds the read keys for commissioning and checklists, and nothing mutating', async () => {
    const p = await salesHead();
    expect(hasPermissionAnywhere(p, 'pm.commissioning.read')).toBe(true);
    expect(hasPermissionAnywhere(p, 'pm.template.read')).toBe(true);
    expect(isReadOnly(p)).toBe(true);
  });

  it('can list site commissioning', async () => {
    const data = await listCommissioningProjects(await salesHead());
    expect(Array.isArray(data.pending)).toBe(true);
    expect(Array.isArray(data.inCommissioning)).toBe(true);
  });

  it('is refused every commissioning write', async () => {
    const p = await salesHead();
    await expect(assignEngineerToCommissioning(p, 'any', p.userId)).rejects.toThrow(ForbiddenError);
    await expect(releaseEngineerFromCommissioning(p, 'any', p.userId)).rejects.toThrow(ForbiddenError);
    await expect(closeCommissioning(p, 'any')).rejects.toThrow(ForbiddenError);
  });

  it('is refused every checklist write', async () => {
    const p = await salesHead();
    await expect(addTemplateItem(p, 'any', { title: 'x' } as never)).rejects.toThrow(ForbiddenError);
    await expect(updateTemplateItem(p, 'any', { title: 'x' })).rejects.toThrow(ForbiddenError);
    await expect(deleteTemplateItem(p, 'any')).rejects.toThrow(ForbiddenError);
  });

  it('cannot post task comments', async () => {
    const p = await salesHead();
    const task = await prisma.task.findFirst({ select: { id: true } });
    await expect(addComment(p, task?.id ?? 'any', 'hello')).rejects.toThrow(ForbiddenError);
  });

  it('gets the company-wide Director dashboard', async () => {
    const data = await getDashboard(await salesHead());
    expect(data.kind).toBe('director');
  });
});
