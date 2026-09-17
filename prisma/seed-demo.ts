/**
 * Demo projects that exercise every dashboard, timeline and workflow state.
 *
 *   npm run db:seed:demo
 *
 * Never deletes or rebuilds anything: if any DEMO-* project already exists, the script
 * exits without changes. Dates are relative to the day it first runs (India time).
 * Requires the main seed (people, roles, checklist templates) to have run first.
 *
 * What each project shows:
 *   DEMO-01  On track        PLC x1  - steps approved on time, a problem reported and solved
 *   DEMO-02  Late            SCADA x1 - a step 3 working days overdue pushes the forecast past target; one send-back
 *   DEMO-03  At risk         HMI x1  - an open problem blocks a step
 *   DEMO-04  At risk         PLC x2  - 2-day steps; a review waiting 3 days (stale approval); one send-back
 *   DEMO-05  Two lanes       PLC x1 + HMI x1 in parallel - fresh approval, stale + fresh reassign requests, overloaded engineer
 *   DEMO-06  On hold         SCADA x1 - pending project handover (PM -> PM)
 *   DEMO-07  Completed       HMI x1  - all 13 steps approved
 *   DEMO-08  Planning        PLC x1  - starts next week, delivery inside the 30-day window
 * Plus: approved leave for Het Patel (team load "on leave"), notifications for Parth and Paras.
 */
import type { AssignmentStatus, ProjectStatus, TaskStatus } from '@prisma/client';
import { prisma } from '../src/core/db/prisma';
import { addDays, addWorkingDays, isWorkingDay, todayInIndia } from '../src/core/utils/dates';
import { recomputeTaskDerivedState } from '../src/modules/project-management/services/task.service';
import { planLaneByHours } from '../src/modules/project-management/domain/scheduling';

type StepState =
  | { state: 'approved'; lateDays?: number; sentBackDaysAgo?: number; problemSolvedDaysAgo?: number }
  | { state: 'review'; submittedDaysAgo: number }
  | { state: 'progress'; percent: number }
  | { state: 'problem'; percent: number; blocker: string; daysAgo: number }
  | { state: 'todo' };

interface LaneSpec {
  template: 'PLC' | 'SCADA' | 'HMI';
  /** Panels in this package: every step takes defaultDurationHours x quantity. */
  quantity: number;
  /** Step number -> state. Unlisted steps are 'todo'. */
  steps: Record<number, StepState>;
  /** Step number -> employee code, overriding the default squad rotation. */
  assignees?: Record<number, string>;
}

interface ProjectSpec {
  code: string;
  name: string;
  client: string;
  pm: string;
  status: ProjectStatus;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  orderValue: number;
  /** Project start, in working days relative to today (negative = in the past). */
  startWd: number;
  /** Target date = last planned step end + this many working days. */
  bufferWd: number;
  lanes: LaneSpec[];
}

const PARTH = 'ACS-0063';
const PARAS = 'ACS-0074';
const DIRECTOR = 'ACS-0001';

const SQUADS: Record<string, { senior: string[]; junior: string[] }> = {
  [PARTH]: { senior: ['ACS-0064', 'ACS-0068', 'ACS-0069', 'ACS-0071'], junior: ['ACS-0065', 'ACS-0066', 'ACS-0067', 'ACS-0072'] },
  [PARAS]: { senior: ['ACS-0076', 'ACS-0077', 'ACS-0078', 'ACS-0079', 'ACS-0081'], junior: ['ACS-0080', 'ACS-0082', 'ACS-0083'] },
};

const approvedThrough = (n: number, extra: Record<number, StepState> = {}): Record<number, StepState> => {
  const steps: Record<number, StepState> = {};
  for (let i = 1; i <= n; i += 1) steps[i] = { state: 'approved' };
  return { ...steps, ...extra };
};

const SHIVAM = 'ACS-0064';

