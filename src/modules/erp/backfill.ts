import { prisma } from '@/core/db/prisma';
import { D } from './domain/money';
import { ensurePanelItems } from './services/selling-bridge';
import { adjustBin } from './services/posting';
import { nextCode, nextNumber, SERIES } from './services/series';
import { systemWarehouseId } from './services/setup';

/**
 * Plan 022 phase 8 (the plan 015 rule, native): every work-order project that existed before
 * ERP gets a submitted sales order marked imported, its customer (linked to the PM client),
 * and each panel task tied to its order line, so later order changes sync safely. Values are
 * left at zero: the order records what was sold, not its price. Finished projects get closed
 * orders (nothing reserved). Dry run unless `apply`; re-running skips projects already linked.
 * Run by hand through `prisma/scripts/erp-backfill-orders.ts`; never from entrypoint.sh.
 */

export interface BackfillReport {
  created: number;
  skipped: number;
  failed: number;
  customers: number;
}

const PANEL_TITLE = /^([A-Za-z0-9]+)\s+Panel\s+(\d+)$/i;
const FINISHED = new Set(['COMPLETED', 'CLOSED', 'CANCELLED']);
const day = (d: Date) => d.toISOString().slice(0, 10);

export interface PlannedRow {
  code: string;
  qty: number;
  deliveryDate: Date;
  taskIds: string[];
}

/** One row per panel type; one row per panel when panels of a type have different dates. */
export function planOrderRows(panels: Array<{ id: string; title: string; plannedEnd: Date | null }>, fallback: Date): PlannedRow[] {
  const byCode = new Map<string, Array<{ id: string; unit: number; date: Date }>>();
  for (const p of panels) {
    const m = p.title.match(PANEL_TITLE);
    if (!m) continue;
    const code = m[1]!.toUpperCase();
    byCode.set(code, [...(byCode.get(code) ?? []), { id: p.id, unit: Number(m[2]), date: p.plannedEnd ?? fallback }]);
  }
  const rows: PlannedRow[] = [];
  for (const [code, list] of byCode) {
    list.sort((a, b) => a.unit - b.unit);
    if (list.every((p) => day(p.date) === day(list[0]!.date))) rows.push({ code, qty: list.length, deliveryDate: list[0]!.date, taskIds: list.map((p) => p.id) });
    else for (const p of list) rows.push({ code, qty: 1, deliveryDate: p.date, taskIds: [p.id] });
  }
  return rows;
}

