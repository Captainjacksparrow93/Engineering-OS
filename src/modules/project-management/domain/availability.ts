import { overlapDays, startOfDay, workingDaysBetween } from '@/core/utils/dates';

/**
 * Capacity and availability model.
 *
 * The question higher management actually asks is "who can take this today?", which
 * needs three numbers per person: how many hours they have in the window, how many are
 * already committed, and how well they fit the work. Everything here is pure so the
 * numbers can be unit-tested and later swapped for HRMS shift data without touching
 * the callers.
 */

export interface CapacityWindow {
  from: Date;
  to: Date;
}

export interface WorkloadPerson {
  id: string;
  fullName: string;
  employeeCode: string;
  grade: string;
  designation: string | null;
  departmentId: string | null;
  departmentName: string | null;
  skills: string[];
  dailyCapacityHours: number;
  avatarColor: string;
}

export interface WorkloadAssignment {
  taskId: string;
  taskCode: string;
  taskTitle: string;
  projectId: string;
  projectCode: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  status: 'DRAFT' | 'BLOCKED' | 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'COMPLETED' | 'CANCELLED';
  allocatedHours: number;
  percentComplete: number;
  plannedStart: Date | null;
  plannedEnd: Date | null;
}

export interface LeavePeriod {
  startDate: Date;
  endDate: Date;
}

export type LoadStatus = 'FREE' | 'AVAILABLE' | 'BUSY' | 'OVERLOADED' | 'ON_LEAVE';

export interface Workload {
  person: WorkloadPerson;
  window: CapacityWindow;
  workingDays: number;
  leaveDays: number;
  capacityHours: number;
  committedHours: number;
  freeHours: number;
  utilizationPercent: number;
  status: LoadStatus;
  openTaskCount: number;
  criticalTaskCount: number;
  overdueTaskCount: number;
  assignments: WorkloadAssignment[];
}

