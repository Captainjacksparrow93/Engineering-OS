import { prisma } from '@/core/db/prisma';
import { config } from '@/core/config';
import { audit } from '@/core/audit/audit';
import { hasPermissionAnywhere } from '@/core/rbac/engine';
import { DomainError, ForbiddenError, NotFoundError } from '@/core/rbac/errors';
import type { Principal } from '@/core/rbac/types';
import { nextClientRef } from '@/modules/project-management/services/client.service';
import { D } from './domain/money';
import { ensurePanelItems } from './services/selling-bridge';

/**
 * Plan 014 on native ERP: New project starts from a submitted sales order with no project.
 * The order's panel lines (item code = an active checklist template) become the project's
 * panels; its customer becomes (or links to) the PM client with the next ACS-XXXX reference.
 * Same exports as the ERPNext version, so PM's callers are unchanged.
 */

export interface WaitingOrder {
  orderName: string;
  customerName: string;
  workOrderNo: string;
  clientPoNumber: string | null;
  panelsSummary: string;
  deliveryDate: string | null;
}

export interface ProjectOrderInput {
  erpSalesOrder: string;
  erpOrderModified: string;
  client: {
    name: string;
    /** The ERP customer code (pm_clients.erpCustomer). */
    erpCustomer: string;
    customAcsReference: string | null;
  };
  workOrderNo: string;
  clientPoNumber: string | null;
  targetEndDate: string;
  scopes: Array<{ templateCode: string; quantity: number }>;
  panelDeliveryDates: Record<string, string>;
  panelOrderItems: Record<string, string>;
}

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

/** Is the "every work order starts from a sales order" rule on for this company? */
export async function projectsNeedSalesOrder(companyId: string): Promise<boolean> {
  const s = await prisma.erpSettings.findUnique({ where: { companyId }, select: { projectsFromSalesOrders: true } });
  return s?.projectsFromSalesOrders ?? false;
}

/** Our project page, for links from ERP documents. */
export function projectLink(projectId: string): string {
  return `${config().APP_URL.replace(/\/+$/, '')}/pm/projects/${projectId}`;
}

/** Records the project on the sales order. */
export async function writeProjectToOrder(orderName: string, project: { id: string; code: string; companyId?: string }) {
  await prisma.erpSalesOrder.updateMany({ where: { number: orderName, ...(project.companyId ? { companyId: project.companyId } : {}) }, data: { projectId: project.id } });
}

function assertCanCreate(principal: Principal) {
  if (!hasPermissionAnywhere(principal, 'pm.project.create')) throw new ForbiddenError('Missing permission: pm.project.create');
}

async function templateCodes() {
  return new Set((await prisma.checklistTemplate.findMany({ where: { isActive: true }, select: { code: true } })).map((t) => t.code));
}

