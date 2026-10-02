import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prisma } from '@/core/db/prisma';
import { loadPrincipal } from '@/core/rbac/principal';
import { DomainError, ForbiddenError } from '@/core/rbac/errors';
import { erpGet, erpList, erpUpdate } from './client';
import { listWaitingOrders, getOrderForProject, resolveClientForCustomer } from './order.service';
import type { Principal } from '@/core/rbac/types';

vi.mock('@/modules/erp/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/modules/erp/client')>();
  return {
    ...actual,
    erpGet: vi.fn(),
    erpList: vi.fn(),
    erpUpdate: vi.fn(),
  };
});

describe('ERP Order Service Integration Tests (Plan 014 Step 3)', () => {
  let directorPrincipal: Principal;
  let engineerPrincipal: Principal;

  beforeEach(async () => {
    vi.clearAllMocks();

    const directorUser = await prisma.user.findFirst({
      where: { roleAssignments: { some: { role: { key: 'DIRECTOR' } } } },
    });
    expect(directorUser).not.toBeNull();
    directorPrincipal = (await loadPrincipal(directorUser!.id))!;

    const engineerUser = await prisma.user.findFirst({
      where: { employeeCode: 'ACS-0065' }, // Sahil Patil (Junior Engineer)
    });
    expect(engineerUser).not.toBeNull();
    engineerPrincipal = (await loadPrincipal(engineerUser!.id))!;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Permissions (pm.project.create)', () => {
    it('denies listWaitingOrders for an engineer without pm.project.create', async () => {
      await expect(listWaitingOrders(engineerPrincipal)).rejects.toThrow(ForbiddenError);
    });

    it('denies getOrderForProject for an engineer without pm.project.create', async () => {
      await expect(getOrderForProject(engineerPrincipal, 'SAL-ORD-2026-00001')).rejects.toThrow(ForbiddenError);
    });
  });

  describe('listWaitingOrders', () => {
    it('returns submitted, open orders without custom_project_code and not already linked in PM, newest first', async () => {
      // Create a test project in DB that is already linked to an order
      const existingProject = await prisma.project.create({
        data: {
          companyId: directorPrincipal.companyId,
          code: `TEST-ORD-${Date.now()}`,
          name: 'Already Linked Project',
          clientName: 'Existing Client',
          erpSalesOrder: 'SAL-ORD-ALREADY-LINKED',
          managerId: directorPrincipal.userId,
        },
      });

      try {
        vi.mocked(erpList).mockResolvedValueOnce([
          {
            name: 'SAL-ORD-003',
            customer: 'Beta Industries',
            custom_wo_number: '3001',
            po_no: 'PO-BETA-01',
            delivery_date: '2026-12-10',
            custom_project_code: '',
            status: 'To Deliver',
            modified: '2026-10-02 12:00:00',
          },
          {
            name: 'SAL-ORD-ALREADY-LINKED',
            customer: 'Existing Client',
            custom_wo_number: '2001',
            po_no: 'PO-EX-01',
            delivery_date: '2026-12-05',
            custom_project_code: '',
            status: 'To Deliver',
            modified: '2026-10-02 11:30:00',
          },
          {
            name: 'SAL-ORD-WITH-ERP-CODE',
            customer: 'Gamma Corp',
            custom_wo_number: '2002',
            po_no: 'PO-GA-01',
            delivery_date: '2026-12-01',
            custom_project_code: 'ACS-0002-1',
            status: 'To Deliver',
            modified: '2026-10-02 11:00:00',
          },
          {
            name: 'SAL-ORD-CLOSED',
            customer: 'Delta Ltd',
            custom_wo_number: '2003',
            po_no: 'PO-DE-01',
            delivery_date: '2026-11-20',
            custom_project_code: '',
            status: 'Closed',
            modified: '2026-10-02 10:00:00',
          },
          {
            name: 'SAL-ORD-001',
            customer: 'Alpha Corp',
            custom_wo_number: '1001',
            po_no: 'PO-ALPHA-01',
            delivery_date: '2026-11-15',
            custom_project_code: '',
            status: 'To Deliver and Bill',
            modified: '2026-10-01 09:00:00',
          },
        ]);

        // Mock erpGet for SAL-ORD-003 and SAL-ORD-001
        vi.mocked(erpGet).mockImplementation(async (doctype: string, name: string) => {
          if (doctype === 'Sales Order' && name === 'SAL-ORD-003') {
            return {
              name: 'SAL-ORD-003',
              customer: 'Beta Industries',
              items: [
                { name: 'row_1', item_code: 'PLC', qty: 2, delivery_date: '2026-12-10' },
                { name: 'row_2', item_code: 'SCADA', qty: 1, delivery_date: '2026-12-10' },
              ],
            } as any;
          }
          if (doctype === 'Sales Order' && name === 'SAL-ORD-001') {
            return {
              name: 'SAL-ORD-001',
              customer: 'Alpha Corp',
              items: [
                { name: 'row_3', item_code: 'HMI', qty: 1, delivery_date: '2026-11-15' },
              ],
            } as any;
          }
          throw new Error(`Unexpected erpGet call for ${doctype} ${name}`);
        });

        const waiting = await listWaitingOrders(directorPrincipal);

        expect(erpList).toHaveBeenCalledWith('Sales Order', {
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

        expect(waiting).toHaveLength(2);
        expect(waiting[0]).toEqual({
          orderName: 'SAL-ORD-003',
          customerName: 'Beta Industries',
          workOrderNo: '3001',
          clientPoNumber: 'PO-BETA-01',
          panelsSummary: '2 × PLC, 1 × SCADA',
          deliveryDate: '2026-12-10',
        });
        expect(waiting[1]).toEqual({
          orderName: 'SAL-ORD-001',
          customerName: 'Alpha Corp',
          workOrderNo: '1001',
          clientPoNumber: 'PO-ALPHA-01',
          panelsSummary: '1 × HMI',
          deliveryDate: '2026-11-15',
        });
      } finally {
        await prisma.project.delete({ where: { id: existingProject.id } });
      }
    });

    it('lists waiting orders even when there are more than 20 orders and the waiting one is the oldest', async () => {
      // Generate 25 orders: orders 1..24 already linked in PM, order 25 is unlinked waiting order
      const mockOrders = Array.from({ length: 25 }, (_, i) => ({
        name: `SAL-ORD-BATCH-${String(i + 1).padStart(3, '0')}`,
        customer: `Customer ${i + 1}`,
        custom_wo_number: `${4000 + i}`,
        po_no: `PO-${i + 1}`,
        delivery_date: '2026-12-31',
        custom_project_code: '',
        status: 'To Deliver',
        modified: `2026-10-02 12:${String(50 - i).padStart(2, '0')}:00`,
      }));

      // Pre-link orders 1..24 in DB
      const existingProjects = await Promise.all(
        mockOrders.slice(0, 24).map((o, idx) =>
          prisma.project.create({
            data: {
              companyId: directorPrincipal.companyId,
              code: `TEST-BATCH-${Date.now()}-${idx}`,
              name: `Project for ${o.name}`,
              clientName: o.customer,
              erpSalesOrder: o.name,
              managerId: directorPrincipal.userId,
            },
          }),
        ),
      );

      try {
        vi.mocked(erpList).mockResolvedValueOnce(mockOrders);

        // erpGet is only called for the 1 waiting candidate (SAL-ORD-BATCH-025)
        vi.mocked(erpGet).mockResolvedValueOnce({
          name: 'SAL-ORD-BATCH-025',
          customer: 'Customer 25',
          items: [{ name: 'row_25', item_code: 'PLC', qty: 3, delivery_date: '2026-12-31' }],
        } as any);

        const waiting = await listWaitingOrders(directorPrincipal);

        expect(waiting).toHaveLength(1);
        expect(waiting[0].orderName).toBe('SAL-ORD-BATCH-025');
        expect(waiting[0].panelsSummary).toBe('3 × PLC');
      } finally {
        await prisma.project.deleteMany({
          where: { id: { in: existingProjects.map((p) => p.id) } },
        });
      }
    });
  });

  describe('getOrderForProject', () => {
    it('returns the order as structured input shape on the happy path', async () => {
      vi.mocked(erpGet).mockImplementation(async (doctype: string, name: string) => {
        if (doctype === 'Sales Order' && name === 'SAL-ORD-2026-HAPPY') {
          return {
            name: 'SAL-ORD-2026-HAPPY',
            customer: 'Reliance Power',
            custom_wo_number: '5566',
            po_no: 'PO-REL-2026-99',
            delivery_date: '2026-12-25',
            docstatus: 1,
            status: 'To Deliver',
            custom_project_code: '',
            modified: '2026-10-02 14:00:00.123456',
            items: [
              { name: 'item_row_1', item_code: 'PLC', qty: 2, delivery_date: '2026-12-20' },
              { name: 'item_row_2', item_code: 'SCADA', qty: 1, delivery_date: '2026-12-25' },
              { name: 'item_row_3', item_code: 'PLC', qty: 1, delivery_date: '2026-12-22' },
            ],
          } as any;
        }
        if (doctype === 'Customer' && name === 'Reliance Power') {
          return {
            name: 'Reliance Power',
            custom_acs_reference: 'ACS-0088',
          } as any;
        }
        throw new Error(`Unexpected erpGet for ${doctype} ${name}`);
      });

      const orderInput = await getOrderForProject(directorPrincipal, 'SAL-ORD-2026-HAPPY');

      expect(orderInput).toEqual({
        erpSalesOrder: 'SAL-ORD-2026-HAPPY',
        erpOrderModified: '2026-10-02 14:00:00.123456',
        client: {
          name: 'Reliance Power',
          erpCustomer: 'Reliance Power',
          customAcsReference: 'ACS-0088',
        },
        workOrderNo: '5566',
        clientPoNumber: 'PO-REL-2026-99',
        targetEndDate: '2026-12-25',
        scopes: [
          { templateCode: 'PLC', quantity: 3 },
          { templateCode: 'SCADA', quantity: 1 },
        ],
        panelDeliveryDates: {
          PLC_1: '2026-12-20',
          PLC_2: '2026-12-20',
          SCADA_1: '2026-12-25',
          PLC_3: '2026-12-22',
        },
        panelOrderItems: {
          PLC_1: 'item_row_1#1',
          PLC_2: 'item_row_1#2',
          SCADA_1: 'item_row_2#1',
          PLC_3: 'item_row_3#1',
        },
      });
    });

    it('refuses a draft order', async () => {
      vi.mocked(erpGet).mockResolvedValueOnce({
        name: 'SAL-ORD-DRAFT',
        customer: 'Acme',
        custom_wo_number: '1234',
        docstatus: 0,
        status: 'Draft',
        modified: '2026-10-02 12:00:00',
        items: [{ name: 'r1', item_code: 'PLC', qty: 1 }],
      } as any);

      await expect(getOrderForProject(directorPrincipal, 'SAL-ORD-DRAFT')).rejects.toThrow(
        new DomainError('Sales order is in draft. Submit it in ERP first.'),
      );
    });

    it('refuses a cancelled order', async () => {
      vi.mocked(erpGet).mockResolvedValueOnce({
        name: 'SAL-ORD-CANCELLED',
        customer: 'Acme',
        custom_wo_number: '1234',
        docstatus: 2,
        status: 'Cancelled',
        modified: '2026-10-02 12:00:00',
        items: [{ name: 'r1', item_code: 'PLC', qty: 1 }],
      } as any);

      await expect(getOrderForProject(directorPrincipal, 'SAL-ORD-CANCELLED')).rejects.toThrow(
        new DomainError('Sales order is cancelled.'),
      );
    });

    it('refuses a closed order', async () => {
      vi.mocked(erpGet).mockResolvedValueOnce({
        name: 'SAL-ORD-CLOSED',
        customer: 'Acme',
        custom_wo_number: '1234',
        docstatus: 1,
        status: 'Closed',
        modified: '2026-10-02 12:00:00',
        items: [{ name: 'r1', item_code: 'PLC', qty: 1 }],
      } as any);

      await expect(getOrderForProject(directorPrincipal, 'SAL-ORD-CLOSED')).rejects.toThrow(
        new DomainError('Sales order is closed.'),
      );
    });

    it('refuses an on-hold order', async () => {
      vi.mocked(erpGet).mockResolvedValueOnce({
        name: 'SAL-ORD-ON-HOLD',
        customer: 'Acme',
        custom_wo_number: '1234',
        docstatus: 1,
        status: 'On Hold',
        modified: '2026-10-02 12:00:00',
        items: [{ name: 'r1', item_code: 'PLC', qty: 1 }],
      } as any);

      await expect(getOrderForProject(directorPrincipal, 'SAL-ORD-ON-HOLD')).rejects.toThrow(
        new DomainError('Sales order is on hold.'),
      );
    });

    it('refuses an order that already has custom_project_code in ERPNext', async () => {
      vi.mocked(erpGet).mockResolvedValueOnce({
        name: 'SAL-ORD-LINKED-ERP',
        customer: 'Acme',
        custom_wo_number: '1234',
        docstatus: 1,
        status: 'To Deliver',
        custom_project_code: 'ACS-0010-1',
        modified: '2026-10-02 12:00:00',
        items: [{ name: 'r1', item_code: 'PLC', qty: 1 }],
      } as any);

      await expect(getOrderForProject(directorPrincipal, 'SAL-ORD-LINKED-ERP')).rejects.toThrow(
        new DomainError('Sales order is already linked to project ACS-0010-1.'),
      );
    });

    it('refuses an order that is already linked to a project in Engineering OS', async () => {
      const existingProject = await prisma.project.create({
        data: {
          companyId: directorPrincipal.companyId,
          code: `TEST-ORD-LINK-${Date.now()}`,
          name: 'Existing Linked Project',
          clientName: 'Acme',
          erpSalesOrder: 'SAL-ORD-LINKED-DB',
          managerId: directorPrincipal.userId,
        },
      });

      try {
        vi.mocked(erpGet).mockResolvedValueOnce({
          name: 'SAL-ORD-LINKED-DB',
          customer: 'Acme',
          custom_wo_number: '1234',
          docstatus: 1,
          status: 'To Deliver',
          custom_project_code: '',
          modified: '2026-10-02 12:00:00',
          items: [{ name: 'r1', item_code: 'PLC', qty: 1 }],
        } as any);

        await expect(getOrderForProject(directorPrincipal, 'SAL-ORD-LINKED-DB')).rejects.toThrow(
          new DomainError(`Sales order is already linked to project ${existingProject.code}.`),
        );
      } finally {
        await prisma.project.delete({ where: { id: existingProject.id } });
      }
    });

    it('refuses an order missing a WO number', async () => {
      vi.mocked(erpGet).mockResolvedValueOnce({
        name: 'SAL-ORD-NO-WO',
        customer: 'Acme',
        custom_wo_number: '',
        docstatus: 1,
        status: 'To Deliver',
        modified: '2026-10-02 12:00:00',
        items: [{ name: 'r1', item_code: 'PLC', qty: 1 }],
      } as any);

      await expect(getOrderForProject(directorPrincipal, 'SAL-ORD-NO-WO')).rejects.toThrow(
        new DomainError('Sales order is missing a Work Order number.'),
      );
    });

    it('refuses an order with non-digit characters in WO number', async () => {
      vi.mocked(erpGet).mockResolvedValueOnce({
        name: 'SAL-ORD-BAD-WO',
        customer: 'Acme',
        custom_wo_number: 'WO-1234',
        docstatus: 1,
        status: 'To Deliver',
        modified: '2026-10-02 12:00:00',
        items: [{ name: 'r1', item_code: 'PLC', qty: 1 }],
      } as any);

      await expect(getOrderForProject(directorPrincipal, 'SAL-ORD-BAD-WO')).rejects.toThrow(
        new DomainError('Work Order number must contain only digits.'),
      );
    });

    it('refuses an order with an item code that is not an active checklist template', async () => {
      vi.mocked(erpGet).mockResolvedValueOnce({
        name: 'SAL-ORD-BAD-ITEM',
        customer: 'Acme',
        custom_wo_number: '1234',
        docstatus: 1,
        status: 'To Deliver',
        modified: '2026-10-02 12:00:00',
        items: [{ name: 'r1', item_code: 'SPECIAL_ROBOT_PANEL', qty: 1 }],
      } as any);

      await expect(getOrderForProject(directorPrincipal, 'SAL-ORD-BAD-ITEM')).rejects.toThrow(
        new DomainError('Item "SPECIAL_ROBOT_PANEL" is not an active checklist template.'),
      );
    });
  });

  describe('resolveClientForCustomer', () => {
    it('denies resolution for an engineer lacking pm.project.create', async () => {
      await expect(resolveClientForCustomer(engineerPrincipal, 'Any Customer')).rejects.toThrow(
        ForbiddenError,
      );
    });

    it('finds existing client by erpCustomer (branch 1)', async () => {
      const client = await prisma.client.create({
        data: {
          companyId: directorPrincipal.companyId,
          name: `Client Branch 1 ${Date.now()}`,
          refNumber: `ACS-${Math.floor(1000 + Math.random() * 8000)}`,
          erpCustomer: 'Branch 1 Customer',
        },
      });

      try {
        vi.mocked(erpGet).mockResolvedValueOnce({
          name: 'Branch 1 Customer',
          customer_name: 'Branch 1 Customer',
          custom_acs_reference: client.refNumber,
        } as any);

        const resolved = await resolveClientForCustomer(directorPrincipal, 'Branch 1 Customer');

        expect(resolved.id).toBe(client.id);
        expect(resolved.refNumber).toBe(client.refNumber);
        expect(erpUpdate).not.toHaveBeenCalled();
      } finally {
        await prisma.client.delete({ where: { id: client.id } });
      }
    });

    it('links existing client when customer custom_acs_reference matches refNumber (branch 2)', async () => {
      const ref = `ACS-${Math.floor(1000 + Math.random() * 8000)}`;
      const client = await prisma.client.create({
        data: {
          companyId: directorPrincipal.companyId,
          name: `Unlinked Ref Client ${Date.now()}`,
          refNumber: ref,
          erpCustomer: null,
        },
      });

      try {
        vi.mocked(erpGet).mockResolvedValueOnce({
          name: 'Customer With Matching ACS Ref',
          customer_name: 'Customer With Matching ACS Ref',
          custom_acs_reference: ref,
        } as any);

        const resolved = await resolveClientForCustomer(
          directorPrincipal,
          'Customer With Matching ACS Ref',
        );

        expect(resolved.id).toBe(client.id);
        expect(resolved.erpCustomer).toBe('Customer With Matching ACS Ref');

        const dbClient = await prisma.client.findUnique({ where: { id: client.id } });
        expect(dbClient?.erpCustomer).toBe('Customer With Matching ACS Ref');
        expect(erpUpdate).not.toHaveBeenCalled();
      } finally {
        await prisma.client.delete({ where: { id: client.id } });
      }
    });

    it('links existing unlinked client of the same name and writes reference back (branch 3 name clash)', async () => {
      const customerName = `Existing Name Co ${Date.now()}`;
      const ref = `ACS-${Math.floor(1000 + Math.random() * 8000)}`;
      const client = await prisma.client.create({
        data: {
          companyId: directorPrincipal.companyId,
          name: customerName,
          refNumber: ref,
          erpCustomer: null,
        },
      });

      try {
        vi.mocked(erpGet).mockResolvedValueOnce({
          name: customerName,
          customer_name: customerName,
          custom_acs_reference: '',
        } as any);
        vi.mocked(erpUpdate).mockResolvedValueOnce({ name: customerName } as any);

        const resolved = await resolveClientForCustomer(directorPrincipal, customerName);

        expect(resolved.id).toBe(client.id);
        expect(resolved.erpCustomer).toBe(customerName);

        const dbClient = await prisma.client.findUnique({ where: { id: client.id } });
        expect(dbClient?.erpCustomer).toBe(customerName);

        expect(erpUpdate).toHaveBeenCalledWith('Customer', customerName, {
          custom_acs_reference: ref,
        });
      } finally {
        await prisma.client.delete({ where: { id: client.id } });
      }
    });

    it('creates brand new client with nextClientRef and writes reference back (branch 4)', async () => {
      const customerName = `Brand New Customer ${Date.now()}`;

      vi.mocked(erpGet).mockResolvedValueOnce({
        name: customerName,
        customer_name: customerName,
        custom_acs_reference: '',
      } as any);
      vi.mocked(erpUpdate).mockResolvedValueOnce({ name: customerName } as any);

      const resolved = await resolveClientForCustomer(directorPrincipal, customerName);

      try {
        expect(resolved.name).toBe(customerName);
        expect(resolved.erpCustomer).toBe(customerName);
        expect(resolved.refNumber).toMatch(/^ACS-\d{4}$/);

        const dbClient = await prisma.client.findUnique({ where: { id: resolved.id } });
        expect(dbClient).not.toBeNull();
        expect(dbClient?.erpCustomer).toBe(customerName);

        expect(erpUpdate).toHaveBeenCalledWith('Customer', customerName, {
          custom_acs_reference: resolved.refNumber,
        });
      } finally {
        await prisma.client.delete({ where: { id: resolved.id } });
      }
    });

    it('resolves exactly one client when two parallel requests race for the same new customer', async () => {
      const customerName = `Race Customer ${Date.now()}`;

      vi.mocked(erpGet).mockImplementation(async (doctype: string, name: string) => {
        if (doctype === 'Customer' && name === customerName) {
          return {
            name: customerName,
            customer_name: customerName,
            custom_acs_reference: '',
          } as any;
        }
        throw new Error(`Unexpected erpGet for ${doctype} ${name}`);
      });
      vi.mocked(erpUpdate).mockResolvedValue({ name: customerName } as any);

      const [res1, res2] = await Promise.all([
        resolveClientForCustomer(directorPrincipal, customerName),
        resolveClientForCustomer(directorPrincipal, customerName),
      ]);

      try {
        expect(res1.id).toBe(res2.id);
        expect(res1.refNumber).toBe(res2.refNumber);

        const totalInDb = await prisma.client.count({
          where: { companyId: directorPrincipal.companyId, erpCustomer: customerName },
        });
        expect(totalInDb).toBe(1);
      } finally {
        await prisma.client.delete({ where: { id: res1.id } });
      }
    });

    it('preserves the client if write-back fails and retries write-back on subsequent call', async () => {
      const customerName = `Writeback Fail Customer ${Date.now()}`;

      // Call 1: erpGet returns empty custom_acs_reference; erpUpdate fails
      vi.mocked(erpGet).mockResolvedValueOnce({
        name: customerName,
        customer_name: customerName,
        custom_acs_reference: '',
      } as any);
      vi.mocked(erpUpdate).mockRejectedValueOnce(new Error('ERPNext timeout on write-back'));

      const res1 = await resolveClientForCustomer(directorPrincipal, customerName);

      try {
        // Client still exists in DB!
        expect(res1.id).toBeDefined();
        const dbClient = await prisma.client.findUnique({ where: { id: res1.id } });
        expect(dbClient).not.toBeNull();
        expect(dbClient?.erpCustomer).toBe(customerName);

        // Call 2: customer still has empty custom_acs_reference in ERPNext; erpUpdate succeeds this time
        vi.mocked(erpGet).mockResolvedValueOnce({
          name: customerName,
          customer_name: customerName,
          custom_acs_reference: '',
        } as any);
        vi.mocked(erpUpdate).mockResolvedValueOnce({ name: customerName } as any);

        const res2 = await resolveClientForCustomer(directorPrincipal, customerName);

        expect(res2.id).toBe(res1.id);
        expect(erpUpdate).toHaveBeenCalledTimes(2);
        expect(erpUpdate).toHaveBeenLastCalledWith('Customer', customerName, {
          custom_acs_reference: res1.refNumber,
        });
      } finally {
        await prisma.client.delete({ where: { id: res1.id } });
      }
    });
  });
});