const OPEN_STATUSES = new Set(['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'BLOCKED']);

/**
 * Hours an assignment consumes inside the window.
 *
 * Remaining effort is spread evenly across the task's planned working days and only
 * the days inside the window are counted - otherwise a 200-hour task planned for next
 * quarter would make someone look unavailable today.
 */
export function assignmentHoursInWindow(assignment: WorkloadAssignment, window: CapacityWindow): number {
  if (!OPEN_STATUSES.has(assignment.status)) return 0;

  const remainingFraction = Math.max(0, 1 - assignment.percentComplete / 100);
  const remainingHours = assignment.allocatedHours * remainingFraction;
  if (remainingHours <= 0) return 0;

  const start = assignment.plannedStart ? startOfDay(assignment.plannedStart) : startOfDay(window.from);
  const end = assignment.plannedEnd ? startOfDay(assignment.plannedEnd) : startOfDay(window.to);
  if (end < start) return remainingHours;

  const taskDays = Math.max(1, workingDaysBetween(start, end));
  const daysInWindow = overlapDays(start, end, startOfDay(window.from), startOfDay(window.to));

  // Overdue work does not disappear: if the plan ended before the window, the whole
  // remainder still sits on this person's plate right now.
  if (daysInWindow === 0) return end < startOfDay(window.from) ? remainingHours : 0;

  return (remainingHours / taskDays) * daysInWindow;
}

export function computeWorkload(
  person: WorkloadPerson,
  assignments: WorkloadAssignment[],
  leaves: LeavePeriod[],
  window: CapacityWindow,
): Workload {
  const workingDays = workingDaysBetween(window.from, window.to);
  const leaveDays = leaves.reduce(
    (sum, leave) => sum + overlapDays(startOfDay(leave.startDate), startOfDay(leave.endDate), startOfDay(window.from), startOfDay(window.to)),
    0,
  );
  const effectiveDays = Math.max(0, workingDays - leaveDays);
  const capacityHours = round(effectiveDays * person.dailyCapacityHours);

  const open = assignments.filter((a) => OPEN_STATUSES.has(a.status));
  const committedHours = round(open.reduce((sum, a) => sum + assignmentHoursInWindow(a, window), 0));
  const freeHours = round(capacityHours - committedHours);
  const utilizationPercent = capacityHours <= 0 ? 100 : Math.round((committedHours / capacityHours) * 100);

  const today = startOfDay(new Date());
  const overdueTaskCount = open.filter((a) => a.plannedEnd && startOfDay(a.plannedEnd) < today).length;

  return {
    person,
    window,
    workingDays,
    leaveDays,
    capacityHours,
    committedHours,
    freeHours,
    utilizationPercent,
    status: loadStatus(utilizationPercent, effectiveDays),
    openTaskCount: open.length,
    criticalTaskCount: open.filter((a) => a.priority === 'CRITICAL').length,
    overdueTaskCount,
    assignments: open,
  };
}

function loadStatus(utilization: number, effectiveDays: number): LoadStatus {
  if (effectiveDays === 0) return 'ON_LEAVE';
  if (utilization <= 25) return 'FREE';
  if (utilization <= 75) return 'AVAILABLE';
  if (utilization <= 100) return 'BUSY';
  return 'OVERLOADED';
}

export interface AssignmentSuggestion {
  workload: Workload;
  /** 0-100. Higher is a better candidate for this specific piece of work. */
  score: number;
  skillMatch: number;
  matchedSkills: string[];
  missingSkills: string[];
  reasons: string[];
}

/**
 * Ranks people for a task.
 *
 * Weighting is deliberate: spare capacity dominates (60), because the whole point of
 * the board is to find someone who can actually start; skill fit is next (30) so work
 * does not land on someone who will need a week to ramp up; a small grade-fit term (10)
 * keeps critical work off trainees and stops seniors being buried in routine work.
 */
export function rankCandidates(
  workloads: Workload[],
  options: { requiredSkills?: string[]; requiredHours?: number; priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' } = {},
): AssignmentSuggestion[] {
  const required = (options.requiredSkills ?? []).map((s) => s.toLowerCase().trim()).filter(Boolean);
  const requiredHours = options.requiredHours ?? 0;
  const priority = options.priority ?? 'MEDIUM';

  return workloads
    .map((workload) => {
      const personSkills = workload.person.skills.map((s) => s.toLowerCase().trim());
      const matched = required.filter((s) => personSkills.includes(s));
      const missing = required.filter((s) => !personSkills.includes(s));
      const skillMatch = required.length === 0 ? 1 : matched.length / required.length;

      const capacityScore = capacityFit(workload, requiredHours);
      const gradeScore = gradeFit(workload.person.grade, priority);
      const score = Math.round(capacityScore * 60 + skillMatch * 30 + gradeScore * 10);

      const reasons: string[] = [];
      if (workload.status === 'ON_LEAVE') reasons.push('On leave for the whole window');
      else if (workload.freeHours >= requiredHours && requiredHours > 0) reasons.push(`${workload.freeHours}h free, needs ${requiredHours}h`);
      else if (requiredHours > 0) reasons.push(`Short by ${round(requiredHours - workload.freeHours)}h`);
      if (matched.length) reasons.push(`Skills: ${matched.join(', ')}`);
      if (missing.length) reasons.push(`Missing: ${missing.join(', ')}`);
      if (workload.overdueTaskCount > 0) reasons.push(`${workload.overdueTaskCount} overdue task(s)`);
      if (workload.criticalTaskCount > 0) reasons.push(`${workload.criticalTaskCount} critical task(s) in hand`);

      return {
        workload,
        score: Math.max(0, Math.min(100, score)),
        skillMatch: Math.round(skillMatch * 100),
        matchedSkills: matched,
        missingSkills: missing,
        reasons,
      };
    })
    .sort((a, b) => b.score - a.score || a.workload.utilizationPercent - b.workload.utilizationPercent);
}

function capacityFit(workload: Workload, requiredHours: number): number {
  if (workload.status === 'ON_LEAVE') return 0;
  if (requiredHours <= 0) return Math.max(0, 1 - workload.utilizationPercent / 120);
  if (workload.freeHours <= 0) return 0;
  const ratio = workload.freeHours / requiredHours;
  // Comfortably free is best; barely-enough still counts, wildly idle is not extra good.
  return Math.max(0, Math.min(1, ratio));
}

const GRADE_RANK: Record<string, number> = {
  TRAINEE: 1,
  JUNIOR_ENGINEER: 2,
  ENGINEER: 3,
  SENIOR_ENGINEER: 4,
  LEAD_ENGINEER: 5,
  MANAGER: 6,
  HEAD: 7,
  DIRECTOR: 8,
};

const PRIORITY_TARGET_GRADE: Record<string, number> = {
  LOW: 2,
  MEDIUM: 3,
  HIGH: 4,
  CRITICAL: 5,
};

function gradeFit(grade: string, priority: string): number {
  const rank = GRADE_RANK[grade] ?? 3;
  const target = PRIORITY_TARGET_GRADE[priority] ?? 3;
  const distance = Math.abs(rank - target);
  return Math.max(0, 1 - distance / 4);
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