const PROJECTS: ProjectSpec[] = [
  {
    code: 'DEMO-01', name: 'Demo · Reliance Petro - PLC Automation', client: 'Reliance Petrochem', pm: PARTH,
    status: 'IN_PROGRESS', priority: 'MEDIUM', orderValue: 7_500_000, startWd: -4, bufferWd: 3,
    lanes: [{
      template: 'PLC', quantity: 1,
      steps: approvedThrough(4, { 3: { state: 'approved', problemSolvedDaysAgo: 3 }, 5: { state: 'progress', percent: 50 } }),
      assignees: { 5: SHIVAM, 6: SHIVAM, 7: SHIVAM, 8: SHIVAM },
    }],
  },
  {
    code: 'DEMO-02', name: 'Demo · UltraTech - SCADA Automation', client: 'UltraTech Cement', pm: PARAS,
    status: 'IN_PROGRESS', priority: 'HIGH', orderValue: 12_000_000, startWd: -8, bufferWd: 0,
    lanes: [{
      template: 'SCADA', quantity: 1,
      steps: approvedThrough(5, { 4: { state: 'approved', lateDays: 1 }, 5: { state: 'approved', sentBackDaysAgo: 4 }, 6: { state: 'progress', percent: 60 } }),
    }],
  },
  {
    code: 'DEMO-03', name: 'Demo · Amul Dairy - HMI Automation', client: 'Amul Dairy', pm: PARTH,
    status: 'IN_PROGRESS', priority: 'MEDIUM', orderValue: 4_200_000, startWd: -3, bufferWd: 4,
    lanes: [{
      template: 'HMI', quantity: 1,
      steps: approvedThrough(3, { 4: { state: 'problem', percent: 30, blocker: 'Client has not approved the revised P&ID yet', daysAgo: 2 } }),
    }],
  },
  {
    code: 'DEMO-04', name: 'Demo · Tata Power - PLC Automation (2 panels)', client: 'Tata Power', pm: PARAS,
    status: 'IN_PROGRESS', priority: 'HIGH', orderValue: 18_500_000, startWd: -6, bufferWd: 4,
    lanes: [{
      template: 'PLC', quantity: 2,
      steps: approvedThrough(2, { 2: { state: 'approved', sentBackDaysAgo: 5 }, 3: { state: 'review', submittedDaysAgo: 3 } }),
    }],
  },
  {
    code: 'DEMO-05', name: 'Demo · Adani Ports - PLC + HMI Automation', client: 'Adani Ports', pm: PARTH,
    status: 'IN_PROGRESS', priority: 'CRITICAL', orderValue: 22_000_000, startWd: -2, bufferWd: 5,
    lanes: [
      {
        template: 'PLC', quantity: 1,
        steps: approvedThrough(2, { 3: { state: 'progress', percent: 30 } }),
        assignees: { 3: SHIVAM, 4: SHIVAM, 5: SHIVAM, 6: SHIVAM, 7: SHIVAM },
      },
      {
        template: 'HMI', quantity: 1,
        steps: approvedThrough(1, { 2: { state: 'review', submittedDaysAgo: 0 } }),
      },
    ],
  },
  {
    code: 'DEMO-06', name: 'Demo · JSW Steel - SCADA Automation', client: 'JSW Steel', pm: PARAS,
    status: 'ON_HOLD', priority: 'LOW', orderValue: 6_800_000, startWd: -10, bufferWd: 5,
    lanes: [{ template: 'SCADA', quantity: 1, steps: approvedThrough(6) }],
  },
  {
    code: 'DEMO-07', name: 'Demo · Asian Paints - HMI Automation', client: 'Asian Paints', pm: PARTH,
    status: 'COMPLETED', priority: 'MEDIUM', orderValue: 3_900_000, startWd: -18, bufferWd: 2,
    lanes: [{ template: 'HMI', quantity: 1, steps: approvedThrough(13) }],
  },
  {
    code: 'DEMO-08', name: 'Demo · L&T Hydro - PLC Automation', client: 'Larsen & Toubro', pm: PARAS,
    status: 'PLANNING', priority: 'MEDIUM', orderValue: 9_600_000, startWd: 4, bufferWd: 2,
    lanes: [{ template: 'PLC', quantity: 1, steps: {} }],
  },
];

const today = todayInIndia();
/** A working day `n` working days from today (n may be negative). */
const wd = (n: number) => {
  let base = today;
  while (!isWorkingDay(base)) base = addDays(base, 1);
  return addWorkingDays(base, n);
};
/** A timestamp on a calendar date, at an IST-friendly time of day. */
const at = (date: Date, hourUtc: number) => new Date(date.getTime() + hourUtc * 3600000);
const daysAgo = (n: number, hourUtc = 6) => at(addDays(today, -n), hourUtc);

