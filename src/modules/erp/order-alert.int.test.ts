import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/core/db/prisma';
import { loadPrincipal } from '@/core/rbac/principal';
import { ForbiddenError } from '@/core/rbac/errors';
import { clearOrderAlert } from '@/modules/project-management/services/project.service';
import { getPMTeamData } from '@/modules/project-management/services/automation-project.service';
import type { Principal } from '@/core/rbac/types';

describe('Plan 015 step 4: Mark reviewed clears the order alert', () => {
  const run = `${Date.now()}`.slice(-6);
  let director: Principal;
  let pm: Principal;
  let projectId: string;

  beforeAll(async () => {
    const acs = await prisma.company.findFirstOrThrow({ where: { code: 'ACS' } });
    const d = await prisma.user.findFirstOrThrow({
      where: { companyId: acs.id, status: 'ACTIVE', roleAssignments: { some: { role: { key: 'DIRECTOR' } } } },
    });
    director = (await loadPrincipal(d.id))!;
    pm = (await loadPrincipal((await getPMTeamData(acs.id)).managers[0]!.id))!;
    projectId = (
      await prisma.project.create({
        data: {
          companyId: acs.id,
          code: `ALERT-${run}`,
          name: 'Alert test',
          clientName: 'Alert client',
          managerId: pm.userId,
          erpSalesOrder: `SO-ALERT-${run}`,
          erpOrderAlert: 'Order cancelled in ERP. Nothing was changed or deleted here.',
          erpOrderAlertAt: new Date(),
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.project.delete({ where: { id: projectId } });
  });

  it('denies a PM', async () => {
    await expect(clearOrderAlert(pm, projectId)).rejects.toThrow(ForbiddenError);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: projectId } })).erpOrderAlert).not.toBeNull();
  });

  it('lets a Director clear it, audited', async () => {
    await clearOrderAlert(director, projectId);
    const p = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    expect(p.erpOrderAlert).toBeNull();
    expect(p.erpOrderAlertAt).toBeNull();
    const log = await prisma.auditLog.findFirstOrThrow({ where: { entityId: projectId, module: 'erp', action: 'order_alert_cleared' } });
    expect(log.actorId).toBe(director.userId);
    expect(log.diff).toMatchObject({ alert: 'Order cancelled in ERP. Nothing was changed or deleted here.' });
  });

  it('is a no-op on a project without an alert', async () => {
    await clearOrderAlert(director, projectId);
    expect(await prisma.auditLog.count({ where: { entityId: projectId, action: 'order_alert_cleared' } })).toBe(1);
  });
});