/** Submitted, open sales orders with no project yet. Needs `pm.project.create`. */
export async function listWaitingOrders(principal: Principal): Promise<WaitingOrder[]> {
  assertCanCreate(principal);
  const orders = await prisma.erpSalesOrder.findMany({
    where: { companyId: principal.companyId, status: 'SUBMITTED', isClosed: false, isOnHold: false, projectId: null },
    orderBy: { updatedAt: 'desc' },
    include: { lines: { orderBy: { sortOrder: 'asc' } } },
  });
  if (orders.length === 0) return [];

  // Repair: an order whose project exists but was never written back.
  const linked = await prisma.project.findMany({ where: { companyId: principal.companyId, erpSalesOrder: { in: orders.map((o) => o.number) } }, select: { id: true, code: true, erpSalesOrder: true } });
  for (const project of linked) await writeProjectToOrder(project.erpSalesOrder!, { ...project, companyId: principal.companyId });
  const taken = new Set(linked.map((p) => p.erpSalesOrder));

  const [customers, items, templates] = await Promise.all([
    prisma.erpParty.findMany({ where: { id: { in: orders.map((o) => o.customerId) } }, select: { id: true, name: true } }),
    prisma.erpItem.findMany({ where: { id: { in: orders.flatMap((o) => o.lines.map((l) => l.itemId)) } }, select: { id: true, code: true } }),
    templateCodes(),
  ]);
  const customerName = new Map(customers.map((c) => [c.id, c.name]));
  const itemCode = new Map(items.map((i) => [i.id, i.code]));

  return orders
    .filter((o) => !taken.has(o.number))
    .map((o) => {
      const qty = new Map<string, number>();
      for (const l of o.lines) {
        const code = itemCode.get(l.itemId);
        if (code && templates.has(code)) qty.set(code, (qty.get(code) ?? 0) + Math.round(D(l.qty).toNumber()));
      }
      return {
        orderName: o.number,
        customerName: customerName.get(o.customerId) ?? '—',
        workOrderNo: o.woNumber ?? '',
        clientPoNumber: o.poNo,
        panelsSummary: [...qty.entries()].filter(([, q]) => q > 0).map(([c, q]) => `${q} × ${c}`).join(', '),
        deliveryDate: day(o.deliveryDate) ?? (o.lines.map((l) => day(l.deliveryDate)).filter((d): d is string => !!d).sort().at(-1) ?? null),
      };
    });
}

/** A submitted sales order as New project's input. The server reads it again on save. */
export async function getOrderForProject(principal: Principal, orderName: string): Promise<ProjectOrderInput> {
  assertCanCreate(principal);
  const number = orderName.trim();
  if (!number) throw new DomainError('Sales order name is required.');
  const order = await prisma.erpSalesOrder.findUnique({ where: { companyId_number: { companyId: principal.companyId, number } }, include: { lines: { orderBy: { sortOrder: 'asc' } } } });
  if (!order) throw new NotFoundError('Sales order not found.');

  if (order.status === 'DRAFT') throw new DomainError('Sales order is in draft. Submit it in ERP first.');
  if (order.status === 'CANCELLED') throw new DomainError('Sales order is cancelled.');
  if (order.isClosed) throw new DomainError('Sales order is closed.');
  if (order.isOnHold) throw new DomainError('Sales order is on hold.');

  const existing = await prisma.project.findFirst({ where: { companyId: principal.companyId, OR: [{ erpSalesOrder: number }, ...(order.projectId ? [{ id: order.projectId }] : [])] }, select: { code: true } });
  if (existing) throw new DomainError(`Sales order is already linked to project ${existing.code}.`);

  const wo = (order.woNumber ?? '').trim();
  if (!wo) throw new DomainError('Sales order is missing a Work Order number.');
  if (!/^\d+$/.test(wo)) throw new DomainError('Work Order number must contain only digits.');

  await ensurePanelItems(principal.companyId);
  const [templates, items, customer] = await Promise.all([
    templateCodes(),
    prisma.erpItem.findMany({ where: { id: { in: order.lines.map((l) => l.itemId) } }, select: { id: true, code: true } }),
    prisma.erpParty.findUniqueOrThrow({ where: { id: order.customerId } }),
  ]);
  const itemCode = new Map(items.map((i) => [i.id, i.code]));
  // Panel lines are those whose item is a checklist template; freight, services and spares stay commercial.
  const panels = order.lines.filter((l) => templates.has(itemCode.get(l.itemId) ?? ''));
  if (panels.length === 0) throw new DomainError('Sales order has no panel items. Panel lines use a checklist template code (PLC, SCADA, HMI…) as the item.');

  // Without an order-level date the project ends with its last panel.
  const lineDates = panels.map((l) => day(l.deliveryDate)).filter((d): d is string => !!d).sort();
  const targetEndDate = day(order.deliveryDate) ?? lineDates.at(-1) ?? null;
  if (!targetEndDate) throw new DomainError('Sales order is missing a delivery date.');

  const counter = new Map<string, number>();
  const scopes = new Map<string, number>();
  const panelDeliveryDates: Record<string, string> = {};
  const panelOrderItems: Record<string, string> = {};
  for (const l of panels) {
    const code = itemCode.get(l.itemId)!;
    const qty = Math.round(D(l.qty).toNumber());
    if (qty < 1) throw new DomainError(`Item "${code}" must have a quantity of at least 1.`);
    scopes.set(code, (scopes.get(code) ?? 0) + qty);
    for (let u = 1; u <= qty; u++) {
      const unit = (counter.get(code) ?? 0) + 1;
      counter.set(code, unit);
      panelDeliveryDates[`${code}_${unit}`] = day(l.deliveryDate) ?? targetEndDate;
      panelOrderItems[`${code}_${unit}`] = `${l.id}#${u}`;
    }
  }

  const client = customer.clientId ? await prisma.client.findUnique({ where: { id: customer.clientId }, select: { refNumber: true } }) : null;
  return {
    erpSalesOrder: order.number,
    erpOrderModified: order.updatedAt.toISOString(),
    client: { name: customer.name, erpCustomer: customer.code, customAcsReference: client?.refNumber ?? null },
    workOrderNo: wo,
    clientPoNumber: order.poNo,
    targetEndDate,
    scopes: [...scopes.entries()].map(([templateCode, quantity]) => ({ templateCode, quantity })),
    panelDeliveryDates,
    panelOrderItems,
  };
}

