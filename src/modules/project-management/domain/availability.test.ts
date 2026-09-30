import { describe, expect, it } from 'vitest';
import {
  allocateTeamForSteps,
  applyHardRules,
  assignmentHoursInWindow,
  computeWorkload,
  gradeFloor,
  isExecutionStaff,
  rankCandidates,
  scoreForStep,
  type CapacityWindow,
  type SmartCandidate,
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

describe('Smart Team Allocation Engine', () => {
  const stepDates = {
    plannedStart: new Date('2026-09-01T00:00:00.000Z'),
    plannedEnd: new Date('2026-09-05T00:00:00.000Z'),
  };

  const traineeCandidate = {
    id: 'u-trainee',
    fullName: 'Jigar Trainee',
    employeeCode: 'EMP-01',
    grade: 'TRAINEE',
    status: 'ACTIVE',
    freeHours: 40,
    totalCapacityHours: 40,
    workingDays: 5,
    leaveDays: 0,
    leaves: [],
  };

  const seniorCandidate = {
    id: 'u-senior',
    fullName: 'Shivam Senior',
    employeeCode: 'EMP-02',
    grade: 'SENIOR_ENGINEER',
    status: 'ACTIVE',
    freeHours: 40,
    totalCapacityHours: 40,
    workingDays: 5,
    leaveDays: 0,
    leaves: [],
  };

  it('enforces correct grade floors', () => {
    expect(gradeFloor('JUNIOR')).toBe(1); // TRAINEE
    expect(gradeFloor('SENIOR')).toBe(3); // ENGINEER
    expect(gradeFloor('ASST_MANAGER')).toBe(4); // SENIOR_ENGINEER
  });

  it('rejects a trainee from SENIOR steps via hard eligibility rule (Layer 1)', () => {
    const seniorStep = {
      id: 'step-10',
      stepNumber: 10,
      name: 'Safety PLC Interlocks',
      recommendedSeniority: 'SENIOR',
      estimatedHours: 8,
      ...stepDates,
    };

    expect(applyHardRules(traineeCandidate, seniorStep)).toBe(false);
    expect(applyHardRules(seniorCandidate, seniorStep)).toBe(true);
  });

  it('rejects candidate on approved leave during the step window', () => {
    const onLeaveSenior = {
      ...seniorCandidate,
      leaves: [
        {
          startDate: new Date('2026-09-01T00:00:00.000Z'),
          endDate: new Date('2026-09-04T00:00:00.000Z'),
        },
      ],
    };
    const step = {
      id: 'step-1',
      stepNumber: 1,
      name: 'IO List',
      recommendedSeniority: 'JUNIOR',
      estimatedHours: 8,
      ...stepDates,
    };

    expect(applyHardRules(onLeaveSenior, step)).toBe(false);
  });

  it('rejects PMs and Assistant Managers from auto-assignment via H4', () => {
    const pmCandidate = {
      ...seniorCandidate,
      grade: 'MANAGER',
      designation: 'Project Manager',
    };
    const asstManagerCandidate = {
      ...seniorCandidate,
      designation: 'Asst. Manager',
    };
    const step = {
      id: 'step-1',
      stepNumber: 1,
      name: 'IO List',
      recommendedSeniority: 'JUNIOR',
      estimatedHours: 8,
      ...stepDates,
    };

    expect(applyHardRules(pmCandidate, step)).toBe(false);
    expect(applyHardRules(asstManagerCandidate, step)).toBe(false);
  });

  it('consumes capacity sequentially and distributes load across squad', () => {
    const candidates = [
      { ...seniorCandidate, id: 'sr-1', employeeCode: 'EMP-A', freeHours: 16 },
      { ...seniorCandidate, id: 'sr-2', employeeCode: 'EMP-B', freeHours: 16 },
    ];

    const steps = [
      { id: 's1', stepNumber: 1, name: 'Step 1', recommendedSeniority: 'SENIOR', estimatedHours: 16, ...stepDates },
      { id: 's2', stepNumber: 2, name: 'Step 2', recommendedSeniority: 'SENIOR', estimatedHours: 16, ...stepDates },
    ];

    const results = allocateTeamForSteps(candidates, steps);
    expect(results[0].assignedUserId).toBe('sr-1');
    // sr-1's capacity is consumed by step 1 (16h -> 0h), so step 2 is assigned to sr-2!
    expect(results[1].assignedUserId).toBe('sr-2');
  });

  it('spreads senior steps across seniors and keeps junior steps with the junior', () => {
    const squad = [
      { ...seniorCandidate, id: 'sr-1', employeeCode: 'EMP-A', freeHours: 64 },
      { ...seniorCandidate, id: 'sr-2', employeeCode: 'EMP-B', freeHours: 64 },
      { ...seniorCandidate, id: 'sr-3', employeeCode: 'EMP-C', freeHours: 64 },
      { ...seniorCandidate, id: 'sr-4', employeeCode: 'EMP-D', freeHours: 64 },
      { ...seniorCandidate, id: 'jr-1', employeeCode: 'EMP-E', grade: 'JUNIOR_ENGINEER', freeHours: 80 },
    ];
    const seniority = ['JUNIOR', 'JUNIOR', 'JUNIOR', 'JUNIOR', 'SENIOR', 'SENIOR', 'SENIOR', 'SENIOR', 'JUNIOR', 'SENIOR'];
    const steps = seniority.map((s, i) => ({
      id: `s${i + 1}`,
      stepNumber: i + 1,
      templateInstanceId: 'PLC',
      name: `Step ${i + 1}`,
      recommendedSeniority: s,
      estimatedHours: 8,
      ...stepDates,
    }));

    const results = allocateTeamForSteps(squad, steps, new Set(squad.map((c) => c.id)));
    const seniorHolders = results.filter((_, i) => seniority[i] === 'SENIOR').map((r) => r.assignedUserId);
    const juniorHolders = results.filter((_, i) => seniority[i] === 'JUNIOR').map((r) => r.assignedUserId);

    // 5 senior steps over 4 seniors: fair share is 2, so at least 3 different seniors.
    expect(new Set(seniorHolders).size).toBeGreaterThanOrEqual(3);
    for (const id of new Set(seniorHolders)) {
      expect(seniorHolders.filter((h) => h === id).length).toBeLessThanOrEqual(2);
    }
    expect(new Set(juniorHolders)).toEqual(new Set(['jr-1']));
  });

  it('produces deterministic output on repeated runs', () => {
    const candidates = [
      { ...seniorCandidate, id: 'sr-1', employeeCode: 'EMP-A', freeHours: 24 },
      { ...seniorCandidate, id: 'sr-2', employeeCode: 'EMP-B', freeHours: 24 },
    ];
    const steps = [
      { id: 's1', stepNumber: 1, name: 'Step 1', recommendedSeniority: 'SENIOR', estimatedHours: 8, ...stepDates },
      { id: 's2', stepNumber: 2, name: 'Step 2', recommendedSeniority: 'SENIOR', estimatedHours: 8, ...stepDates },
    ];

    const run1 = allocateTeamForSteps(candidates, steps);
    const run2 = allocateTeamForSteps(candidates, steps);

    expect(run1.map((r) => r.assignedUserId)).toEqual(run2.map((r) => r.assignedUserId));
    expect(run1.map((r) => r.score)).toEqual(run2.map((r) => r.score));
  });

  it('calculates multi-factor score correctly for step requirements', () => {
    const candidate = {
      ...seniorCandidate,
      freeHours: 40,
      totalCapacityHours: 48,
      activeProjectsCount: 1,
    };
    const step = {
      id: 's1',
      stepNumber: 1,
      name: 'Step 1',
      recommendedSeniority: 'SENIOR',
      estimatedHours: 8,
      ...stepDates,
    };

    const result = scoreForStep(candidate, step, {
      pmSquadUserIds: new Set([candidate.id]),
      assignedSteps: [],
    });
    expect(result.score).toBeGreaterThan(70);
    expect(result.breakdown.M).toBe(100);
    expect(result.breakdown.A).toBeGreaterThan(0);
  });
});

describe('Plan 011: PM and Assistant PM availability rules', () => {
  const stepDates = {
    plannedStart: new Date('2026-09-01T00:00:00.000Z'),
    plannedEnd: new Date('2026-09-05T00:00:00.000Z'),
  };

  const step = {
    id: 'step-1',
    stepNumber: 1,
    name: 'PLC Panel Engineering',
    recommendedSeniority: 'SENIOR',
    estimatedHours: 8,
    ...stepDates,
  };

  it('leaves isExecutionStaff behavior strictly unchanged', () => {
    expect(isExecutionStaff({ grade: 'ENGINEER', designation: 'Engineer' })).toBe(true);
    expect(isExecutionStaff({ grade: 'SENIOR_ENGINEER', designation: 'Sr. Engineer' })).toBe(true);
    expect(isExecutionStaff({ grade: 'MANAGER', designation: 'Project Manager' })).toBe(false);
    expect(isExecutionStaff({ grade: 'SENIOR_ENGINEER', designation: 'Asst. Manager' })).toBe(false);
    expect(isExecutionStaff({ grade: 'HEAD', designation: 'Technical Head' })).toBe(false);
    expect(isExecutionStaff({ grade: 'DIRECTOR', designation: 'Director' })).toBe(false);
  });

  it('allows candidate flagged isPM with grade MANAGER to pass applyHardRules', () => {
    const pmCandidate: SmartCandidate = {
      id: 'u-pm',
      fullName: 'Parth PM',
      employeeCode: 'PM-01',
      grade: 'MANAGER',
      designation: 'Project Manager',
      status: 'ACTIVE',
      freeHours: 40,
      totalCapacityHours: 40,
      workingDays: 5,
      leaveDays: 0,
      leaves: [],
      isPM: true,
    };

    expect(applyHardRules(pmCandidate, step)).toBe(true);
  });

  it('allows candidate flagged isPM with grade SENIOR_ENGINEER and Asst. Manager designation to pass applyHardRules', () => {
    const asstPmCandidate: SmartCandidate = {
      id: 'u-asst-pm',
      fullName: 'Dhrupin Asst PM',
      employeeCode: 'APM-01',
      grade: 'SENIOR_ENGINEER',
      designation: 'Asst. Manager',
      status: 'ACTIVE',
      freeHours: 40,
      totalCapacityHours: 40,
      workingDays: 5,
      leaveDays: 0,
      leaves: [],
      isPM: true,
    };

    expect(applyHardRules(asstPmCandidate, step)).toBe(true);
  });

  it('rejects unflagged MANAGER or Asst. Manager from applyHardRules', () => {
    const unflaggedManager: SmartCandidate = {
      id: 'u-mgr',
      fullName: 'Unflagged Manager',
      employeeCode: 'MGR-01',
      grade: 'MANAGER',
      designation: 'Operations Manager',
      status: 'ACTIVE',
      freeHours: 40,
      totalCapacityHours: 40,
      workingDays: 5,
      leaveDays: 0,
      leaves: [],
      isPM: false,
    };
    const unflaggedAsst: SmartCandidate = {
      id: 'u-asst',
      fullName: 'Unflagged Asst',
      employeeCode: 'AST-01',
      grade: 'SENIOR_ENGINEER',
      designation: 'Asst. Manager',
      status: 'ACTIVE',
      freeHours: 40,
      totalCapacityHours: 40,
      workingDays: 5,
      leaveDays: 0,
      leaves: [],
    };

    expect(applyHardRules(unflaggedManager, step)).toBe(false);
    expect(applyHardRules(unflaggedAsst, step)).toBe(false);
  });

  it('always rejects DIRECTOR and HEAD even if flagged isPM', () => {
    const directorCandidate: SmartCandidate = {
      id: 'u-dir',
      fullName: 'Satish Director',
      employeeCode: 'DIR-01',
      grade: 'DIRECTOR',
      designation: 'Director',
      status: 'ACTIVE',
      freeHours: 40,
      totalCapacityHours: 40,
      workingDays: 5,
      leaveDays: 0,
      leaves: [],
      isPM: true,
    };
    const headCandidate: SmartCandidate = {
      id: 'u-head',
      fullName: 'Dilip Head',
      employeeCode: 'HEAD-01',
      grade: 'HEAD',
      designation: 'Technical Head',
      status: 'ACTIVE',
      freeHours: 40,
      totalCapacityHours: 40,
      workingDays: 5,
      leaveDays: 0,
      leaves: [],
      isPM: true,
    };

    expect(applyHardRules(directorCandidate, step)).toBe(false);
    expect(applyHardRules(headCandidate, step)).toBe(false);
  });

  it('allocates steps to a flagged PM candidate in allocateTeamForSteps', () => {
    const pmCandidate: SmartCandidate = {
      id: 'u-pm-alloc',
      fullName: 'Parth PM',
      employeeCode: 'PM-01',
      grade: 'MANAGER',
      designation: 'Project Manager',
      status: 'ACTIVE',
      freeHours: 40,
      totalCapacityHours: 40,
      workingDays: 5,
      leaveDays: 0,
      leaves: [],
      isPM: true,
    };

    const results = allocateTeamForSteps([pmCandidate], [step], new Set([pmCandidate.id]));
    expect(results[0].assignedUserId).toBe('u-pm-alloc');
  });

  it('refuses to allocate unflagged MANAGER or DIRECTOR in allocateTeamForSteps', () => {
    const unflaggedMgr: SmartCandidate = {
      id: 'u-mgr-only',
      fullName: 'Only Manager',
      employeeCode: 'MGR-99',
      grade: 'MANAGER',
      designation: 'Manager',
      status: 'ACTIVE',
      freeHours: 40,
      totalCapacityHours: 40,
      workingDays: 5,
      leaveDays: 0,
      leaves: [],
    };
    const director: SmartCandidate = {
      id: 'u-dir-only',
      fullName: 'Only Director',
      employeeCode: 'DIR-99',
      grade: 'DIRECTOR',
      designation: 'Director',
      status: 'ACTIVE',
      freeHours: 40,
      totalCapacityHours: 40,
      workingDays: 5,
      leaveDays: 0,
      leaves: [],
      isPM: true,
    };

    const results = allocateTeamForSteps([unflaggedMgr, director], [step]);
    expect(results[0].assignedUserId).toBeNull();
  });
});


