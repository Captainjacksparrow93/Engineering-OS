import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/core/db/prisma';
import { DomainError, ForbiddenError } from '@/core/rbac/errors';
import type { Principal } from '@/core/rbac/types';
import { makeErpCompany } from './test-fixture';
import { cancelAsset, createAsset, updateAsset, createCategory, depreciationDue, fixedAssetAccounts, getAsset, listAssets, moveAsset, postDepreciation, scrapAsset, submitAsset } from './services/asset.service';
import { assetsOverview, cancelLog, completeRepair, createSchedule, downWorkstations, listLogs, listSchedules, logScheduleDone, reportBreakdown, startRepair } from './services/maintenance.service';
import { createWorkstation } from './services/bom.service';

const iso = (d: Date) => d.toISOString().slice(0, 10);

describe('Plan 022 phase 6: assets + maintenance', () => {
  let fx: Awaited<ReturnType<typeof makeErpCompany>>;
  let mm: Principal;
  let accounts: Principal;
  let engineer: Principal;
  let categoryId: string;
  let accountId: string;

  async function balanced() {
    const agg = await prisma.erpGlEntry.aggregate({ where: { companyId: fx.companyId }, _sum: { debit: true, credit: true } });
    return agg._sum.debit?.toFixed(2) === agg._sum.credit?.toFixed(2);
  }
  async function balance(key: string) {
    const agg = await prisma.erpGlEntry.aggregate({ where: { companyId: fx.companyId, isCancelled: false, account: { systemKey: key } }, _sum: { debit: true, credit: true } });
    return (agg._sum.debit ?? new Prisma.Decimal(0)).minus(agg._sum.credit ?? 0).toFixed(2);
  }

  beforeAll(async () => {
    fx = await makeErpCompany('AST');
    mm = await fx.user('MAINTENANCE_MANAGER', 'Maintenance');
    accounts = await fx.user('ACCOUNTS_MANAGER', 'Accounts');
    engineer = await fx.user('JUNIOR_ENGINEER', 'Engineer');
  });

  afterAll(async () => {
    await fx.cleanup();
  });

  it('categories: allow, deny and validation', async () => {
    await expect(createCategory(engineer, { name: 'Test equipment', usefulLifeMonths: '60', fixedAssetAccountId: 'x' })).rejects.toThrow(ForbiddenError);
    await expect(createCategory(accounts, { name: 'Test equipment', usefulLifeMonths: '60', fixedAssetAccountId: 'x' })).rejects.toThrow(ForbiddenError);
    await expect(createCategory(mm, { name: 'Test equipment', usefulLifeMonths: '0', fixedAssetAccountId: 'x' })).rejects.toThrow(ZodError);
    await expect(createCategory(mm, { name: 'Test equipment', usefulLifeMonths: '60', fixedAssetAccountId: 'not-an-account' })).rejects.toThrow(/fixed-asset account/);
    accountId = (await fixedAssetAccounts(fx.companyId)).find((a) => a.name === 'Tools and Test Equipment')!.id;
    categoryId = (await createCategory(mm, { name: 'Test equipment', usefulLifeMonths: '12', fixedAssetAccountId: accountId })).id;
    await expect(createCategory(mm, { name: 'Test equipment', usefulLifeMonths: '12', fixedAssetAccountId: accountId })).rejects.toThrow(/already exists/);
  });

  it('submits an asset with a straight-line schedule and posts depreciation due', async () => {
    await expect(createAsset(mm, { name: 'Hipot tester', categoryId, purchaseDate: '2026-04-05', grossValue: '120000', salvageValue: '130000' })).rejects.toThrow(ZodError);
    await expect(createAsset(mm, { name: 'Hipot tester', categoryId, purchaseDate: '2026-04-05', grossValue: '120000', openingAccumulated: '5000' })).rejects.toThrow(ZodError);
    const a = await createAsset(mm, { name: 'Hipot tester', categoryId, purchaseDate: '2026-04-05', grossValue: '120000', salvageValue: '12000', location: 'Test bay' });
    expect(a.usefulLifeMonths).toBe(12);
    await expect(submitAsset(mm, a.id)).rejects.toThrow(/purchase invoice/);
    await updateAsset(mm, a.id, { name: 'Hipot tester', categoryId, purchaseDate: '2026-04-05', grossValue: '120000', salvageValue: '12000', location: 'Test bay', isExisting: 'on' });
    await submitAsset(mm, a.id);
    await expect(submitAsset(mm, a.id)).rejects.toThrow(DomainError);
    const { asset } = await getAsset(mm, a.id);
    expect(asset.depreciation).toHaveLength(12);
    expect(asset.depreciation[0]!.amount.toFixed(2)).toBe('9000.00');
    expect(iso(asset.depreciation[0]!.scheduleDate)).toBe('2026-04-30');

    const upTo = new Date('2026-06-30T00:00:00Z');
    expect((await depreciationDue(mm, upTo)).amount.toFixed(2)).toBe('27000.00');
    await expect(postDepreciation(engineer, upTo)).rejects.toThrow(ForbiddenError);
    const posted = await postDepreciation(accounts, upTo);
    expect(posted.count).toBe(3);
    expect(await balance('DEPRECIATION')).toBe('27000.00');
    expect(await balance('ACCUMULATED_DEPRECIATION')).toBe('-27000.00');
    expect((await postDepreciation(accounts, upTo)).count).toBe(0);
    expect((await getAsset(mm, a.id)).bookValue.toFixed(2)).toBe('93000.00');
    expect(await balanced()).toBe(true);

    await moveAsset(mm, a.id, { movedAt: '2026-07-01', location: 'Panel shop', custodianId: engineer.userId });
    await expect(moveAsset(mm, a.id, { movedAt: '2026-07-02', location: 'Panel shop', custodianId: engineer.userId })).rejects.toThrow(/Change the location/);
    const moved = await getAsset(mm, a.id);
    expect(moved.asset.location).toBe('Panel shop');
    expect(moved.asset.movements[0]!.fromLocation).toBe('Test bay');

    // Scrap in August: July and August post first, the rest is dropped, the asset leaves the books.
    await scrapAsset(mm, a.id, { date: '2026-08-31', note: 'Damaged' });
    const scrapped = await getAsset(mm, a.id);
    expect(scrapped.asset.status).toBe('SCRAPPED');
    expect(scrapped.asset.depreciation).toHaveLength(5);
    expect(await balance('ASSET_DISPOSAL')).toBe('75000.00');
    expect(await balance('ACCUMULATED_DEPRECIATION')).toBe('0.00');
    const tools = await prisma.erpGlEntry.aggregate({ where: { companyId: fx.companyId, isCancelled: false, accountId }, _sum: { credit: true } });
    expect(tools._sum.credit?.toFixed(2)).toBe('120000.00');
    expect(await balanced()).toBe(true);

    // Cancel reverses the disposal and all depreciation.
    await cancelAsset(mm, a.id);
    expect(await balance('DEPRECIATION')).toBe('0.00');
    expect(await balance('ASSET_DISPOSAL')).toBe('0.00');
    expect(await balanced()).toBe(true);
    expect((await listAssets(mm)).find((r) => r.id === a.id)).toBeUndefined();
  });

  it('existing assets continue their schedule from the months already booked', async () => {
    const a = await createAsset(mm, { name: 'Crimping press', categoryId, purchaseDate: '2025-10-01', grossValue: '60000', isExisting: 'on', openingAccumulated: '30000', openingMonths: '6' });
    await submitAsset(mm, a.id);
    const { asset, bookValue } = await getAsset(mm, a.id);
    expect(asset.depreciation).toHaveLength(6);
    expect(asset.depreciation[0]!.amount.toFixed(2)).toBe('5000.00');
    expect(iso(asset.depreciation[0]!.scheduleDate)).toBe('2026-04-30');
    expect(bookValue.toFixed(2)).toBe('30000.00');
  });

  it('preventive maintenance: schedule, due list, log done moves the next due date', async () => {
    const a = await createAsset(mm, { name: 'Compressor', categoryId, purchaseDate: '2026-01-10', grossValue: '45000', isExisting: 'on' });
    await expect(createSchedule(mm, { assetId: a.id, task: 'Drain tank', frequency: 'MONTHLY', nextDueDate: '2026-01-31' })).rejects.toThrow(/not in use/);
    await submitAsset(mm, a.id);
    await expect(createSchedule(engineer, { assetId: a.id, task: 'Drain tank', frequency: 'MONTHLY', nextDueDate: '2026-01-31' })).rejects.toThrow(ForbiddenError);
    await expect(createSchedule(mm, { assetId: a.id, task: '', frequency: 'MONTHLY', nextDueDate: '2026-01-31' })).rejects.toThrow(ZodError);
    const s = await createSchedule(mm, { assetId: a.id, task: 'Drain tank', frequency: 'MONTHLY', nextDueDate: '2026-01-31', assignedToId: engineer.userId });
    const due = await listSchedules(mm, { due: true });
    expect(due.find((r) => r.id === s.id)?.overdue).toBe(true);
    const log = await logScheduleDone(mm, s.id, { doneOn: '2026-02-03', actionTaken: 'Drained, no rust', cost: '0' });
    expect(log.status).toBe('DONE');
    const after = await prisma.erpMaintenanceSchedule.findUniqueOrThrow({ where: { id: s.id } });
    expect(iso(after.nextDueDate)).toBe('2026-03-03');
    expect((await getAsset(mm, a.id)).asset.maintenanceRequired).toBe(true);
  });

  it('breakdowns: report, notify, start, complete with downtime; machine shows down', async () => {
    const ws = await createWorkstation(await fx.user('PRODUCTION_MANAGER', 'Production'), { name: `Press ${fx.run}`, hourRate: '500' });
    const mm2 = await fx.user('MAINTENANCE_MANAGER', 'Maintenance Two');
    const a = await createAsset(mm, { name: 'Hydraulic press', categoryId, purchaseDate: '2026-02-01', grossValue: '200000', workstationId: ws.id, isExisting: 'on' });
    await submitAsset(mm, a.id);
    await expect(reportBreakdown(mm, { assetId: a.id, description: '' })).rejects.toThrow(ZodError);
    const b = await reportBreakdown(mm, { assetId: a.id, description: 'Oil leak at the main cylinder' });
    expect(await prisma.notification.count({ where: { userId: mm2.userId, link: `/erp/assets/maintenance/${b.id}` } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: mm.userId, link: `/erp/assets/maintenance/${b.id}` } })).toBe(0);
    await expect(reportBreakdown(mm, { assetId: a.id, description: 'Again' })).rejects.toThrow(/already has an open breakdown/);
    expect((await downWorkstations(fx.companyId)).has(ws.id)).toBe(true);
    await startRepair(mm, b.id);
    await expect(startRepair(mm, b.id)).rejects.toThrow(/already started/);
    await expect(completeRepair(engineer, b.id, { actionTaken: 'Seal replaced' })).rejects.toThrow(ForbiddenError);
    await completeRepair(mm, b.id, { actionTaken: 'Seal replaced', cost: '3500', downtimeHours: '6.5' });
    const done = (await listLogs(mm, { kind: 'BREAKDOWN' })).find((l) => l.id === b.id)!;
    expect(done.status).toBe('DONE');
    expect(done.downtimeHours?.toFixed(2)).toBe('6.50');
    expect((await downWorkstations(fx.companyId)).has(ws.id)).toBe(false);
    await expect(cancelLog(mm, b.id)).rejects.toThrow(/already done/);

    const overview = await assetsOverview(mm);
    expect(overview.inUse).toBeGreaterThanOrEqual(3);
    expect(overview.cost30.toFixed(2)).toBe('3500.00');
  });
});
