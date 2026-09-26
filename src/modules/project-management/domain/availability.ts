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
  projectName?: string;
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
  group?: string;
  needsApproval?: boolean;
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

export const GRADE_RANK: Record<string, number> = {
  TRAINEE: 1,
  JUNIOR_ENGINEER: 2,
  ENGINEER: 3,
  SENIOR_ENGINEER: 4,
  LEAD_ENGINEER: 5,
  MANAGER: 6,
  HEAD: 7,
  DIRECTOR: 8,
};

export const TARGET_RANK: Record<string, number> = {
  JUNIOR: 2, // JUNIOR_ENGINEER
  SENIOR: 4, // SENIOR_ENGINEER
  ASST_MANAGER: 5, // LEAD_ENGINEER
};

export function gradeFloor(recommendedSeniority: string): number {
  const target = TARGET_RANK[recommendedSeniority] ?? 2;
  return Math.max(1, target - 1);
}

export interface SmartCandidate {
  id: string;
  fullName: string;
  employeeCode: string;
  grade: string;
  designation?: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | string;
  freeHours: number;
  totalCapacityHours: number;
  workingDays: number;
  leaveDays: number;
  leaves: LeavePeriod[];
}

export interface SmartStepRequirement {
  id: string;
  stepNumber: number;
  templateInstanceId?: string;
  name: string;
  recommendedSeniority: 'JUNIOR' | 'SENIOR' | 'ASST_MANAGER' | string;
  estimatedHours: number;
  plannedStart: Date;
  plannedEnd: Date;
}

export interface SmartStepAllocation {
  stepId: string;
  assignedUserId: string | null;
  assignedUserName: string | null;
  score: number;
  factorBreakdown: { M: number; A: number; C: number; Q: number };
  escalationRung: number;
  rationale: string;
  isWeakMatch: boolean;
}

export function isCandidateOnHeavyLeave(candidate: SmartCandidate, step: SmartStepRequirement): boolean {
  const stepWorkingDays = Math.max(1, workingDaysBetween(step.plannedStart, step.plannedEnd));
  const stepLeaveDays = (candidate.leaves || []).reduce(
    (sum, leave) =>
      sum +
      overlapDays(
        startOfDay(leave.startDate),
        startOfDay(leave.endDate),
        startOfDay(step.plannedStart),
        startOfDay(step.plannedEnd),
      ),
    0,
  );
  return stepLeaveDays / stepWorkingDays > 0.5;
}

/**
 * People who execute checklist steps: not PMs, assistant managers, heads or directors.
 * Shared by auto-assign and the dashboards so "free engineers" means the same pool everywhere.
 * ponytail: grade/designation based until role-based candidate pools land (audit round 2, step 4).
 */
export function isExecutionStaff(person: { grade: string; designation?: string | null }): boolean {
  if (['MANAGER', 'HEAD', 'DIRECTOR'].includes(person.grade)) return false;
  return !(person.designation && /manager|asst/i.test(person.designation));
}

export function applyHardRules(candidate: SmartCandidate, step: SmartStepRequirement): boolean {
  // H5: Inactive account
  if (candidate.status !== 'ACTIVE') return false;

  // H4: Exclude PMs / Assistant Managers / Directors / Upper management from task execution
  if (!isExecutionStaff(candidate)) return false;

  // H1: Approved leave covering >50% of the task's working days
  if (isCandidateOnHeavyLeave(candidate, step)) return false;

  // H2: Grade rank below the step's floor
  const rank = GRADE_RANK[candidate.grade] ?? 1;
  const floor = gradeFloor(step.recommendedSeniority);
  if (rank < floor) return false;

  // H3: Non-zero free hours across the window
  if (candidate.freeHours <= 0) return false;

  return true;
}

export interface AllocationContext {
  pmSquadUserIds: Set<string>;
  assignedSteps: Array<{
    stepId: string;
    stepNumber: number;
    templateInstanceId?: string;
    userId: string;
  }>;
  /** Max steps each candidate should take in this run before others of the same grade. */
  fairShare?: Map<string, number>;
}

/** Score points removed once a candidate already holds their fair share of steps. */
const OVER_SHARE_PENALTY = 30;

