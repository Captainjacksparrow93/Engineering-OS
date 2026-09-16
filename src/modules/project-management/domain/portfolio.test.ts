import { describe, expect, it } from 'vitest';
import { projectHealth, projectProgress } from './portfolio';

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

  it('marks ON_HOLD and COMPLETED directly', () => {
    expect(projectHealth({ status: 'COMPLETED', startDate: baseStart, targetEndDate: baseTarget, progressPercent: 100 })).toBe('COMPLETED');
    expect(projectHealth({ status: 'ON_HOLD', startDate: baseStart, targetEndDate: baseTarget, progressPercent: 50 })).toBe('ON_HOLD');
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