/**
 * The PM client for an ERP customer (lazy ACS reference, plan 014):
 * 1. the customer's linked client; 2. a client already holding the customer code;
 * 3. a client with the customer's ACS reference; 4. an unlinked client of the same name;
 * 5. a new client with the next ACS-XXXX. The customer is then linked to it.
 */
export async function resolveClientForCustomer(principal: Principal, customer: string | { name: string; custom_acs_reference?: string | null }) {
  assertCanCreate(principal);
  const key = (typeof customer === 'string' ? customer : customer.name).trim();
  if (!key) throw new DomainError('Customer name is required.');
  const party = await prisma.erpParty.findFirst({ where: { companyId: principal.companyId, kind: 'CUSTOMER', OR: [{ code: key }, { name: key }] } });
  if (!party) throw new NotFoundError('Customer not found.');
  const ref = (typeof customer === 'object' ? customer.custom_acs_reference?.trim() : null) || null;
  const companyId = principal.companyId;

  let client =
    (party.clientId ? await prisma.client.findFirst({ where: { id: party.clientId, companyId } }) : null) ??
    (await prisma.client.findFirst({ where: { companyId, erpCustomer: party.code } })) ??
    (ref ? await prisma.client.findFirst({ where: { companyId, refNumber: ref } }) : null) ??
    (await prisma.client.findFirst({ where: { companyId, name: party.name, erpCustomer: null } }));

  if (!client) {
    try {
      const refNumber = await nextClientRef(companyId);
      client = await prisma.client.create({ data: { companyId, name: party.name, refNumber, erpCustomer: party.code, isActive: true } });
      await audit({ actorId: principal.userId, module: 'pm', action: 'client.created', entityType: 'Client', entityId: client.id, diff: { name: party.name, refNumber, erpCustomer: party.code } });
    } catch (err) {
      // Two people picking orders of the same new customer at once: the unique index keeps one.
      if ((err as { code?: string })?.code !== 'P2002') throw err;
      client = await prisma.client.findFirst({ where: { companyId, OR: [{ erpCustomer: party.code }, { name: party.name }] } });
      if (!client) throw err;
    }
  }
  if (client.erpCustomer !== party.code) {
    client = await prisma.client.update({ where: { id: client.id }, data: { erpCustomer: party.code } }).catch(() => client!);
  }
  if (party.clientId !== client.id) await prisma.erpParty.update({ where: { id: party.id }, data: { clientId: client.id } });
  return client;
}
