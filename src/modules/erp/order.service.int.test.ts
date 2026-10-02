import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prisma } from '@/core/db/prisma';
import { loadPrincipal } from '@/core/rbac/principal';
import { DomainError, ForbiddenError } from '@/core/rbac/errors';
import { erpGet, erpList } from './client';
import { listWaitingOrders, getOrderForProject } from './order.service';
import type { Principal } from '@/core/rbac/types';

vi.mock('@/modules/erp/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/modules/erp/client')>();
  return {
    ...actual,
    erpGet: vi.fn(),
    erpList: vi.fn(),
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
});