export async function runBackfill({ companyId, actorId, apply, log = console.log }: { companyId: string; actorId: string; apply: boolean; log?: (line: string) => void }): Promise<BackfillReport> {
  const report: BackfillReport = { created: 0, skipped: 0, failed: 0, customers: 0 };
  const would = apply ? '' : 'would ';
  if (apply) await ensurePanelItems(companyId);
  const projects = await prisma.project.findMany({
    where: { companyId, kind: 'WORK_ORDER', erpSalesOrder: null },
    select: { id: true, code: true, name: true, status: true, workOrderNo: true, clientPoNumber: true, clientId: true, clientName: true, startDate: true, targetEndDate: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  for (const project of projects) {
    const label = `project ${project.code} "${project.name}"`;
    try {
      const panels = await prisma.task.findMany({ where: { projectId: project.id, type: 'PHASE' }, select: { id: true, title: true, plannedEnd: true } });
      const target = project.targetEndDate ?? project.startDate ?? project.createdAt;
      const rows = planOrderRows(panels, target);
      if (rows.length === 0) {
        report.skipped++;
        log(`skip ${label}: no panel phases`);
        continue;
      }
      const taken = project.workOrderNo ? await prisma.erpSalesOrder.findFirst({ where: { companyId, woNumber: project.workOrderNo, status: { not: 'CANCELLED' } }, select: { number: true } }) : null;
      if (taken) {
        report.skipped++;
        log(`skip ${label}: WO ${project.workOrderNo} is already on ${taken.number}; link it from the project instead`);
        continue;
      }
      if (!apply) {
        report.created++;
        log(`${would}create imported order for ${label}: ${rows.map((r) => `${r.qty} × ${r.code}`).join(', ')}`);
        continue;
      }
      await prisma.$transaction(async (tx) => {
        const client = project.clientId ? await tx.client.findUnique({ where: { id: project.clientId } }) : await tx.client.findFirst({ where: { companyId, name: project.clientName } });
        const name = client?.name ?? project.clientName;
        let customer = (client ? await tx.erpParty.findFirst({ where: { companyId, kind: 'CUSTOMER', clientId: client.id } }) : null) ?? (await tx.erpParty.findUnique({ where: { companyId_kind_name: { companyId, kind: 'CUSTOMER', name } } }));
        if (!customer) {
          customer = await tx.erpParty.create({ data: { companyId, kind: 'CUSTOMER', code: await nextCode(tx, companyId, SERIES.customer), name, clientId: client?.id ?? null } });
          report.customers++;
        } else if (client && !customer.clientId) {
          customer = await tx.erpParty.update({ where: { id: customer.id }, data: { clientId: client.id } });
        }
        if (client && !client.erpCustomer) await tx.client.update({ where: { id: client.id }, data: { erpCustomer: customer.code } });

        const [items, fg, settings] = await Promise.all([
          tx.erpItem.findMany({ where: { companyId, code: { in: rows.map((r) => r.code) } } }),
          systemWarehouseId(companyId, 'FINISHED_GOODS', tx),
          tx.erpSettings.findUniqueOrThrow({ where: { companyId } }),
        ]);
        const item = new Map(items.map((i) => [i.code, i]));
        const missing = rows.find((r) => !item.has(r.code));
        if (missing) throw new Error(`no item ${missing.code} (not a checklist template?)`);
        const finished = FINISHED.has(project.status);
        const orderDate = project.startDate ?? project.createdAt;
        const so = await tx.erpSalesOrder.create({
          data: {
            companyId,
            number: await nextNumber(tx, companyId, SERIES.salesOrder, orderDate),
            customerId: customer.id,
            status: 'SUBMITTED',
            isImported: true,
            isClosed: finished,
            orderDate,
            deliveryDate: project.targetEndDate,
            poNo: project.clientPoNumber,
            woNumber: project.workOrderNo,
            projectId: project.id,
            remarks: `Imported from PM project ${project.code}`,
            createdById: actorId,
            submittedById: actorId,
            submittedAt: new Date(),
          },
        });
        for (const [n, r] of rows.entries()) {
          const it = item.get(r.code)!;
          const line = await tx.erpSalesOrderLine.create({
            data: { orderId: so.id, itemId: it.id, description: `${r.code} panel`, qty: r.qty, rate: 0, amount: 0, gstRate: it.gstRate ?? settings.defaultGstRate, warehouseId: it.defaultWarehouseId ?? fg, deliveryDate: r.deliveryDate, sortOrder: n },
          });
          for (const [u, taskId] of r.taskIds.entries()) await tx.task.update({ where: { id: taskId }, data: { erpOrderItem: `${line.id}#${u + 1}` } });
          if (!finished && it.isStockItem) await adjustBin(tx, companyId, it.id, line.warehouseId, 'reservedQty', D(r.qty));
        }
        const saved = await tx.erpSalesOrder.findUniqueOrThrow({ where: { id: so.id }, select: { number: true, updatedAt: true } });
        await tx.project.update({ where: { id: project.id }, data: { erpSalesOrder: saved.number, erpOrderModified: saved.updatedAt.toISOString() } });
        log(`created ${saved.number} for ${label}${finished ? ' (closed: project finished)' : ''}`);
      });
      report.created++;
    } catch (err) {
      report.failed++;
      log(`FAILED ${label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  log(`${would}create ${report.created} orders and ${report.customers} customers; ${report.skipped} skipped; ${report.failed} failed`);
  return report;
}