export function scoreForStep(
  candidate: SmartCandidate,
  step: SmartStepRequirement,
  context: AllocationContext,
): { score: number; breakdown: { M: number; A: number; C: number; Q: number } } {
  const rank = GRADE_RANK[candidate.grade] ?? 2;
  const target = TARGET_RANK[step.recommendedSeniority] ?? 2;

  // M — Grade fit (40%): exact match is 100, senior doing junior task is 75 (prefers junior for junior tasks)
  let M = 0;
  if (rank >= target) {
    M = rank === target ? 100 : 75;
  } else {
    M = 100 * Math.max(0, 1 - (target - rank) / 2);
  }

  // A — Availability (35%)
  // No window-wide "thin capacity" penalty: it halved the only junior's score after a few
  // steps and pushed junior steps onto seniors. Load spreading is handled by fairShare.
  const required = Math.max(1, step.estimatedHours);
  const free = Math.max(0, candidate.freeHours);
  const A = 100 * Math.min(1, free / (required * 1.5));

  // C — Context Continuity (10%)
  const sameTemplateAssigned = context.assignedSteps.filter(
    (s) => s.templateInstanceId === step.templateInstanceId && s.userId === candidate.id,
  );
  let C = 0;
  if (sameTemplateAssigned.some((s) => Math.abs(s.stepNumber - step.stepNumber) === 1)) {
    C = 40;
  } else if (sameTemplateAssigned.length > 0) {
    C = 20;
  }

  // Q — Squad integrity (15%)
  const Q = context.pmSquadUserIds.has(candidate.id) ? 100 : 0;

  // Load balance: once someone holds their fair share, peers of the same grade go first.
  // Continuity (max 4 points) keeps consecutive steps together only within that share.
  const share = context.fairShare?.get(candidate.id);
  const held = context.assignedSteps.filter((s) => s.userId === candidate.id).length;
  const overShare = share !== undefined && held >= share ? OVER_SHARE_PENALTY : 0;

  const score = Math.round(0.4 * M + 0.35 * A + 0.1 * C + 0.15 * Q) - overShare;

  return {
    score: Math.max(0, Math.min(100, score)),
    breakdown: {
      M: Math.round(M),
      A: Math.round(A),
      C: Math.round(C),
      Q: Math.round(Q),
    },
  };
}

function buildDeterministicRationale(
  candidate: SmartCandidate,
  step: SmartStepRequirement,
  score: number,
  breakdown: { M: number; A: number; C: number; Q: number },
  inSquad: boolean,
): string {
  const rank = GRADE_RANK[candidate.grade] ?? 2;
  const target = TARGET_RANK[step.recommendedSeniority] ?? 2;
  const gradeText = rank === target ? 'exact grade match' : rank > target ? 'senior qualified' : 'grade floor match';
  const hoursPerDay = (candidate.freeHours / Math.max(1, candidate.workingDays)).toFixed(1);
  const squadText = inSquad ? "in PM's squad" : 'cross-squad';
  const contText = breakdown.C > 0 ? ', continues adjacent step' : '';

  return `${score}% · ${gradeText}, ${hoursPerDay}h/day free${contText}, ${squadText}`;
}

/**
 * How many steps each candidate should take before same-grade peers get priority:
 * steps meant for their grade split evenly across the peers of that grade (PM squad
 * first, else everyone eligible). 5 senior steps and 4 seniors -> 2 each, so work
 * spreads in small consecutive blocks instead of all landing on the first winner.
 */
export function computeFairShare(
  candidates: SmartCandidate[],
  steps: SmartStepRequirement[],
  pmSquadUserIds: Set<string>,
): Map<string, number> {
  const workers = candidates.filter((c) => c.status === 'ACTIVE' && !['MANAGER', 'HEAD', 'DIRECTOR'].includes(c.grade));
  const squad = workers.filter((c) => pmSquadUserIds.has(c.id));
  const pool = squad.length > 0 ? squad : workers;

  const share = new Map<string, number>();
  if (pool.length === 0 || steps.length === 0) return share;
  const overall = Math.ceil(steps.length / pool.length);

  for (const c of workers) {
    const rank = GRADE_RANK[c.grade] ?? 2;
    const peers = pool.filter((p) => (GRADE_RANK[p.grade] ?? 2) === rank).length;
    const stepsForGrade = steps.filter((s) => (TARGET_RANK[s.recommendedSeniority] ?? 2) === rank).length;
    share.set(c.id, peers > 0 && stepsForGrade > 0 ? Math.ceil(stepsForGrade / peers) : overall);
  }
  return share;
}

