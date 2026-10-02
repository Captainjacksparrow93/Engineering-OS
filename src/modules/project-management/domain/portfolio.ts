import { addDays, addWorkingDays, startOfDay, todayInIndia, workingDaysBetween } from '@/core/utils/dates';

export interface ForecastStep {
  parentId?: string | null;
  status: string;
  plannedEnd?: Date | string | null;
}

/**
 * Realistic finish date. Steps in one lane (same parent phase) run in sequence, so an
 * open step that is N working days past its planned end pushes the rest of that lane back
 * by N working days. Lanes run in parallel; the project finishes with its latest lane.
 * Never earlier than the target date (an early plan is still reported against target).
 */
export function forecastFinish(steps: ForecastStep[], targetEndDate: Date | string, today: Date): Date {
  const lanes = new Map<string, { end: Date; slip: number }>();
  for (const step of steps) {
    if (!step.plannedEnd) continue;
    const end = startOfDay(new Date(step.plannedEnd));
    const key = step.parentId ?? '';
    const lane = lanes.get(key) ?? { end, slip: 0 };
    if (end > lane.end) lane.end = end;
    const open = step.status !== 'COMPLETED' && step.status !== 'CANCELLED';
    if (open && end < today) {
      lane.slip = Math.max(lane.slip, workingDaysBetween(addDays(end, 1), today));
    }
    lanes.set(key, lane);
  }

  let forecast = startOfDay(new Date(targetEndDate));
  for (const lane of lanes.values()) {
    const laneFinish = lane.slip > 0 ? addWorkingDays(lane.end, lane.slip) : lane.end;
    if (laneFinish > forecast) forecast = laneFinish;
  }
  return forecast;
}

/** Calendar days a project is late: forecast past target, or target already passed. */
export function daysLate(forecast: Date, targetEndDate: Date | string, today: Date, health: string): number {
  const dayMs = 86400000;
  const target = startOfDay(new Date(targetEndDate)).getTime();
  const byForecast = Math.round((startOfDay(forecast).getTime() - target) / dayMs);
  if (byForecast > 0) return byForecast;
  return health === 'LATE' ? Math.max(1, Math.round((today.getTime() - target) / dayMs)) : 0;
}

/**
 * A lane is late when it has open steps and either today is past its delivery date
 * or the lane's forecast finish is past its delivery date.
 */
export function isLaneLate(
  steps: ForecastStep[],
  deliveryDate: Date | string | null | undefined,
  today: Date = todayInIndia(),
): boolean {
  if (!deliveryDate) return false;
  const hasOpenSteps = steps.some((s) => s.status !== 'COMPLETED' && s.status !== 'CANCELLED');
  if (!hasOpenSteps) return false;

  const target = startOfDay(new Date(deliveryDate));
  const todayStart = startOfDay(today);
  if (todayStart.getTime() > target.getTime()) return true;

  const forecast = forecastFinish(steps, target, today);
  return forecast.getTime() > target.getTime();
}

export interface ProgressTask {
  id?: string;
  parentId?: string | null;
  type?: string;
  status: string;
  percentComplete: number;
  estimatedHours?: number;
  actualHours?: number;
  plannedEnd?: Date | string | null;
  isBlocked?: boolean;
}

/**
 * Filter tasks to active (non-cancelled) leaf tasks.
 * Excludes parent tasks and PHASE container nodes.
 */
export function activeLeafTasks<T extends { id?: string; parentId?: string | null; type?: string; status: string }>(tasks: T[]): T[] {
  const parentIds = new Set(tasks.map((t) => t.parentId).filter(Boolean) as string[]);
  return tasks.filter((t) => t.status !== 'CANCELLED' && t.type !== 'PHASE' && (!t.id || !parentIds.has(t.id)));
}

/**
 * Single source of truth for overall project progress calculation.
 * Weighted by estimated effort on active leaf tasks.
 */
export function projectProgress(tasks: ProgressTask[]): number {
  const activeLeaves = activeLeafTasks(tasks);
  if (activeLeaves.length === 0) return 0;

  const totalWeight = activeLeaves.reduce((sum, t) => sum + Math.max(t.estimatedHours ?? 8, 1), 0);
  const completedWeight = activeLeaves.reduce((sum, t) => {
    const pct = t.status === 'COMPLETED' ? 100 : Math.max(0, Math.min(100, t.percentComplete || 0));
    return sum + (pct / 100) * Math.max(t.estimatedHours ?? 8, 1);
  }, 0);

  return Math.round((completedWeight / totalWeight) * 100);
}

export interface ProjectStepStats {
  taskCount: number;
  completedCount: number;
  blockedCount: number;
  openCount: number;
  overdueCount: number;
  estimatedHours: number;
  actualHours: number;
  progressPercent: number;
}

/**
 * Computes consistent step counts and progress for project workspaces and project lists.
 * Every step count strictly reflects active (non-cancelled) leaf tasks.
 */
