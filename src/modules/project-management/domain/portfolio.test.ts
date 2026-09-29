import { describe, expect, it } from 'vitest';
import { countByAutomationType, daysLate, forecastFinish, isLaneLate, projectHealth, projectProgress } from './portfolio';
import { summariseProblems } from '../services/dashboard.service';
import { todayInIndia } from '@/core/utils/dates';

describe('projectProgress', () => {
  it('returns 0 when there are no tasks or only cancelled tasks', () => {
    expect(projectProgress([])).toBe(0);
    expect(projectProgress([{ id: '1', status: 'CANCELLED', percentComplete: 100 }])).toBe(0);
  });

  it('calculates effort-weighted progress across leaf tasks', () => {
    const tasks = [
      { id: '1', status: 'TODO', percentComplete: 0, estimatedHours: 8 },
      { id: '2', status: 'COMPLETED', percentComplete: 0, estimatedHours: 8 },
    ];
    expect(projectProgress(tasks)).toBe(50);
  });

  it('treats COMPLETED status as 100% even if percentComplete field is outdated', () => {
    const tasks = [
      { id: '1', status: 'COMPLETED', percentComplete: 50, estimatedHours: 10 },
      { id: '2', status: 'IN_PROGRESS', percentComplete: 50, estimatedHours: 10 },
    ];
    // (100% * 10 + 50% * 10) / 20 = 75%
    expect(projectProgress(tasks)).toBe(75);
  });

  it('ignores parent tasks and only calculates on leaf tasks', () => {
    const tasks = [
      { id: 'parent', status: 'IN_PROGRESS', percentComplete: 20, estimatedHours: 20 },
      { id: 'child1', parentId: 'parent', status: 'COMPLETED', percentComplete: 100, estimatedHours: 10 },
      { id: 'child2', parentId: 'parent', status: 'TODO', percentComplete: 0, estimatedHours: 10 },
    ];
    expect(projectProgress(tasks)).toBe(50);
  });
});

describe('projectHealth', () => {
  const baseStart = new Date('2026-09-01');
  const baseTarget = new Date('2026-09-30');

  it('marks ON_HOLD, COMPLETED, CLOSED and COMMISSIONING directly', () => {
    expect(projectHealth({ status: 'COMPLETED', startDate: baseStart, targetEndDate: baseTarget, progressPercent: 100 })).toBe('COMPLETED');
    expect(projectHealth({ status: 'CLOSED', startDate: baseStart, targetEndDate: baseTarget, progressPercent: 100 })).toBe('COMPLETED');
    expect(projectHealth({ status: 'ON_HOLD', startDate: baseStart, targetEndDate: baseTarget, progressPercent: 50 })).toBe('ON_HOLD');
    expect(projectHealth({ status: 'COMMISSIONING', startDate: baseStart, targetEndDate: baseTarget, progressPercent: 100 })).toBe('COMMISSIONING');
  });

  it('identifies LATE projects when forecast finish exceeds target date or past deadline', () => {
    expect(
      projectHealth({
        status: 'IN_PROGRESS',
        startDate: baseStart,
        targetEndDate: baseTarget,
        forecastEndDate: new Date('2026-10-05'),
        progressPercent: 60,
      }),
    ).toBe('LATE');

    expect(
      projectHealth({
        status: 'IN_PROGRESS',
        startDate: baseStart,
        targetEndDate: new Date('2026-09-10'),
        progressPercent: 80,
        asOfDate: new Date('2026-09-15'),
      }),
    ).toBe('LATE');
  });

  it('identifies AT_RISK projects when lagging significantly behind elapsed schedule or having roadblocks', () => {
    // 50% time elapsed (Sept 15), but only 20% progress (< 50% - 15% = 35%)
    expect(
      projectHealth({
        status: 'IN_PROGRESS',
        startDate: baseStart,
        targetEndDate: baseTarget,
        progressPercent: 20,
        asOfDate: new Date('2026-09-15'),
      }),
    ).toBe('AT_RISK');

    // On time progress but has open roadblock
    expect(
      projectHealth({
        status: 'IN_PROGRESS',
        startDate: baseStart,
        targetEndDate: baseTarget,
        progressPercent: 60,
        hasOpenRoadblock: true,
        asOfDate: new Date('2026-09-15'),
      }),
    ).toBe('AT_RISK');
  });

  it('identifies ON_TRACK when pace matches or exceeds elapsed schedule without blockers', () => {
    expect(
      projectHealth({
        status: 'IN_PROGRESS',
        startDate: baseStart,
        targetEndDate: baseTarget,
        progressPercent: 50,
        asOfDate: new Date('2026-09-15'),
      }),
    ).toBe('ON_TRACK');
  });
});

