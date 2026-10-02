import { prisma } from '@/core/db/prisma';
import { hasPermissionAnywhere } from '@/core/rbac/engine';
import { DomainError, ForbiddenError, NotFoundError } from '@/core/rbac/errors';
import type { Principal } from '@/core/rbac/types';
import { audit } from '@/core/audit/audit';
import { nextClientRef } from '@/modules/project-management/services/client.service';
import { erpGet, erpList, erpUpdate } from './client';

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
    erpCustomer: string;
    customAcsReference: string | null;
  };
  workOrderNo: string;
  clientPoNumber: string | null;
  targetEndDate: string;
  scopes: Array<{
    templateCode: string;
    quantity: number;
  }>;
  panelDeliveryDates: Record<string, string>;
  panelOrderItems: Record<string, string>;
}

interface ErpSalesOrderRow {
  name: string;
  customer: string;
  custom_wo_number?: string;
  po_no?: string;
  delivery_date?: string;
  custom_project_code?: string;
  status?: string;
  modified?: string;
}

interface ErpSalesOrderItem {
  name: string;
  item_code: string;
  qty: number;
  delivery_date?: string;
}

interface ErpSalesOrderDoc extends ErpSalesOrderRow {
  docstatus: number;
  items?: ErpSalesOrderItem[];
}

interface ErpCustomerDoc {
  name: string;
  custom_acs_reference?: string;
}

/**
 * List submitted ERPNext sales orders waiting to become an Engineering OS project.
 * Needs `pm.project.create`.
 */
export async function listWaitingOrders(principal: Principal): Promise<WaitingOrder[]> {
  if (!hasPermissionAnywhere(principal, 'pm.project.create')) {
    throw new ForbiddenError('Missing permission: pm.project.create');
  }

  const orders = await erpList<ErpSalesOrderRow>('Sales Order', {
    filters: [
      ['Sales Order', 'docstatus', '=', 1],
      ['Sales Order', 'custom_project_code', 'is', 'not set'],
      ['Sales Order', 'status', 'not in', ['Closed', 'Completed', 'Cancelled', 'On Hold']],
    ],
    fields: [
      'name',
      'customer',
      'custom_wo_number',
      'po_no',
      'delivery_date',
      'custom_project_code',
      'status',
      'modified',
    ],
    limit: 0,
    orderBy: 'modified desc',
  });

  const openUnlinked = orders.filter((o) => {
    const status = (o.status || '').toLowerCase();
    if (
      status === 'closed' ||
      status === 'completed' ||
      status === 'cancelled' ||
      status === 'on hold'
    ) {
      return false;
    }
    if (o.custom_project_code && o.custom_project_code.trim() !== '') return false;
    return true;
  });

  if (openUnlinked.length === 0) {
    return [];
  }

  const candidateNames = openUnlinked.map((o) => o.name);
  const existingProjects = await prisma.project.findMany({
    where: {
      companyId: principal.companyId,
      erpSalesOrder: { in: candidateNames },
    },
    select: { erpSalesOrder: true },
  });
  const existingOrderNames = new Set(existingProjects.map((p) => p.erpSalesOrder).filter(Boolean));

  const waitingCandidates = openUnlinked.filter((o) => !existingOrderNames.has(o.name));
  if (waitingCandidates.length === 0) {
    return [];
  }

  const detailed = await Promise.all(
    waitingCandidates.map(async (candidate) => {
      const fullDoc = await erpGet<ErpSalesOrderDoc>('Sales Order', candidate.name);
      return { candidate, items: fullDoc.items ?? [] };
    }),
  );

  return detailed.map(({ candidate, items }) => {
    const qtyByCode = new Map<string, number>();
    for (const item of items) {
      if (item.item_code) {
        const current = qtyByCode.get(item.item_code) ?? 0;
        qtyByCode.set(item.item_code, current + Math.round(Number(item.qty) || 0));
      }
    }
    const summaryParts: string[] = [];
    for (const [code, qty] of qtyByCode.entries()) {
      if (qty > 0) {
        summaryParts.push(`${qty} × ${code}`);
      }
    }

    return {
      orderName: candidate.name,
      customerName: candidate.customer,
      workOrderNo: (candidate.custom_wo_number ?? '').trim(),
      clientPoNumber: candidate.po_no?.trim() || null,
      panelsSummary: summaryParts.join(', '),
      deliveryDate: candidate.delivery_date || null,
    };
  });
}