export function projectStepStats(tasks: ProgressTask[], asOfDate: Date = new Date()): ProjectStepStats {
  const leaves = activeLeafTasks(tasks);
  const total = leaves.length;
  const completed = leaves.filter((t) => t.status === 'COMPLETED').length;
  const blocked = leaves.filter((t) => t.status === 'BLOCKED' || Boolean(t.isBlocked)).length;
  const open = leaves.filter((t) => t.status !== 'COMPLETED');
  const now = asOfDate.getTime();
  const overdue = open.filter((t) => t.plannedEnd && new Date(t.plannedEnd).getTime() < now).length;
  const estimated = leaves.reduce((sum, t) => sum + (t.estimatedHours ?? 0), 0);
  const actual = leaves.reduce((sum, t) => sum + (t.actualHours ?? 0), 0);
  const progressPercent = projectProgress(tasks);

  return {
    taskCount: total,
    completedCount: completed,
    blockedCount: blocked,
    openCount: open.length,
    overdueCount: overdue,
    estimatedHours: Math.round(estimated),
    actualHours: Math.round(actual),
    progressPercent,
  };
}

export interface HealthInput {
  status: string;
  startDate: Date | string;
  targetEndDate: Date | string;
  forecastEndDate?: Date | string | null;
  progressPercent: number;
  hasOpenRoadblock?: boolean;
  hasStaleApprovals?: boolean; // Approvals waiting > 2 days
  asOfDate?: Date;
}

export type HealthStatus = 'ON_TRACK' | 'AT_RISK' | 'LATE' | 'ON_HOLD' | 'COMPLETED' | 'COMMISSIONING';

/**
 * Computes deterministic project health.
 * - COMPLETED / CLOSED / ON_HOLD / COMMISSIONING are lifecycle-fixed.
 * - LATE: forecast finish > target date, or target date passed with open tasks.
 * - AT_RISK: progress % < (time elapsed % - 15), or open roadblock, or stale approvals.
 * - ON_TRACK: otherwise.
 */
export function projectHealth(input: HealthInput): HealthStatus {
  if (input.status === 'COMPLETED' || input.status === 'CLOSED') return 'COMPLETED';
  if (input.status === 'ON_HOLD') return 'ON_HOLD';
  if (input.status === 'COMMISSIONING') return 'COMMISSIONING';

  const today = input.asOfDate ? startOfDay(input.asOfDate) : startOfDay(new Date());
  const start = startOfDay(new Date(input.startDate));
  const targetEnd = startOfDay(new Date(input.targetEndDate));
  const forecastEnd = input.forecastEndDate ? startOfDay(new Date(input.forecastEndDate)) : targetEnd;

  // Check if late
  if (forecastEnd > targetEnd || (today > targetEnd && input.progressPercent < 100)) {
    return 'LATE';
  }

  // Calculate elapsed percentage of planned schedule
  const totalDurationMs = Math.max(targetEnd.getTime() - start.getTime(), 86400000);
  const elapsedMs = Math.max(0, today.getTime() - start.getTime());
  const timeElapsedPercent = Math.min(100, Math.round((elapsedMs / totalDurationMs) * 100));

  // Check if at risk
  if (
    input.progressPercent < timeElapsedPercent - 15 ||
    Boolean(input.hasOpenRoadblock) ||
    Boolean(input.hasStaleApprovals)
  ) {
    return 'AT_RISK';
  }

  return 'ON_TRACK';
}

export function timeElapsedPercent(
  startDate: Date | string | null | undefined,
  targetEndDate: Date | string | null | undefined,
  asOfDate: Date = new Date()
): number {
  if (!startDate || !targetEndDate) return 0;
  const start = startOfDay(new Date(startDate)).getTime();
  const end = startOfDay(new Date(targetEndDate)).getTime();
  const today = startOfDay(asOfDate).getTime();

  if (end <= start) return 100;
  if (today <= start) return 0;
  if (today >= end) return 100;

  return Math.min(100, Math.max(0, Math.round(((today - start) / (end - start)) * 100)));
}


export interface TypeCounts {
  PLC: number;
  SCADA: number;
  HMI: number;
  onHold: number;
}

const ACTIVE_STATUSES = new Set(['DRAFT', 'PLANNING', 'IN_PROGRESS']);

/**
 * Dashboard type cards. PLC / SCADA / HMI count active projects (a PLC + HMI project counts
 * in both); on-hold projects count only in On hold; completed and cancelled count nowhere.
 */
export function countByAutomationType(projects: Array<{ status: string; automationTypes: string[] }>): TypeCounts {
  const counts: TypeCounts = { PLC: 0, SCADA: 0, HMI: 0, onHold: 0 };
  for (const project of projects) {
    if (project.status === 'ON_HOLD') {
      counts.onHold += 1;
      continue;
    }
    if (!ACTIVE_STATUSES.has(project.status)) continue;
    for (const type of new Set(project.automationTypes)) {
      if (type === 'PLC' || type === 'SCADA' || type === 'HMI') counts[type] += 1;
    }
  }
  return counts;
}