describe('forecastFinish', () => {
  const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

  it('pushes the lane back by how late its overdue open step is', () => {
    // Mon 14 Sept step not done; today Thu 17 Sept -> 3 working days late (15, 16, 17).
    const steps = [
      { parentId: 'plc', status: 'IN_PROGRESS', plannedEnd: d('2026-09-14') },
      { parentId: 'plc', status: 'TODO', plannedEnd: d('2026-09-30') },
    ];
    const forecast = forecastFinish(steps, d('2026-09-30'), d('2026-09-17'));
    expect(forecast.toISOString().slice(0, 10)).toBe('2026-10-03'); // 30 Sept + 3 working days
    const health = projectHealth({
      status: 'IN_PROGRESS', startDate: d('2026-09-01'), targetEndDate: d('2026-09-30'),
      forecastEndDate: forecast, progressPercent: 40, asOfDate: d('2026-09-17'),
    });
    expect(health).toBe('LATE');
    expect(daysLate(forecast, d('2026-09-30'), d('2026-09-17'), health)).toBe(3);
  });

  it('ignores completed steps and does not delay other lanes beyond their own slip', () => {
    const steps = [
      { parentId: 'plc', status: 'COMPLETED', plannedEnd: d('2026-09-10') },
      { parentId: 'plc', status: 'TODO', plannedEnd: d('2026-09-25') },
      { parentId: 'hmi', status: 'TODO', plannedEnd: d('2026-09-28') },
    ];
    expect(forecastFinish(steps, d('2026-09-30'), d('2026-09-17')).toISOString().slice(0, 10)).toBe('2026-09-30');
  });
});

describe('summariseProblems', () => {
  const task = (status = 'BLOCKED') => ({ id: 't1', title: 'DI Mapping', status, projectId: 'p1', project: { name: 'P' } });
  const log = (blocker: string | null, day: string, status?: string) => ({
    taskId: 't1', blocker, createdAt: new Date(`${day}T10:00:00.000Z`), task: task(status),
  });

  it('counts a problem once, and a later note without a blocker solves it', () => {
    const logs = [log('waiting drawing', '2026-09-12'), log('still waiting', '2026-09-13'), log(null, '2026-09-15')];
    const result = summariseProblems(logs, new Date('2026-09-10T00:00:00.000Z'));
    expect(result.reported).toBe(1);
    expect(result.solved).toBe(1);
    expect(result.open).toHaveLength(0);
  });

  it('keeps an unsolved problem open once, not once per note', () => {
    const logs = [log('waiting drawing', '2026-09-12'), log('still waiting', '2026-09-13')];
    expect(summariseProblems(logs, new Date('2026-09-10T00:00:00.000Z')).open).toHaveLength(1);
  });
});

describe('todayInIndia', () => {
  it('rolls to the next date after 18:30 UTC', () => {
    expect(todayInIndia(new Date('2026-09-16T19:00:00.000Z')).toISOString().slice(0, 10)).toBe('2026-09-17');
    expect(todayInIndia(new Date('2026-09-16T18:00:00.000Z')).toISOString().slice(0, 10)).toBe('2026-09-16');
  });
});

describe('countByAutomationType', () => {
  it('counts active projects per type, multi-type in both, on hold separately', () => {
    expect(
      countByAutomationType([
        { status: 'IN_PROGRESS', automationTypes: ['PLC'] },
        { status: 'PLANNING', automationTypes: ['PLC', 'HMI'] },
        { status: 'ON_HOLD', automationTypes: ['SCADA'] },
        { status: 'COMPLETED', automationTypes: ['HMI'] },
        { status: 'CANCELLED', automationTypes: ['PLC'] },
        { status: 'IN_PROGRESS', automationTypes: [] },
      ]),
    ).toEqual({ PLC: 2, SCADA: 0, HMI: 1, onHold: 1 });
  });
});

describe('isLaneLate', () => {
  const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

  it('returns false when all steps are completed even if past delivery date', () => {
    const steps = [
      { parentId: 'plc', status: 'COMPLETED', plannedEnd: d('2026-09-10') },
      { parentId: 'plc', status: 'COMPLETED', plannedEnd: d('2026-09-14') },
    ];
    expect(isLaneLate(steps, d('2026-09-15'), d('2026-09-20'))).toBe(false);
  });

  it('returns true when there are open steps and today is past delivery date', () => {
    const steps = [
      { parentId: 'plc', status: 'COMPLETED', plannedEnd: d('2026-09-10') },
      { parentId: 'plc', status: 'TODO', plannedEnd: d('2026-09-15') },
    ];
    expect(isLaneLate(steps, d('2026-09-15'), d('2026-09-16'))).toBe(true);
  });

  it('returns true when today is on or before delivery date but overdue steps push forecast past delivery date', () => {
    // Delivery date: 2026-09-20. Step due 2026-09-14 is not completed on 2026-09-17 (3 working days late).
    // Last step was planned for 2026-09-19 -> slips to 2026-09-23 (> 2026-09-20).
    const steps = [
      { parentId: 'plc', status: 'IN_PROGRESS', plannedEnd: d('2026-09-14') },
      { parentId: 'plc', status: 'TODO', plannedEnd: d('2026-09-19') },
    ];
    expect(isLaneLate(steps, d('2026-09-20'), d('2026-09-17'))).toBe(true);
  });

  it('returns false when open steps are on track to finish by delivery date', () => {
    const steps = [
      { parentId: 'plc', status: 'TODO', plannedEnd: d('2026-09-18') },
      { parentId: 'plc', status: 'TODO', plannedEnd: d('2026-09-20') },
    ];
    expect(isLaneLate(steps, d('2026-09-20'), d('2026-09-17'))).toBe(false);
  });

  it('returns false when deliveryDate is missing', () => {
    const steps = [
      { parentId: 'plc', status: 'TODO', plannedEnd: d('2026-09-18') },
    ];
    expect(isLaneLate(steps, null, d('2026-09-17'))).toBe(false);
  });
});