/**
 * Fetch and validate an ERP sales order as our project input shape.
 * Needs `pm.project.create`.
 */
export async function getOrderForProject(
  principal: Principal,
  orderName: string,
): Promise<ProjectOrderInput> {
  if (!hasPermissionAnywhere(principal, 'pm.project.create')) {
    throw new ForbiddenError('Missing permission: pm.project.create');
  }

  const trimmedOrderName = orderName.trim();
  if (!trimmedOrderName) {
    throw new DomainError('Sales order name is required.');
  }

  const order = await erpGet<ErpSalesOrderDoc>('Sales Order', trimmedOrderName);

  // 1. Refuse: draft, cancelled, closed, completed, or on hold order
  const statusLower = (order.status || '').toLowerCase();
  if (order.docstatus === 0 || statusLower === 'draft') {
    throw new DomainError('Sales order is in draft. Submit it in ERP first.');
  }
  if (order.docstatus === 2 || statusLower === 'cancelled') {
    throw new DomainError('Sales order is cancelled.');
  }
  if (statusLower === 'closed') {
    throw new DomainError('Sales order is closed.');
  }
  if (statusLower === 'completed') {
    throw new DomainError('Sales order is completed.');
  }
  if (statusLower === 'on hold') {
    throw new DomainError('Sales order is on hold.');
  }

  // 2. Refuse: order that already has a project
  if (order.custom_project_code && order.custom_project_code.trim() !== '') {
    throw new DomainError(`Sales order is already linked to project ${order.custom_project_code.trim()}.`);
  }

  const existingProject = await prisma.project.findFirst({
    where: {
      companyId: principal.companyId,
      erpSalesOrder: trimmedOrderName,
    },
    select: { code: true },
  });
  if (existingProject) {
    throw new DomainError(`Sales order is already linked to project ${existingProject.code}.`);
  }

  // 3. Refuse: missing or non-digit WO number
  const wo = (order.custom_wo_number ?? '').trim();
  if (!wo) {
    throw new DomainError('Sales order is missing a Work Order number.');
  }
  if (!/^\d+$/.test(wo)) {
    throw new DomainError('Work Order number must contain only digits.');
  }

  // 4. Refuse: items check against active checklist templates
  const items = order.items ?? [];
  if (items.length === 0) {
    throw new DomainError('Sales order has no panel items.');
  }

  const activeTemplates = await prisma.checklistTemplate.findMany({
    where: { isActive: true },
    select: { code: true },
  });
  const validTemplateCodes = new Set(activeTemplates.map((t) => t.code));

  for (const item of items) {
    if (!validTemplateCodes.has(item.item_code)) {
      throw new DomainError(`Item "${item.item_code}" is not an active checklist template.`);
    }
    const qty = Math.round(Number(item.qty) || 0);
    if (qty < 1) {
      throw new DomainError(`Item "${item.item_code}" must have a quantity of at least 1.`);
    }
  }

  // 5. Delivery date check
  const targetEndDate = order.delivery_date?.trim() || items[0]?.delivery_date?.trim();
  if (!targetEndDate) {
    throw new DomainError('Sales order is missing a delivery date.');
  }

  // 6. Fetch customer to resolve custom_acs_reference
  let customAcsReference: string | null = null;
  if (order.customer) {
    try {
      const customerDoc = await erpGet<ErpCustomerDoc>('Customer', order.customer);
      customAcsReference = customerDoc.custom_acs_reference?.trim() || null;
    } catch (err) {
      if (!(err instanceof NotFoundError)) throw err;
    }
  }

  // 7. Panel scopes and per-unit delivery dates and erpOrderItem mapping
  const codeUnitCounters = new Map<string, number>();
  const scopesMap = new Map<string, number>();
  const panelDeliveryDates: Record<string, string> = {};
  const panelOrderItems: Record<string, string> = {};

  for (const item of items) {
    const code = item.item_code;
    const qty = Math.round(Number(item.qty) || 0);
    scopesMap.set(code, (scopesMap.get(code) ?? 0) + qty);

    for (let u = 1; u <= qty; u++) {
      const overallUnit = (codeUnitCounters.get(code) ?? 0) + 1;
      codeUnitCounters.set(code, overallUnit);

      const panelKey = `${code}_${overallUnit}`;
      panelDeliveryDates[panelKey] = item.delivery_date?.trim() || targetEndDate;
      panelOrderItems[panelKey] = `${item.name}#${u}`;
    }
  }

  const scopes = Array.from(scopesMap.entries()).map(([templateCode, quantity]) => ({
    templateCode,
    quantity,
  }));

  return {
    erpSalesOrder: order.name,
    erpOrderModified: order.modified || '',
    client: {
      name: order.customer,
      erpCustomer: order.customer,
      customAcsReference,
    },
    workOrderNo: wo,
    clientPoNumber: order.po_no?.trim() || null,
    targetEndDate,
    scopes,
    panelDeliveryDates,
    panelOrderItems,
  };
}

