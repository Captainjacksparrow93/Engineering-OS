import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import { prisma } from '@/core/db/prisma';
import { loadPrincipal } from '@/core/rbac/principal';
import { DomainError, ForbiddenError } from '@/core/rbac/errors';
import { config } from '@/core/config';
import { erpGet, erpList, erpUpdate, isErpEnabled } from './client';
import { listWaitingOrders } from './order.service';
import {
  createAutomationProject,
  getPMTeamData,
} from '@/modules/project-management/services/automation-project.service';
import type { Principal } from '@/core/rbac/types';

vi.mock('@/modules/erp/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/modules/erp/client')>();
  return {
    ...actual,
    isErpEnabled: vi.fn(() => true),
    erpGet: vi.fn(),
    erpList: vi.fn(),
    erpUpdate: vi.fn(),
  };
});

function isoInDays(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

describe('Plan 014 step 5: create the project from the sales order', () => {
  let director: Principal;
  let engineer: Principal;
  let pmId: string;
  let unlinkedClient: { id: string; name: string; refNumber: string };
  const run = `${Date.now()}`.slice(-6);
  const createdProjectIds: string[] = [];
  const customerNames: string[] = [];

  /** Mocks ERPNext with one submitted order (2 × PLC on two rows with different dates) of a new customer. */
  function mockOrder(orderName: string, customer: string, wo: string) {
    customerNames.push(customer);
    const order = {
      name: orderName,
      customer,
      docstatus: 1,
      status: 'To Deliver and Bill',
      custom_wo_number: wo,
      custom_project_code: '',
      po_no: 'PO-CLIENT-77',
      delivery_date: isoInDays(150),
      modified: '2026-10-02 10:15:00.123456',
      items: [
        { name: 'rowA', item_code: 'PLC', qty: 1, delivery_date: isoInDays(120) },
        { name: 'rowB', item_code: 'PLC', qty: 1, delivery_date: isoInDays(150) },
      ],
    };
    vi.mocked(erpGet).mockImplementation(async (doctype: string, name: string) => {
      if (doctype === 'Sales Order' && name === orderName) return order;
      if (doctype === 'Customer' && name === customer) return { name: customer, custom_acs_reference: '' };
      throw new Error(`unexpected erpGet ${doctype} ${name}`);
    });
    return order;
  }

  beforeAll(async () => {
    const acs = await prisma.company.findFirst({ where: { code: 'ACS' } });
    const directorUser = await prisma.user.findFirst({
      where: { companyId: acs?.id, status: 'ACTIVE', roleAssignments: { some: { role: { key: 'DIRECTOR' } } } },
    });
    director = (await loadPrincipal(directorUser!.id))!;
    const engineerUser = await prisma.user.findFirst({ where: { employeeCode: 'ACS-0065' } });
    engineer = (await loadPrincipal(engineerUser!.id))!;
    const { managers } = await getPMTeamData(director.companyId);
    pmId = managers[0]!.id;
    unlinkedClient = await prisma.client.create({
      data: { companyId: director.companyId, name: `Typed Client ${run}`, refNumber: `ACS-T5-${run}` },
    });
  });

  beforeEach(() => {
    vi.mocked(isErpEnabled).mockReturnValue(true);
    vi.mocked(erpGet).mockReset();
    vi.mocked(erpList).mockReset();
    vi.mocked(erpUpdate).mockReset();
    vi.mocked(erpUpdate).mockResolvedValue({});
  });

  afterAll(async () => {
    for (const projectId of createdProjectIds) {
      await prisma.taskDependency.deleteMany({ where: { predecessor: { projectId } } });
      await prisma.taskAssignment.deleteMany({ where: { task: { projectId } } });
      await prisma.task.deleteMany({ where: { projectId, parentId: { not: null } } });
      await prisma.task.deleteMany({ where: { projectId } });
      await prisma.projectMember.deleteMany({ where: { projectId } });
      await prisma.roleAssignment.deleteMany({ where: { scopeType: 'PROJECT', scopeId: projectId } });
      await prisma.project.delete({ where: { id: projectId } });
    }
    await prisma.client.deleteMany({
      where: { OR: [{ id: unlinkedClient.id }, { erpCustomer: { in: customerNames } }] },
    });
  });

  it('ERP off: a work order without a sales order is created as today', async () => {
    vi.mocked(isErpEnabled).mockReturnValue(false);
    const project = await createAutomationProject(director, {
      kind: 'WORK_ORDER',
      workOrderNo: `51${run}`,
      clientId: unlinkedClient.id,
      clientName: unlinkedClient.name,
      managerId: pmId,
      targetEndDate: isoInDays(150),
      scopes: [{ templateCode: 'PLC', quantity: 1 }],
    });
    createdProjectIds.push(project.id);
    expect(project.workOrderNo).toBe(`51${run}`);
    expect(project.erpSalesOrder).toBeNull();
    expect(erpGet).not.toHaveBeenCalled();
    expect(erpUpdate).not.toHaveBeenCalled();
  });

  it('ERP on: a work order without a sales order is refused; a service call is not', async () => {
    await expect(
      createAutomationProject(director, {
        kind: 'WORK_ORDER',
        workOrderNo: `52${run}`,
        clientId: unlinkedClient.id,
        clientName: unlinkedClient.name,
        managerId: pmId,
        scopes: [{ templateCode: 'PLC', quantity: 1 }],
      }),
    ).rejects.toThrow('Pick a sales order first.');

    const serviceCall = await createAutomationProject(director, {
      kind: 'SERVICE_CALL',
      clientId: unlinkedClient.id,
      clientName: unlinkedClient.name,
      managerId: pmId,
      scopes: [],
      tasks: [],
    });
    createdProjectIds.push(serviceCall.id);
    expect(serviceCall.kind).toBe('SERVICE_CALL');
  });

  it('denies a user without pm.project.create', async () => {
    mockOrder(`SO-T5-DENY-${run}`, `Deny Customer ${run}`, `53${run}`);
    await expect(
      createAutomationProject(engineer, { salesOrder: `SO-T5-DENY-${run}`, managerId: pmId }),
    ).rejects.toThrow(ForbiddenError);
  });

  it('happy path: the order wins over the browser, links are stored, and the order gets the project code and link', async () => {
    const orderName = `SO-T5-OK-${run}`;
    const customer = `New Customer ${run}`;
    const order = mockOrder(orderName, customer, `54${run}`);

    const project = await createAutomationProject(director, {
      kind: 'WORK_ORDER',
      salesOrder: orderName,
      managerId: pmId,
      // Everything below comes from the browser and must be ignored.
      workOrderNo: '999999',
      clientId: unlinkedClient.id,
      clientName: unlinkedClient.name,
      clientRefNumber: unlinkedClient.refNumber,
      targetEndDate: isoInDays(400),
      scopes: [{ templateCode: 'HMI', quantity: 3 }],
      panelDeliveryDates: { HMI_1: isoInDays(300) },
      tasks: [{ templateCode: 'HMI', unitIndex: 1, stepNumber: 1, title: 'x', assigneeId: engineer.userId }],
    });
    createdProjectIds.push(project.id);

    expect(project.workOrderNo).toBe(order.custom_wo_number);
    expect(project.erpSalesOrder).toBe(orderName);
    expect(project.clientPoNumber).toBe('PO-CLIENT-77');
    expect(project.erpOrderModified).toBe('2026-10-02 10:15:00.123456');
    expect(project.targetEndDate?.toISOString().slice(0, 10)).toBe(order.delivery_date);
    expect(project.automationTypes).toEqual(['PLC']);

    const client = await prisma.client.findUniqueOrThrow({ where: { id: project.clientId! } });
    expect(client.erpCustomer).toBe(customer);
    expect(client.id).not.toBe(unlinkedClient.id);
    expect(project.clientName).toBe(customer);
    expect(project.code.startsWith(client.refNumber)).toBe(true);

    const phases = await prisma.task.findMany({
      where: { projectId: project.id, type: 'PHASE' },
      orderBy: { title: 'asc' },
    });
    expect(phases.map((p) => p.title)).toEqual(['PLC Panel 1', 'PLC Panel 2']);
    expect(phases.map((p) => p.erpOrderItem)).toEqual(['rowA#1', 'rowB#1']);
    expect(phases.map((p) => p.plannedEnd?.toISOString().slice(0, 10))).toEqual([
      order.items[0]!.delivery_date,
      order.items[1]!.delivery_date,
    ]);

    // The ignored HMI draft added nobody to the project.
    const members = await prisma.projectMember.findMany({ where: { projectId: project.id } });
    expect(members.map((m) => m.userId)).toEqual([pmId]);

    expect(erpUpdate).toHaveBeenCalledWith('Sales Order', orderName, {
      custom_project_code: project.code,
      custom_project_link: `${config().APP_URL.replace(/\/+$/, '')}/pm/projects/${project.id}`,
    });

    const created = await prisma.auditLog.findFirst({
      where: { module: 'pm', action: 'project.created', entityId: project.id },
    });
    expect(created?.diff).toMatchObject({ erpSalesOrder: orderName, workOrderNo: order.custom_wo_number });
  });

  it('refuses an order already taken by a parallel request', async () => {
    const orderName = `SO-T5-RACE-${run}`;
    mockOrder(orderName, `Race Customer ${run}`, `55${run}`);
    const input = { kind: 'WORK_ORDER' as const, salesOrder: orderName, managerId: pmId };

    const results = await Promise.allSettled([
      createAutomationProject(director, input),
      createAutomationProject(director, input),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    for (const r of ok) createdProjectIds.push((r as PromiseFulfilledResult<{ id: string }>).value.id);

    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0]!.reason).toBeInstanceOf(DomainError);
    expect(await prisma.project.count({ where: { erpSalesOrder: orderName } })).toBe(1);
  });

  it('keeps the project when the write-back fails, audits it, and the waiting list repairs it', async () => {
    const orderName = `SO-T5-WB-${run}`;
    const order = mockOrder(orderName, `Writeback Customer ${run}`, `56${run}`);
    vi.mocked(erpUpdate).mockImplementation(async (doctype: string) => {
      if (doctype === 'Sales Order') throw new DomainError("ERP isn't responding. Try again in a minute.");
      return {};
    });

    const project = await createAutomationProject(director, { salesOrder: orderName, managerId: pmId });
    createdProjectIds.push(project.id);
    expect(project.erpSalesOrder).toBe(orderName);

    const failure = await prisma.auditLog.findFirst({
      where: { module: 'erp', action: 'writeback_failed', entityId: project.id },
    });
    expect(failure?.diff).toMatchObject({ erpSalesOrder: orderName });

    // ERPNext still shows the order without a project; the waiting list writes it again and hides it.
    vi.mocked(erpUpdate).mockReset();
    vi.mocked(erpUpdate).mockResolvedValue({});
    vi.mocked(erpList).mockResolvedValueOnce([{ ...order, items: undefined }]);

    const waiting = await listWaitingOrders(director);
    expect(waiting.map((w) => w.orderName)).not.toContain(orderName);
    expect(erpUpdate).toHaveBeenCalledWith('Sales Order', orderName, {
      custom_project_code: project.code,
      custom_project_link: `${config().APP_URL.replace(/\/+$/, '')}/pm/projects/${project.id}`,
    });
  });

  it('asks to fix dates in ERP when the order is too tight', async () => {
    const orderName = `SO-T5-TIGHT-${run}`;
    const order = mockOrder(orderName, `Tight Customer ${run}`, `57${run}`);
    order.delivery_date = isoInDays(2);
    order.items[0]!.delivery_date = isoInDays(2);
    order.items[1]!.delivery_date = isoInDays(2);

    await expect(
      createAutomationProject(director, { salesOrder: orderName, managerId: pmId }),
    ).rejects.toThrow(/Change the dates on the sales order in ERP\.$/);
    expect(await prisma.project.count({ where: { erpSalesOrder: orderName } })).toBe(0);
  });
});
