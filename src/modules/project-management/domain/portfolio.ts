import { startOfDay } from '@/core/utils/dates';

export interface ProgressTask {
  id?: string;
  parentId?: string | null;
  status: string;
  percentComplete: number;
  estimatedHours?: number;
}

/**
 * Single source of truth for overall project progress calculation.
 * Weighted by estimated effort on active leaf tasks.
 */
export function projectProgress(tasks: ProgressTask[]): number {
  const parentIds = new Set(tasks.map((t) => t.parentId).filter(Boolean));
  const leafTasks = tasks.filter((t) => !t.id || !parentIds.has(t.id));
  const activeLeaves = leafTasks.filter((t) => t.status !== 'CANCELLED');
  if (activeLeaves.length === 0) return 0;

  const totalWeight = activeLeaves.reduce((sum, t) => sum + Math.max(t.estimatedHours ?? 8, 1), 0);
  const completedWeight = activeLeaves.reduce((sum, t) => {
    const pct = t.status === 'COMPLETED' ? 100 : Math.max(0, Math.min(100, t.percentComplete || 0));
    return sum + (pct / 100) * Math.max(t.estimatedHours ?? 8, 1);
  }, 0);

  return Math.round((completedWeight / totalWeight) * 100);
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

export type HealthStatus = 'ON_TRACK' | 'AT_RISK' | 'LATE' | 'ON_HOLD' | 'COMPLETED';

/**
 * Computes deterministic project health.
 * - COMPLETED / ON_HOLD are lifecycle-fixed.
 * - LATE: forecast finish > target date, or target date passed with open tasks.
 * - AT_RISK: progress % < (time elapsed % - 15), or open roadblock, or stale approvals.
 * - ON_TRACK: otherwise.
 */
export function projectHealth(input: HealthInput): HealthStatus {
  if (input.status === 'COMPLETED') return 'COMPLETED';
  if (input.status === 'ON_HOLD') return 'ON_HOLD';

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