/**
 * Resolve or lazily create a client from an ERPNext Customer.
 * 1. Find our client by erpCustomer.
 * 2. Otherwise, if customer's custom_acs_reference matches a client's refNumber, link that client.
 * 3. Otherwise, if an existing unlinked client of the same name exists, link that client.
 * 4. Otherwise create a client named after the customer with nextClientRef.
 * Then write custom_acs_reference back to the ERPNext customer if it's empty.
 */
export async function resolveClientForCustomer(
  principal: Principal,
  customer: string | { name: string; custom_acs_reference?: string | null },
) {
  if (!hasPermissionAnywhere(principal, 'pm.project.create')) {
    throw new ForbiddenError('Missing permission: pm.project.create');
  }

  const customerName = typeof customer === 'string' ? customer.trim() : customer.name.trim();
  if (!customerName) {
    throw new DomainError('Customer name is required.');
  }

  let customAcsRef: string | null = null;
  let displayName = customerName;

  if (typeof customer === 'object' && customer.custom_acs_reference !== undefined) {
    customAcsRef = customer.custom_acs_reference?.trim() || null;
  } else {
    try {
      const customerDoc = await erpGet<ErpCustomerDoc>('Customer', customerName);
      customAcsRef = customerDoc.custom_acs_reference?.trim() || null;
      if (customerDoc.name && customerDoc.name !== customerName) {
        // if customerDoc has specific name
      }
    } catch (err) {
      if (!(err instanceof NotFoundError)) throw err;
    }
  }

  // 1. Find our client by erpCustomer
  let client = await prisma.client.findFirst({
    where: { companyId: principal.companyId, erpCustomer: customerName },
  });

  // 2. Otherwise, if customer's custom_acs_reference matches a client's refNumber, link that client
  if (!client && customAcsRef) {
    const byRef = await prisma.client.findFirst({
      where: { companyId: principal.companyId, refNumber: customAcsRef },
    });
    if (byRef) {
      client = await prisma.client.update({
        where: { id: byRef.id },
        data: { erpCustomer: customerName },
      });
    }
  }

  // 3. Name clash with an existing unlinked client of the same name links that client instead of failing
  if (!client) {
    const byName = await prisma.client.findFirst({
      where: { companyId: principal.companyId, name: displayName },
    });
    if (byName) {
      client = await prisma.client.update({
        where: { id: byName.id },
        data: { erpCustomer: customerName },
      });
    }
  }

  // 4. Otherwise create a client named after the customer with nextClientRef
  if (!client) {
    const nextRef = await nextClientRef(principal.companyId);
    try {
      client = await prisma.client.create({
        data: {
          companyId: principal.companyId,
          name: displayName,
          refNumber: nextRef,
          erpCustomer: customerName,
          isActive: true,
        },
      });

      await audit({
        actorId: principal.userId,
        module: 'pm',
        action: 'client.created',
        entityType: 'Client',
        entityId: client.id,
        diff: { name: displayName, refNumber: nextRef, erpCustomer: customerName },
      });
    } catch (err: any) {
      // Concurrency handling: two Directors picking orders of the same new customer at the same time
      if (err?.code === 'P2002') {
        client = await prisma.client.findFirst({
          where: {
            companyId: principal.companyId,
            OR: [{ erpCustomer: customerName }, { name: displayName }],
          },
        });
        if (client && !client.erpCustomer) {
          client = await prisma.client.update({
            where: { id: client.id },
            data: { erpCustomer: customerName },
          });
        }
      }
      if (!client) throw err;
    }
  }

  // Write custom_acs_reference back to the ERPNext customer if it's empty
  if (!customAcsRef) {
    try {
      await erpUpdate('Customer', customerName, {
        custom_acs_reference: client.refNumber,
      });
    } catch (err) {
      console.error('[erp] failed to write custom_acs_reference back to Customer', {
        customer: customerName,
        refNumber: client.refNumber,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return client;
}

