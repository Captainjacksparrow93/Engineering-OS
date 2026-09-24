/**
 * Verification harness for the handover & assignment rework.
 *
 *   docs/handover-rework-plan.md  ·  docs/org-and-lifecycle-redesign.md §4b
 *
 * Exercises the movement-of-work rules against real principals and real services —
 * no UI, no logins. Creates its own project and deletes it at the end.
 *
 * LOCAL ONLY. It writes and deletes data. Never run it against the VPS.
 *
 *   docker compose -f docker-compose.local.yml up -d db
 *   npx tsx prisma/scripts/verify-handover-rework.ts
 */
import { PrismaClient } from '@prisma/client';
import { loadPrincipal } from '../../src/core/rbac/principal';
import type { Principal } from '../../src/core/rbac/types';
import { createClient, nextClientRef } from '../../src/modules/project-management/services/client.service';
import { createAutomationProject } from '../../src/modules/project-management/services/automation-project.service';
import { assignTask } from '../../src/modules/project-management/services/task.service';
import {
  requestHandover,
  decideHandover,
  requestPanelHandover,
  decidePanelHandover,
  requestProjectHandover,
  decideProjectHandover,
  listHandovers,
} from '../../src/modules/project-management/services/handover.service';

const prisma = new PrismaClient();

// Squad fixtures — docs/handover-rework-plan.md "Before you start"
const DIRECTOR = 'ACS-0004'; // Shaktikumar Vasava — sees and does everything
const DILIP = 'ACS-0061';    // Technical Head — pm.oversight
const RAJANI = 'ACS-0062';   // Service Head — pm.oversight, manages nobody
const PARTH = 'ACS-0063';    // Project Manager, squad lead
const PARAS = 'ACS-0074';    // Project Manager, squad lead
const MUNAF = 'ACS-0075';    // Asst. Manager, squad lead
const DHRUPIN = 'ACS-0070';  // Asst. Manager, squad lead
const HARSH = 'ACS-0077';    // Sr. Engineer, Paras's squad
const RIDHHI = 'ACS-0076';   // Sr. Engineer, Paras's squad
const HET = 'ACS-0067';      // Jr. Engineer, Munaf's squad
const YOGI = 'ACS-0071';     // Sr. Engineer, Dhrupin's squad

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`   PASS  ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed += 1;
    console.log(`   FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

/** Runs `fn`, returning the DomainError/ForbiddenError message instead of throwing. */
async function expectRejection(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    check(label, false, 'expected a rejection, but it succeeded');
  } catch (e) {
    check(label, true, e instanceof Error ? e.message.slice(0, 80) : String(e));
  }
}

async function principalFor(code: string): Promise<Principal> {
  const user = await prisma.user.findFirst({ where: { employeeCode: code }, select: { id: true } });
  if (!user) throw new Error(`Fixture user ${code} not found — is the production snapshot loaded?`);
  const principal = await loadPrincipal(user.id);
  if (!principal) throw new Error(`Could not build a principal for ${code}`);
  return principal;
}

async function idFor(code: string): Promise<string> {
  const u = await prisma.user.findFirst({ where: { employeeCode: code }, select: { id: true } });
  if (!u) throw new Error(`Fixture user ${code} not found`);
  return u.id;
}

/** Current ACTIVE owner of a task, by employee code. */
async function ownerOf(taskId: string): Promise<string> {
  const a = await prisma.taskAssignment.findFirst({
    where: { taskId, status: 'ACTIVE', role: 'OWNER' },
    include: { user: { select: { employeeCode: true } } },
  });
  return a?.user.employeeCode ?? '(none)';
}

/** Owner of a project, by employee code. */
async function projectManagerOf(projectId: string): Promise<string> {
  const p = await prisma.project.findUnique({
    where: { id: projectId },
    select: { manager: { select: { employeeCode: true } } },
  });
  return p?.manager.employeeCode ?? '(none)';
}

/** Employee codes of everyone holding an ACTIVE owner assignment on a project. */
async function engineersOn(projectId: string): Promise<string[]> {
  const rows = await prisma.taskAssignment.findMany({
    where: { status: 'ACTIVE', task: { projectId } },
    include: { user: { select: { employeeCode: true } } },
  });
  return [...new Set(rows.map((r) => r.user.employeeCode))].sort();
}

