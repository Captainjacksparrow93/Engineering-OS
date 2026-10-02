import { describe, expect, it } from 'vitest';
import {
  createAutomationProjectSchema,
  autoAssignTeamSchema,
  templateItemSchema,
  updateProjectSchema,
} from './schemas';

describe('updateProjectSchema', () => {
  it('omits code, managerId, sponsorId, and departmentId from project updates', () => {
    const parsed = updateProjectSchema.parse({
      name: 'Updated Name',
      clientName: 'New Client',
      managerId: 'should-be-omitted',
      departmentId: 'should-be-omitted',
    });
    expect(parsed.name).toBe('Updated Name');
    expect(parsed.clientName).toBe('New Client');
    expect('managerId' in parsed).toBe(false);
    expect('departmentId' in parsed).toBe(false);
  });
});

describe('createAutomationProjectSchema', () => {
  it('accepts a sales order without client, WO or scopes (the server reads them from ERP)', () => {
    const parsed = createAutomationProjectSchema.parse({
      salesOrder: ' SAL-ORD-2026-00052 ',
      managerId: 'pm-1',
    });
    expect(parsed.salesOrder).toBe('SAL-ORD-2026-00052');
  });

  it('still requires client, WO and scopes without a sales order', () => {
    const result = createAutomationProjectSchema.safeParse({ managerId: 'pm-1' });
    expect(result.success).toBe(false);
    const paths = result.success ? [] : result.error.issues.map((i) => i.path.join('.'));
    expect(paths).toEqual(expect.arrayContaining(['clientId', 'workOrderNo', 'scopes']));
  });

  it('validates valid automation project payload', () => {
    const valid = {
      workOrderNo: '4821',
      clientId: 'client-1',
      clientName: 'Client A',
      managerId: 'pm-1',
      scopes: [{ templateCode: 'PLC', name: 'PLC', quantity: 1 }],
      tasks: [
        {
          templateCode: 'PLC',
          unitIndex: 1,
          stepNumber: 1,
          title: 'IO List',
          assigneeId: 'eng-1',
          estimatedHours: 8,
        },
      ],
    };
    const parsed = createAutomationProjectSchema.parse(valid);
    expect(parsed.workOrderNo).toBe('4821');
    expect(parsed.clientId).toBe('client-1');
    expect(parsed.scopes.length).toBe(1);
    expect(parsed.tasks.length).toBe(1);
  });

  it('accepts optional panelDeliveryDates mapping', () => {
    const valid = {
      workOrderNo: '4821',
      clientId: 'client-1',
      clientName: 'Client A',
      managerId: 'pm-1',
      scopes: [{ templateCode: 'PLC', name: 'PLC', quantity: 1 }],
      panelDeliveryDates: {
        PLC_1: '2026-10-15',
        SCADA_1: '2026-10-20',
      },
      tasks: [],
    };
    const parsed = createAutomationProjectSchema.parse(valid);
    expect(parsed.panelDeliveryDates).toEqual({
      PLC_1: '2026-10-15',
      SCADA_1: '2026-10-20',
    });
  });

  it('rejects invalid panel delivery date strings', () => {
    const invalid = {
      workOrderNo: '4821',
      clientId: 'client-1',
      clientName: 'Client A',
      managerId: 'pm-1',
      scopes: [{ templateCode: 'PLC', name: 'PLC', quantity: 1 }],
      panelDeliveryDates: {
        PLC_1: 'garbage',
      },
      tasks: [],
    };
    expect(() => createAutomationProjectSchema.parse(invalid)).toThrow('Use the format YYYY-MM-DD');
  });

  it('rejects non-numeric workOrderNo', () => {
    const invalid = {
      workOrderNo: 'WO-1234',
      clientId: 'client-1',
      clientName: 'Client A',
      managerId: 'pm-1',
      scopes: [{ templateCode: 'PLC', name: 'PLC', quantity: 1 }],
      tasks: [
        {
          templateCode: 'PLC',
          unitIndex: 1,
          stepNumber: 1,
          title: 'IO List',
        },
      ],
    };
    expect(() => createAutomationProjectSchema.parse(invalid)).toThrow('Work Order No. must contain digits only');
  });

  it('rejects empty scopes', () => {
    const invalid = {
      workOrderNo: '4821',
      clientId: 'client-1',
      clientName: 'Client A',
      managerId: 'pm-1',
      scopes: [],
      tasks: [],
    };
    expect(() => createAutomationProjectSchema.parse(invalid)).toThrow();
  });
});

describe('autoAssignTeamSchema', () => {
  it('validates auto-assign payload', () => {
    const valid = {
      managerId: 'pm-1',
      scopes: [{ templateCode: 'PLC', name: 'PLC', quantity: 1 }],
      tasks: [
        {
          templateCode: 'PLC',
          unitIndex: 1,
          stepNumber: 1,
          title: 'IO List',
        },
      ],
    };
    const parsed = autoAssignTeamSchema.parse(valid);
    expect(parsed.managerId).toBe('pm-1');
  });
});

describe('templateItemSchema', () => {
  it('validates template item data', () => {
    const valid = {
      title: 'Valid Step',
      description: 'Step details',
      recommendedSeniority: 'SENIOR',
      defaultDurationHours: 12.5,
      dependsOnStep: 1,
    };
    const parsed = templateItemSchema.parse(valid);
    expect(parsed.title).toBe('Valid Step');
    expect(parsed.defaultDurationHours).toBe(12.5);
    expect(() => templateItemSchema.parse({ ...valid, defaultDurationHours: 0.3 })).toThrow();
  });

  it('rejects short title', () => {
    expect(() => templateItemSchema.parse({ title: 'ab' })).toThrow();
  });
});

describe('Service Call Validation (#1)', () => {
  it('allows SERVICE_CALL without workOrderNo and without scopes', () => {
    const valid = {
      kind: 'SERVICE_CALL',
      clientId: 'client-1',
      clientName: 'Torrent Pharma',
      managerId: 'pm-1',
      scopes: [],
      tasks: [],
    };
    const parsed = createAutomationProjectSchema.parse(valid);
    expect(parsed.kind).toBe('SERVICE_CALL');
    expect(parsed.workOrderNo).toBeUndefined();
    expect(parsed.scopes).toEqual([]);
  });

  it('rejects WORK_ORDER without workOrderNo', () => {
    const invalid = {
      kind: 'WORK_ORDER',
      clientId: 'client-1',
      clientName: 'Torrent Pharma',
      managerId: 'pm-1',
      scopes: [{ templateCode: 'PLC', name: 'PLC', quantity: 1 }],
      tasks: [],
    };
    expect(() => createAutomationProjectSchema.parse(invalid)).toThrow(
      'Work Order No. must contain digits only'
    );
  });

  it('rejects WORK_ORDER with empty scopes', () => {
    const invalid = {
      kind: 'WORK_ORDER',
      workOrderNo: '1234',
      clientId: 'client-1',
      clientName: 'Torrent Pharma',
      managerId: 'pm-1',
      scopes: [],
      tasks: [],
    };
    expect(() => createAutomationProjectSchema.parse(invalid)).toThrow(
      'Select at least one automation scope'
    );
  });
});
