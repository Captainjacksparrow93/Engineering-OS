import { describe, expect, it } from 'vitest';
import {
  assignmentHoursInWindow,
  computeWorkload,
  rankCandidates,
  type CapacityWindow,
  type WorkloadAssignment,
  type WorkloadPerson,
} from './availability';

const window: CapacityWindow = {
  from: new Date('2026-01-05T00:00:00.000Z'), // Monday
  to: new Date('2026-01-10T00:00:00.000Z'), // Saturday - six working days
};

const person = (overrides: Partial<WorkloadPerson> = {}): WorkloadPerson => ({
  id: 'u1',
  fullName: 'Test Engineer',
  employeeCode: 'VS-9999',
  grade: 'ENGINEER',
  designation: 'Design Engineer',
  departmentId: 'd1',
  departmentName: 'Electrical Design',
  skills: ['schematics'],
  dailyCapacityHours: 8,
  avatarColor: '#000',
  ...overrides,
});

const assignment = (overrides: Partial<WorkloadAssignment> = {}): WorkloadAssignment => ({
  taskId: 't1',
  taskCode: 'T-001',
  taskTitle: 'Task',
  projectId: 'p1',
  projectCode: 'PRJ-1',
  priority: 'MEDIUM',
  status: 'IN_PROGRESS',
  allocatedHours: 24,
  percentComplete: 0,
  plannedStart: new Date('2026-01-05T00:00:00.000Z'),
  plannedEnd: new Date('2026-01-07T00:00:00.000Z'),
  ...overrides,
});

describe('assignmentHoursInWindow', () => {
  it('counts only the remaining effort', () => {
    expect(assignmentHoursInWindow(assignment({ percentComplete: 75 }), window)).toBe(6);
  });

  it('ignores closed work', () => {
    expect(assignmentHoursInWindow(assignment({ status: 'COMPLETED' }), window)).toBe(0);
  });

  it('prorates a task that only partly overlaps the window', () => {
    // Three working days of work, one of which (Jan 10) falls inside a window that
    // starts later.
    const later: CapacityWindow = {
      from: new Date('2026-01-10T00:00:00.000Z'),
      to: new Date('2026-01-14T00:00:00.000Z'),
    };
    const hours = assignmentHoursInWindow(
      assignment({
        plannedStart: new Date('2026-01-08T00:00:00.000Z'),
        plannedEnd: new Date('2026-01-10T00:00:00.000Z'),
        allocatedHours: 24,
      }),
      later,
    );
    expect(hours).toBe(8);
  });

  it('loads overdue work fully onto the current window', () => {
    const hours = assignmentHoursInWindow(
      assignment({
        plannedStart: new Date('2025-12-01T00:00:00.000Z'),
        plannedEnd: new Date('2025-12-05T00:00:00.000Z'),
        allocatedHours: 16,
        percentComplete: 50,
      }),
      window,
    );
    expect(hours).toBe(8);
  });
});

describe('computeWorkload', () => {
  it('computes capacity over working days only', () => {
    const workload = computeWorkload(person(), [], [], window);
    expect(workload.workingDays).toBe(6); // Sunday excluded
    expect(workload.capacityHours).toBe(48);
    expect(workload.status).toBe('FREE');
  });

  it('subtracts approved leave from capacity', () => {
    const workload = computeWorkload(
      person(),
      [],
      [{ startDate: new Date('2026-01-05T00:00:00.000Z'), endDate: new Date('2026-01-06T00:00:00.000Z') }],
      window,
    );
    expect(workload.leaveDays).toBe(2);
    expect(workload.capacityHours).toBe(32);
  });

  it('reports someone on leave for the whole window as ON_LEAVE, not simply free', () => {
    const workload = computeWorkload(
      person(),
      [],
      [{ startDate: new Date('2026-01-01T00:00:00.000Z'), endDate: new Date('2026-01-31T00:00:00.000Z') }],
      window,
    );
    expect(workload.status).toBe('ON_LEAVE');
    expect(workload.capacityHours).toBe(0);
  });

  it('flags over-commitment', () => {
    const workload = computeWorkload(
      person(),
      [assignment({ allocatedHours: 60, plannedEnd: new Date('2026-01-10T00:00:00.000Z') })],
      [],
      window,
    );
    expect(workload.utilizationPercent).toBeGreaterThan(100);
    expect(workload.status).toBe('OVERLOADED');
  });

  it('counts overdue open tasks', () => {
    const workload = computeWorkload(
      person(),
      [assignment({ plannedEnd: new Date('2020-01-01T00:00:00.000Z') })],
      [],
      window,
    );
    expect(workload.overdueTaskCount).toBe(1);
  });
});

describe('rankCandidates', () => {
  const free = computeWorkload(person({ id: 'free', fullName: 'Free Engineer' }), [], [], window);
  const busy = computeWorkload(
    person({ id: 'busy', fullName: 'Busy Engineer' }),
    [assignment({ allocatedHours: 48 })],
    [],
    window,
  );
  const onLeave = computeWorkload(
    person({ id: 'leave', fullName: 'Away Engineer' }),
    [],
    [{ startDate: new Date('2026-01-01T00:00:00.000Z'), endDate: new Date('2026-01-31T00:00:00.000Z') }],
    window,
  );

  it('puts the person with spare capacity first', () => {
    const ranked = rankCandidates([busy, free], { requiredHours: 16 });
    expect(ranked[0]!.workload.person.id).toBe('free');
  });

  it('scores someone on leave at zero for capacity', () => {
    const ranked = rankCandidates([onLeave], { requiredHours: 8 });
    expect(ranked[0]!.workload.status).toBe('ON_LEAVE');
    expect(ranked[0]!.score).toBeLessThan(50);
  });

  it('rewards a skill match', () => {
    const withSkill = computeWorkload(person({ id: 'skilled', skills: ['eplan', 'schematics'] }), [], [], window);
    const withoutSkill = computeWorkload(person({ id: 'unskilled', skills: [] }), [], [], window);
    const ranked = rankCandidates([withoutSkill, withSkill], { requiredSkills: ['EPLAN'], requiredHours: 8 });
    expect(ranked[0]!.workload.person.id).toBe('skilled');
    expect(ranked[0]!.matchedSkills).toEqual(['eplan']);
    expect(ranked[1]!.missingSkills).toEqual(['eplan']);
  });

  it('prefers a senior engineer for critical work over a trainee', () => {
    const trainee = computeWorkload(person({ id: 'trainee', grade: 'TRAINEE' }), [], [], window);
    const senior = computeWorkload(person({ id: 'senior', grade: 'LEAD_ENGINEER' }), [], [], window);
    const ranked = rankCandidates([trainee, senior], { priority: 'CRITICAL', requiredHours: 8 });
    expect(ranked[0]!.workload.person.id).toBe('senior');
  });

  it('explains itself', () => {
    const ranked = rankCandidates([busy], { requiredHours: 40, requiredSkills: ['plc'] });
    expect(ranked[0]!.reasons.join(' ')).toMatch(/Short by|Missing/);
  });
});