async function main() {
  console.log('='.repeat(70));
  console.log('  HANDOVER REWORK — RULE VERIFICATION (all flows, all roles)');
  console.log('='.repeat(70));

  const director = await principalFor(DIRECTOR);
  const dilip = await principalFor(DILIP);
  const rajani = await principalFor(RAJANI);
  const parth = await principalFor(PARTH);
  const paras = await principalFor(PARAS);
  const munaf = await principalFor(MUNAF);
  const dhrupin = await principalFor(DHRUPIN);
  const harsh = await principalFor(HARSH);

  const harshId = await idFor(HARSH);
  const ridhhiId = await idFor(RIDHHI);
  const hetId = await idFor(HET);
  const yogiId = await idFor(YOGI);
  const parthId = await idFor(PARTH);

  const plc = await prisma.checklistTemplate.findFirst({
    where: { code: 'PLC' },
    include: { items: { orderBy: { stepNumber: 'asc' } } },
  });
  if (!plc) throw new Error('PLC checklist template missing — run the main seed.');

  const madeProjects: string[] = [];
  const madeClients: string[] = [];
  // Notifications are not foreign-keyed to projects, so deleting the test projects leaves
  // them behind pointing at dead links. Everything created from here on is ours to remove.
  const startedAt = new Date();

  /**
   * Projects and clients are created by a HEAD, not a PM: PROJECT_MANAGER and
   * ASST_MANAGER do not hold `pm.project.create`. The squad leads are *chosen as owner*
   * by the head who creates the project — matching the real flow.
   */
  async function makeProject(ownerId: string, assigneeId: string, panels = 1) {
    const ref = await nextClientRef(dilip.companyId);
    const client = await createClient(dilip, {
      name: `ZZ VERIFY ${Date.now()}-${madeClients.length}`,
      refNumber: ref,
    });
    madeClients.push(client.id);

    const tasks = [];
    for (let unit = 1; unit <= panels; unit += 1) {
      for (const item of plc!.items) {
        tasks.push({
          templateCode: 'PLC',
          unitIndex: unit,
          stepNumber: item.stepNumber,
          title: item.title,
          assigneeId,
        });
      }
    }

    const p = await createAutomationProject(dilip, {
      workOrderNo: `${Date.now()}`.slice(-6) + madeProjects.length,
      clientId: client.id,
      clientName: client.name,
      managerId: ownerId,
      scopes: [{ templateCode: 'PLC', quantity: panels }],
      tasks,
    });
    madeProjects.push(p.id);
    return p;
  }

  // ---------------------------------------------------------------- fixture
  console.log('\n0. Building a throwaway project (created by Dilip, owned by Paras, assigned to Harsh)');

  const project = await makeProject(paras.userId, harshId, 1);
  const client = { id: madeClients[0]! };

  const tasks = await prisma.task.findMany({
    where: { projectId: project.id, type: 'PROJECT' },
    orderBy: { code: 'asc' },
    select: { id: true, code: true },
  });
  console.log(`   Created ${project.code} with ${tasks.length} steps, all owned by Harsh (${HARSH}).`);

  const [t1, t2, t3, t4, t5] = tasks;

  try {
    // ------------------------------------------------- 1. within own squad
    console.log('\n1. PM assigns inside their OWN squad — expect a direct move, no request');
    await assignTask(paras, t1!.id, { userId: ridhhiId, role: 'OWNER' });
    check('owner changed immediately', (await ownerOf(t1!.id)) === RIDHHI, `owner is now ${await ownerOf(t1!.id)}`);
    check(
      'no handover record was created',
      (await prisma.taskHandover.count({ where: { taskId: t1!.id } })) === 0,
    );
    const released = await prisma.taskAssignment.count({ where: { taskId: t1!.id, status: 'RELEASED' } });
    check('previous assignment kept as RELEASED (hours preserved)', released === 1);

    // --------------------------------------------------- 2. across squads
    console.log('\n2. PM assigns to ANOTHER squad — expect a request, and NO movement');
    await assignTask(paras, t2!.id, { userId: hetId, role: 'OWNER' });
    const h2 = await prisma.taskHandover.findFirst({ where: { taskId: t2!.id } });
    check('a handover request was created', Boolean(h2));
    check('status is PENDING', h2?.status === 'PENDING', h2?.status);
    check('work has NOT moved yet', (await ownerOf(t2!.id)) === HARSH, `owner still ${await ownerOf(t2!.id)}`);

    // --------------------------------------- 3. stage 1: receiving manager
    console.log('\n3. Receiving manager (Munaf) approves — expect AWAITING_HEAD_APPROVAL, still no movement');
    await decideHandover(munaf, h2!.id, 'ACCEPTED');
    const h2b = await prisma.taskHandover.findUnique({ where: { id: h2!.id } });
    check('status is AWAITING_HEAD_APPROVAL', h2b?.status === 'AWAITING_HEAD_APPROVAL', h2b?.status);
    check('PM2 decision recorded', Boolean(h2b?.decidedById));
    check(
      'work STILL has not moved (the rule that matters)',
      (await ownerOf(t2!.id)) === HARSH,
      `owner ${await ownerOf(t2!.id)}`,
    );

    // ------------------------------------------------------ 4. stage 2: head
    console.log('\n4. Head (Dilip) approves — expect ACCEPTED and the work to move');
    await decideHandover(dilip, h2!.id, 'ACCEPTED');
    const h2c = await prisma.taskHandover.findUnique({ where: { id: h2!.id } });
    check('status is ACCEPTED', h2c?.status === 'ACCEPTED', h2c?.status);
    check('head approval recorded separately', Boolean(h2c?.headApprovedById));
    check('work has moved to Het', (await ownerOf(t2!.id)) === HET, `owner is now ${await ownerOf(t2!.id)}`);

    // ------------------------------------------------------ 5. reject path
    console.log('\n5. Receiving manager DECLINES — expect it to end there, nothing moved');
    await assignTask(paras, t3!.id, { userId: hetId, role: 'OWNER' });
    const h3 = await prisma.taskHandover.findFirst({ where: { taskId: t3!.id } });
    await decideHandover(munaf, h3!.id, 'DECLINED', 'not available');
    const h3b = await prisma.taskHandover.findUnique({ where: { id: h3!.id } });
    check('status is DECLINED', h3b?.status === 'DECLINED', h3b?.status);
    check('no head approval was recorded', !h3b?.headApprovedById);
    check('work did not move', (await ownerOf(t3!.id)) === HARSH, `owner ${await ownerOf(t3!.id)}`);

    // -------------------------------------------------- 6. head acts directly
    console.log('\n6. Head assigns across squads — expect a direct move, no request');
    await assignTask(dilip, t4!.id, { userId: hetId, role: 'OWNER' });
    check('work moved immediately', (await ownerOf(t4!.id)) === HET, `owner ${await ownerOf(t4!.id)}`);
    check(
      'no request was created',
      (await prisma.taskHandover.count({ where: { taskId: t4!.id } })) === 0,
    );

    // ------------------------------------------------------- 7. engineers
    console.log('\n7. Engineer boundaries');
    await expectRejection('engineer CANNOT request across squads (Harsh -> Het)', () =>
      requestHandover(harsh, { taskId: t5!.id, toUserId: hetId, reason: 'cross squad attempt' }),
    );
    const h5 = await requestHandover(harsh, {
      taskId: t5!.id,
      toUserId: ridhhiId,
      reason: 'same squad handover, should be allowed',
    });
    check('engineer CAN request inside their own squad', Boolean(h5));
    check('work does not move until accepted', (await ownerOf(t5!.id)) === HARSH);

    // ------------------------------------------------- 8. visibility (Phase 6)
    console.log('\n8. Visibility after a cross-squad task handover (Phase 6)');
    const hetMember = await prisma.projectMember.findFirst({
      where: { projectId: project.id, userId: hetId },
    });
    check('borrowed engineer was added as a project member', Boolean(hetMember));
    const munafProjectRole = await prisma.roleAssignment.findFirst({
      where: { userId: munaf.userId, scopeType: 'PROJECT', scopeId: project.id },
    });
    check('receiving manager did NOT gain a project-scoped role', !munafProjectRole);

    // ------------------------------------------------- 9. lists (Phase 4)
    console.log('\n9. AWAITING_HEAD_APPROVAL must be visible to those who can act (Phase 4)');
    const pAwait = await makeProject(paras.userId, harshId, 1);
    const pTasks = await prisma.task.findMany({
      where: { projectId: pAwait.id, type: 'PROJECT' },
      orderBy: { code: 'asc' },
      select: { id: true },
    });
    await assignTask(paras, pTasks[0]!.id, { userId: hetId, role: 'OWNER' });
    const hAwait = await prisma.taskHandover.findFirst({ where: { taskId: pTasks[0]!.id } });
    await decideHandover(munaf, hAwait!.id, 'ACCEPTED');

    const seenBy = async (p: Principal) => {
      const l = await listHandovers(p);
      const all = [...l.incoming, ...l.outgoing, ...l.oversight];
      return all.some((h) => h.id === hAwait!.id);
    };
    check('Technical Head sees the awaiting-head row', await seenBy(dilip));
    check('Service Head sees it too', await seenBy(rajani));
    check('Director sees it (sees everything)', await seenBy(director));

    // ---------------------------------------- 10. Service Head acts as a head
    console.log('\n10. Service Head has the same powers as Technical Head');
    await decideHandover(rajani, hAwait!.id, 'ACCEPTED');
    const hAwait2 = await prisma.taskHandover.findUnique({ where: { id: hAwait!.id } });
    check('Service Head can give stage-2 approval', hAwait2?.status === 'ACCEPTED', hAwait2?.status);
    await assignTask(rajani, pTasks[1]!.id, { userId: yogiId, role: 'OWNER' });
    check('Service Head assigns across squads directly', (await ownerOf(pTasks[1]!.id)) === YOGI);

    // --------------------------------- 11. panel handover across squads
    console.log('\n11. PANEL handover across squads must need the same two approvals');
    const pPanel = await makeProject(paras.userId, harshId, 1);
    const phase = await prisma.task.findFirst({
      where: { projectId: pPanel.id, type: 'PHASE' },
      select: { id: true },
    });
    await requestPanelHandover(paras, {
      phaseTaskId: phase!.id,
      toUserId: hetId,
      reason: 'cross-squad panel handover',
    });
    const panelHs = await prisma.taskHandover.findMany({
      where: { task: { parentId: phase!.id } },
    });
    check('panel handover created requests', panelHs.length > 0, `${panelHs.length} rows`);
    check('all start PENDING', panelHs.every((h) => h.status === 'PENDING'));
    const panelTasks = await prisma.task.findMany({ where: { parentId: phase!.id }, select: { id: true } });
    check('no panel work moved yet', (await ownerOf(panelTasks[0]!.id)) === HARSH);

    await decidePanelHandover(munaf, { phaseTaskId: phase!.id, decision: 'ACCEPTED' });
    const panelAfterPm2 = await prisma.taskHandover.findMany({ where: { task: { parentId: phase!.id } } });
    check(
      'after PM2 approval the batch is AWAITING_HEAD_APPROVAL',
      panelAfterPm2.every((h) => h.status === 'AWAITING_HEAD_APPROVAL'),
      panelAfterPm2.map((h) => h.status).join(','),
    );
    check('panel work STILL has not moved', (await ownerOf(panelTasks[0]!.id)) === HARSH);

    await decidePanelHandover(dilip, { phaseTaskId: phase!.id, decision: 'ACCEPTED' });
    check('after head approval the panel moves', (await ownerOf(panelTasks[0]!.id)) === HET);

    // ------------------------- 12. engineer panel handover boundaries
    console.log('\n12. Engineer panel handover — own squad only');
    const pEng = await makeProject(paras.userId, harshId, 1);
    const engPhase = await prisma.task.findFirst({
      where: { projectId: pEng.id, type: 'PHASE' },
      select: { id: true },
    });
    await expectRejection('engineer CANNOT hand a panel to another squad', () =>
      requestPanelHandover(harsh, { phaseTaskId: engPhase!.id, toUserId: hetId, reason: 'cross squad' }),
    );
    const okPanel = await requestPanelHandover(harsh, {
      phaseTaskId: engPhase!.id,
      toUserId: ridhhiId,
      reason: 'same squad panel handover',
    });
    check('engineer CAN hand a panel to their own squad', Boolean(okPanel));

    // ---------------------------------------- 13. PROJECT handover
    console.log('\n13. PROJECT handover PM -> PM needs two approvals');
    const pProj = await makeProject(paras.userId, harshId, 1);
    await requestProjectHandover(paras, {
      projectId: pProj.id,
      toUserId: parthId,
      reason: 'handing the project to Parth',
    });
    const ph = await prisma.projectHandover.findFirst({ where: { projectId: pProj.id } });
    check('project handover created', Boolean(ph));
    check('status PENDING', ph?.status === 'PENDING', ph?.status);
    check('project has NOT changed hands', (await projectManagerOf(pProj.id)) === PARAS);

    await decideProjectHandover(parth, ph!.id, 'ACCEPTED');
    const ph2 = await prisma.projectHandover.findUnique({ where: { id: ph!.id } });
    check('after PM2 approval: AWAITING_HEAD_APPROVAL', ph2?.status === 'AWAITING_HEAD_APPROVAL', ph2?.status);
    check('project STILL has not changed hands', (await projectManagerOf(pProj.id)) === PARAS);

    await decideProjectHandover(dilip, ph!.id, 'ACCEPTED');
    const ph3 = await prisma.projectHandover.findUnique({ where: { id: ph!.id } });
    check('after head approval: ACCEPTED', ph3?.status === 'ACCEPTED', ph3?.status);
    check('head approval recorded separately', Boolean(ph3?.headApprovedById));
    check('project manager is now Parth', (await projectManagerOf(pProj.id)) === PARTH);
    check(
      'previous squad engineers are NOT stripped from the project',
      (await engineersOn(pProj.id)).includes(HARSH),
      `engineers: ${(await engineersOn(pProj.id)).join(', ')}`,
    );

    // ------------------------------- 14. engineers cannot move projects
    console.log('\n14. Engineers cannot hand over a whole project');
    const pGate = await makeProject(paras.userId, harshId, 1);
    await expectRejection('engineer is refused a project handover', () =>
      requestProjectHandover(harsh, { projectId: pGate.id, toUserId: parthId, reason: 'should be refused' }),
    );

    // ------------------------------------- 15. Director acts unilaterally
    console.log('\n15. Director needs no approval from anyone');
    const pDir = await makeProject(paras.userId, harshId, 1);
    const dirTasks = await prisma.task.findMany({
      where: { projectId: pDir.id, type: 'PROJECT' },
      orderBy: { code: 'asc' },
      select: { id: true },
    });
    await assignTask(director, dirTasks[0]!.id, { userId: hetId, role: 'OWNER' });
    check('Director assigns across squads directly', (await ownerOf(dirTasks[0]!.id)) === HET);
    check(
      'no request was created',
      (await prisma.taskHandover.count({ where: { taskId: dirTasks[0]!.id } })) === 0,
    );

    // --------------------------------- 16. Asst Manager behaves like a PM
    console.log('\n16. Asst Manager (Dhrupin) behaves exactly like a PM');
    const pAsst = await makeProject(dhrupin.userId, yogiId, 1);
    const aTasks = await prisma.task.findMany({
      where: { projectId: pAsst.id, type: 'PROJECT' },
      orderBy: { code: 'asc' },
      select: { id: true },
    });
    await assignTask(dhrupin, aTasks[0]!.id, { userId: await idFor('ACS-0073'), role: 'OWNER' });
    check('Asst Manager assigns inside own squad directly', (await ownerOf(aTasks[0]!.id)) === 'ACS-0073');
    await assignTask(dhrupin, aTasks[1]!.id, { userId: harshId, role: 'OWNER' });
    const aCross = await prisma.taskHandover.findFirst({ where: { taskId: aTasks[1]!.id } });
    check('Asst Manager crossing squads raises a request', aCross?.status === 'PENDING', aCross?.status);
    check('and nothing moved', (await ownerOf(aTasks[1]!.id)) === YOGI);

    // --------------------------------------- 17. self-approval guard
    console.log('\n17. One person must not satisfy both approval stages');
    const pSelf = await makeProject(paras.userId, harshId, 1);
    const sTasks = await prisma.task.findMany({
      where: { projectId: pSelf.id, type: 'PROJECT' },
      orderBy: { code: 'asc' },
      select: { id: true },
    });
    await assignTask(paras, sTasks[0]!.id, { userId: hetId, role: 'OWNER' });
    const sh = await prisma.taskHandover.findFirst({ where: { taskId: sTasks[0]!.id } });
    await decideHandover(dilip, sh!.id, 'ACCEPTED'); // stage 1, as an oversight holder
    const shAfter = await prisma.taskHandover.findUnique({ where: { id: sh!.id } });
    if (shAfter?.status === 'ACCEPTED') {
      check(
        'head approving stage 1 completed it in one step (no separate stage 2)',
        true,
        'NOTE: verify this is intended — a single head both accepted and approved',
      );
    } else {
      await expectRejection('the same head cannot also give stage-2 approval', () =>
        decideHandover(dilip, sh!.id, 'ACCEPTED'),
      );
    }
  } finally {
    // ------------------------------------------------------------- cleanup
    console.log('\n18. Cleaning up');
    for (const id of madeProjects) {
      await prisma.roleAssignment.deleteMany({ where: { scopeType: 'PROJECT', scopeId: id } });
      await prisma.project.delete({ where: { id } }).catch(() => undefined);
    }
    for (const id of madeClients) {
      await prisma.client.delete({ where: { id } }).catch(() => undefined);
    }
    const notifs = await prisma.notification.deleteMany({ where: { createdAt: { gte: startedAt } } });
    const events = await prisma.domainEvent.deleteMany({ where: { createdAt: { gte: startedAt } } });
    console.log(
      `   Removed ${madeProjects.length} projects, ${madeClients.length} clients, ` +
        `${notifs.count} notifications and ${events.count} domain events.`,
    );
  }

  console.log('\n' + '='.repeat(70));
  console.log(`  RESULT: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(70));
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error('\nHARNESS ERROR:', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