async function main() {
  const existing = await prisma.project.count({ where: { code: { startsWith: 'DEMO-' } } });
  if (existing > 0) {
    console.log(`Demo data already present (${existing} DEMO-* projects). Nothing changed.`);
    return;
  }

  const people = await prisma.user.findMany({ select: { id: true, employeeCode: true, fullName: true, companyId: true, departmentId: true } });
  const user = (code: string) => {
    const found = people.find((p) => p.employeeCode === code);
    if (!found) throw new Error(`Run the main seed first: user ${code} not found.`);
    return found;
  };
  const templates = await prisma.checklistTemplate.findMany({ include: { items: { orderBy: { stepNumber: 'asc' } } } });
  const pmRole = await prisma.role.findUnique({ where: { key: 'PROJECT_MANAGER' } });
  if (templates.length === 0 || !pmRole) throw new Error('Run the main seed first: checklist templates or roles missing.');

  const director = user(DIRECTOR);
  const created: Array<{ code: string; id: string }> = [];

  for (const spec of PROJECTS) {
    const pm = user(spec.pm);
    const squad = SQUADS[spec.pm]!;
    const projectStart = wd(spec.startWd);

    // Plan every lane first so the target date can follow the longest lane.
    const lanes = spec.lanes.map((lane) => {
      const template = templates.find((t) => t.code === lane.template)!;
      const hoursList = template.items.map((item) => item.defaultDurationHours * lane.quantity);
      const plan = planLaneByHours(hoursList, projectStart);
      const steps = template.items.map((item, idx) => ({
        item,
        hours: hoursList[idx]!,
        plannedStart: plan[idx]!.plannedStart,
        plannedEnd: plan[idx]!.plannedEnd,
        spec: lane.steps[item.stepNumber] ?? ({ state: 'todo' } as StepState),
      }));
      return { lane, template, steps };
    });
    const lastEnd = lanes.flatMap((l) => l.steps).reduce((max, s) => (s.plannedEnd > max ? s.plannedEnd : max), projectStart);
    const targetEndDate = addWorkingDays(lastEnd, spec.bufferWd);

    const project = await prisma.project.create({
      data: {
        companyId: pm.companyId,
        code: spec.code,
        name: spec.name,
        clientName: spec.client,
        description: 'Demo project generated by prisma/seed-demo.ts.',
        poNumber: `PO-${spec.code}`,
        orderValue: spec.orderValue,
        panelType: spec.lanes.map((l) => `${l.template} x${l.quantity}`).join(' + '),
        panelCount: spec.lanes.reduce((sum, l) => sum + l.quantity, 0),
        automationTypes: [...new Set(spec.lanes.map((l) => l.template))],
        status: spec.status,
        priority: spec.priority,
        startDate: projectStart,
        targetEndDate,
        managerId: pm.id,
        sponsorId: director.id,
        departmentId: pm.departmentId,
      },
    });
    created.push({ code: spec.code, id: project.id });

    await prisma.roleAssignment.create({
      data: { userId: pm.id, roleId: pmRole.id, scopeType: 'PROJECT', scopeId: project.id, grantedBy: director.id },
    });
    const memberIds = new Set<string>([pm.id]);

    let taskCounter = 1;
    let laneIndex = 1;
    let latestApproval: Date | null = null;

    for (const { lane, template, steps } of lanes) {
      const phase = await prisma.task.create({
        data: {
          projectId: project.id,
          code: `${spec.code}-PH${laneIndex}`,
          title: `${template.code} × ${lane.quantity}: ${template.name}`,
          type: 'PHASE',
          status: 'TODO',
          estimatedHours: steps.reduce((sum, s) => sum + s.hours, 0),
          plannedStart: steps[0]!.plannedStart,
          plannedEnd: steps[steps.length - 1]!.plannedEnd,
          createdById: director.id,
        },
      });
      laneIndex += 1;

      const rotation = { SENIOR: 0, JUNIOR: 0 };
      const stepTaskIds = new Map<number, string>();

      for (const step of steps) {
        const seniority = step.item.recommendedSeniority === 'SENIOR' ? 'SENIOR' : 'JUNIOR';
        const pool = seniority === 'SENIOR' ? squad.senior : squad.junior;
        const assigneeCode = lane.assignees?.[step.item.stepNumber] ?? pool[rotation[seniority]++ % pool.length]!;
        const assignee = user(assigneeCode);
        memberIds.add(assignee.id);

        const s = step.spec;
        const hours = step.hours;
        let status: TaskStatus = 'TODO';
        let percentComplete = 0;
        let actualStart: Date | null = null;
        let submittedAt: Date | null = null;
        let completedAt: Date | null = null;
        let completedById: string | null = null;
        let assignmentStatus: AssignmentStatus = 'ACTIVE';

        if (s.state === 'approved') {
          status = 'COMPLETED';
          percentComplete = 100;
          actualStart = at(step.plannedStart, 4);
          completedAt = at(addDays(step.plannedEnd, s.lateDays ?? 0), 11);
          submittedAt = at(addDays(step.plannedEnd, s.lateDays ?? 0), 8);
          completedById = pm.id;
          assignmentStatus = 'COMPLETED';
          if (!latestApproval || completedAt > latestApproval) latestApproval = completedAt;
        } else if (s.state === 'review') {
          status = 'IN_REVIEW';
          percentComplete = 100;
          actualStart = at(step.plannedStart, 4);
          submittedAt = daysAgo(s.submittedDaysAgo, 5);
        } else if (s.state === 'progress') {
          status = 'IN_PROGRESS';
          percentComplete = s.percent;
          actualStart = at(step.plannedStart, 4);
        } else if (s.state === 'problem') {
          status = 'BLOCKED';
          percentComplete = s.percent;
          actualStart = at(step.plannedStart, 4);
        }

        const task = await prisma.task.create({
          data: {
            projectId: project.id,
            parentId: phase.id,
            code: `${spec.code}-T${String(taskCounter).padStart(2, '0')}`,
            title: step.item.title,
            description: step.item.description ?? `Standard step ${step.item.stepNumber} of ${template.name}`,
            type: 'PROJECT',
            status,
            priority: step.item.isSimulationSignoff ? 'HIGH' : 'MEDIUM',
            estimatedHours: hours,
            percentComplete,
            plannedStart: step.plannedStart,
            plannedEnd: step.plannedEnd,
            actualStart,
            submittedAt,
            completedAt,
            completedById,
            createdById: director.id,
          },
        });
        taskCounter += 1;
        stepTaskIds.set(step.item.stepNumber, task.id);

        await prisma.taskAssignment.create({
          data: {
            taskId: task.id,
            userId: assignee.id,
            role: 'OWNER',
            status: assignmentStatus,
            allocatedHours: hours,
            assignedById: pm.id,
            assignedAt: at(projectStart, 3),
            releasedAt: completedAt,
          },
        });

        // Progress history, in time order.
        const logs: Array<{ percent: number; note: string; blocker?: string; createdAt: Date }> = [];
        if (s.state === 'approved' && s.problemSolvedDaysAgo !== undefined) {
          logs.push({ percent: 40, note: 'Started, found a mismatch in the drawings.', blocker: 'Electrical drawing rev B not received', createdAt: daysAgo(s.problemSolvedDaysAgo + 1, 5) });
          logs.push({ percent: 70, note: 'Rev B received, mismatch resolved.', createdAt: daysAgo(s.problemSolvedDaysAgo, 6) });
        }
        if (s.state === 'approved' && s.sentBackDaysAgo !== undefined) {
          logs.push({ percent: 100, note: 'Finished first pass.', createdAt: daysAgo(s.sentBackDaysAgo, 4) });
        }
        if (s.state === 'progress') logs.push({ percent: s.percent, note: 'Work under way.', createdAt: daysAgo(0, 4) });
        if (s.state === 'problem') {
          logs.push({ percent: s.percent, note: 'Paused: waiting on the client.', blocker: s.blocker, createdAt: daysAgo(s.daysAgo, 6) });
        }
        if ((s.state === 'approved' || s.state === 'review') && submittedAt) {
          const createdAt = s.state === 'approved' && s.problemSolvedDaysAgo !== undefined && submittedAt < daysAgo(s.problemSolvedDaysAgo, 7)
            ? daysAgo(s.problemSolvedDaysAgo, 7)
            : submittedAt;
          logs.push({ percent: 100, note: 'Completed, sent for approval.', createdAt });
        }
        for (const log of logs.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
          await prisma.taskProgressLog.create({
            data: {
              taskId: task.id,
              userId: assignee.id,
              percentComplete: log.percent,
              note: log.note,
              blocker: log.blocker ?? null,
              loggedFor: new Date(Date.UTC(log.createdAt.getUTCFullYear(), log.createdAt.getUTCMonth(), log.createdAt.getUTCDate())),
              createdAt: log.createdAt,
            },
          });
        }

        // Status history for approvals and send-backs (drives "sent back" and the audit trail).
        if (s.state === 'approved' && s.sentBackDaysAgo !== undefined) {
          await prisma.auditLog.create({
            data: {
              actorId: pm.id, module: 'pm', action: 'task.status_changed', entityType: 'Task', entityId: task.id,
              diff: { status: { from: 'IN_REVIEW', to: 'IN_PROGRESS' }, note: 'Tag naming does not follow the client standard. Please fix and resubmit.' },
              createdAt: daysAgo(s.sentBackDaysAgo, 9),
            },
          });
          await prisma.taskComment.create({
            data: { taskId: task.id, userId: pm.id, body: '[Sent back] Tag naming does not follow the client standard. Please fix and resubmit.', createdAt: daysAgo(s.sentBackDaysAgo, 9) },
          });
        }
        if (s.state === 'approved' && completedAt) {
          await prisma.auditLog.create({
            data: {
              actorId: pm.id, module: 'pm', action: 'task.status_changed', entityType: 'Task', entityId: task.id,
              diff: { status: { from: 'IN_REVIEW', to: 'COMPLETED' }, note: null },
              createdAt: completedAt,
            },
          });
        }
      }

      // Dependencies come from the checklist template, within the lane.
      for (const step of steps) {
        const predecessorStep = step.item.dependsOnStep;
        if (!predecessorStep || !stepTaskIds.has(predecessorStep)) continue;
        await prisma.taskDependency.create({
          data: { predecessorId: stepTaskIds.get(predecessorStep)!, successorId: stepTaskIds.get(step.item.stepNumber)!, type: 'FINISH_TO_START', lagDays: 0 },
        });
      }
    }

    await prisma.projectMember.createMany({
      data: [...memberIds].map((userId) => ({ projectId: project.id, userId, role: userId === pm.id ? 'MANAGER' : 'ENGINEER' })),
    });

    if (spec.status === 'COMPLETED' && latestApproval) {
      await prisma.project.update({ where: { id: project.id }, data: { actualEndDate: latestApproval } });
    }

    await recomputeTaskDerivedState(project.id);
  }

  const idOf = (code: string) => created.find((c) => c.code === code)!.id;
  const taskOf = (projectCode: string, title: string, laneTemplate?: string) =>
    prisma.task.findFirstOrThrow({
      where: { projectId: idOf(projectCode), title, type: 'PROJECT', ...(laneTemplate ? { parent: { title: { startsWith: laneTemplate } } } : {}) },
      include: { assignments: { where: { status: 'ACTIVE' }, select: { userId: true } } },
    });

  // Reassign requests on DEMO-05: one waiting 3 days (stale), one raised today.
  const staleTask = await taskOf('DEMO-05', 'Verify PLC CPU, Comm Modules & Network Configuration', 'PLC');
  await prisma.taskHandover.create({
    data: {
      taskId: staleTask.id, fromUserId: staleTask.assignments[0]!.userId, toUserId: user('ACS-0068').id, requestedById: user(PARTH).id,
      reason: 'Shivam is overloaded this week; Agastya has free capacity.', remainingPercent: 100, remainingHours: 8, createdAt: daysAgo(3, 5),
    },
  });
  const freshTask = await taskOf('DEMO-05', 'Diagnostic Screen of DQ', 'HMI');
  await prisma.taskHandover.create({
    data: {
      taskId: freshTask.id,
      fromUserId: freshTask.assignments[0]!.userId,
      toUserId: freshTask.assignments[0]!.userId === user('ACS-0066').id ? user('ACS-0072').id : user('ACS-0066').id,
      requestedById: freshTask.assignments[0]!.userId, reason: 'Pulled onto a site visit tomorrow.', remainingPercent: 100, remainingHours: 8, createdAt: daysAgo(0, 4),
    },
  });

  // Project handover on DEMO-06: Paras -> Parth, waiting 1 day.
  await prisma.projectHandover.create({
    data: { projectId: idOf('DEMO-06'), fromUserId: user(PARAS).id, toUserId: user(PARTH).id, reason: 'Paras moving to the Tata Power site for two weeks.', createdAt: daysAgo(1, 6) },
  });

  // Approved leave: Het Patel off for the next 4 working days.
  await prisma.leave.create({
    data: { userId: user('ACS-0067').id, startDate: wd(1), endDate: wd(4), reason: 'Demo leave', status: 'APPROVED' },
  });

  // Notifications for the PM personas.
  const reviewTask = await taskOf('DEMO-04', 'Verify PLC Hardware Configuration as per Electrical Dwg');
  await prisma.notification.createMany({
    data: [
      { userId: user(PARAS).id, title: `Review ready: ${reviewTask.title}`, body: 'Submitted 3 days ago on Demo · Tata Power.', link: `/pm/tasks/${reviewTask.id}`, createdAt: daysAgo(3, 5) },
      { userId: user(PARTH).id, title: 'Project handover for you: Demo · JSW Steel', body: 'Paras wants to hand over this project.', link: `/pm/projects/${idOf('DEMO-06')}`, createdAt: daysAgo(1, 6) },
      { userId: user(PARTH).id, title: 'Problem reported on Demo · Amul Dairy', body: 'Client has not approved the revised P&ID yet', link: `/pm/projects/${idOf('DEMO-03')}`, createdAt: daysAgo(2, 6) },
    ],
  });

  console.log(`Demo data ready (today = ${today.toISOString().slice(0, 10)}):`);
  for (const c of created) console.log(`  ${c.code}  /pm/projects/${c.id}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
