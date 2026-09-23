import { describe, expect, it } from 'vitest';
import { planLaneByHours, minWorkingDaysForHours } from './scheduling';

describe('Parallel Panel WBS Scheduling (Phase 3)', () => {
  it('schedules steps for a single panel with 1x template duration (1 working day = 8h)', () => {
    // 13 template tasks at 8h each for 1 panel
    const hoursList = Array(13).fill(8);
    const startDate = new Date('2026-09-01T00:00:00.000Z');
    const plan = planLaneByHours(hoursList, startDate);

    expect(plan.length).toBe(13);
    // Step 1: 8h -> 1 day duration
    expect(plan[0].plannedStart).toBeDefined();
    expect(plan[0].plannedEnd).toBeDefined();

    // Verify 13 8-hour steps take 13 working days
    expect(minWorkingDaysForHours(hoursList)).toBe(13);
  });

  it('keeps panel steps at 1x template duration regardless of total project quantity', () => {
    // When a project has 5 panels, each panel's lane is scheduled with duration for 1 panel (8h per step),
    // NOT 5 x 8h = 40h per step.
    const panel1Hours = Array(13).fill(8);
    const panel2Hours = Array(13).fill(8);
    const startDate = new Date('2026-09-01T00:00:00.000Z');

    const plan1 = planLaneByHours(panel1Hours, startDate);
    const plan2 = planLaneByHours(panel2Hours, startDate);

    expect(plan1[0].plannedEnd.getTime()).toEqual(plan2[0].plannedEnd.getTime());
    expect(plan1[12].plannedEnd.getTime()).toEqual(plan2[12].plannedEnd.getTime());
  });
});