/**
 * Sequential, capacity-consuming team allocation across project steps.
 */
export function allocateTeamForSteps(
  rawCandidates: SmartCandidate[],
  steps: SmartStepRequirement[],
  pmSquadUserIds: Set<string> = new Set(),
): SmartStepAllocation[] {
  // Deep copy candidates so capacity decrementing is scoped to this run
  const candidates: SmartCandidate[] = rawCandidates.map((c) => ({
    ...c,
    leaves: [...(c.leaves || [])],
  }));

  const assignedSteps: Array<{
    stepId: string;
    stepNumber: number;
    templateInstanceId?: string;
    userId: string;
  }> = [];

  const results: SmartStepAllocation[] = [];
  const fairShare = computeFairShare(candidates, steps, pmSquadUserIds);

  // Team isolation: with a PM team given, only that team is ever considered.
  const teamOnly = pmSquadUserIds.size > 0;
  const inScope = (c: SmartCandidate) => !teamOnly || pmSquadUserIds.has(c.id);

  for (const step of steps) {
    let eligible = candidates.filter((c) => inScope(c) && applyHardRules(c, step));
    let escalationRung = 0;

    // Escalation ladder if no candidate passed standard Layer 1
    if (eligible.length === 0) {
      // Rung 3: Accept candidate at grade floor short on hours (freeHours > 0)
      const floorQualified = candidates.filter(
        (c) =>
          inScope(c) &&
          c.status === 'ACTIVE' &&
          !['MANAGER', 'HEAD', 'DIRECTOR'].includes(c.grade) &&
          (GRADE_RANK[c.grade] ?? 1) >= gradeFloor(step.recommendedSeniority) &&
          !isCandidateOnHeavyLeave(c, step),
      );
      if (floorQualified.length > 0) {
        eligible = floorQualified;
        escalationRung = 3;
      }
    }

    if (eligible.length === 0) {
      results.push({
        stepId: step.id,
        assignedUserId: null,
        assignedUserName: null,
        score: 0,
        factorBreakdown: { M: 0, A: 0, C: 0, Q: 0 },
        escalationRung: 4,
        rationale: teamOnly
          ? "No one in the PM's team is free for this step"
          : 'No eligible engineer available — needs Department Head decision',
        isWeakMatch: true,
      });
      continue;
    }

    const pool = eligible;

    const scored = pool.map((candidate) => {
      const { score, breakdown } = scoreForStep(candidate, step, {
        pmSquadUserIds,
        assignedSteps,
        fairShare,
      });
      return { candidate, score, breakdown };
    });

    // Deterministic tie-breaking: score desc -> freeHours desc -> employeeCode asc
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.candidate.freeHours !== a.candidate.freeHours) return b.candidate.freeHours - a.candidate.freeHours;
      return a.candidate.employeeCode.localeCompare(b.candidate.employeeCode);
    });

    const winner = scored[0];
    winner.candidate.freeHours -= step.estimatedHours;
    assignedSteps.push({
      stepId: step.id,
      stepNumber: step.stepNumber,
      templateInstanceId: step.templateInstanceId,
      userId: winner.candidate.id,
    });

    const isWeak = winner.score < 40 || escalationRung > 0;
    const inSquad = pmSquadUserIds.has(winner.candidate.id);
    const rationale = buildDeterministicRationale(winner.candidate, step, winner.score, winner.breakdown, inSquad);

    results.push({
      stepId: step.id,
      assignedUserId: winner.candidate.id,
      assignedUserName: winner.candidate.fullName,
      score: winner.score,
      factorBreakdown: winner.breakdown,
      escalationRung,
      rationale,
      isWeakMatch: isWeak,
    });
  }

  return results;
}

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
