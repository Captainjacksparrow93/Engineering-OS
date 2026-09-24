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
import { requestHandover, decideHandover } from '../../src/modules/project-management/services/handover.service';

const prisma = new PrismaClient();

// Squad fixtures — docs/handover-rework-plan.md "Before you start"
const PARAS = 'ACS-0074';   // Project Manager, squad lead
const MUNAF = 'ACS-0075';   // Asst. Manager, squad lead
const DILIP = 'ACS-0061';   // Technical Head — pm.oversight
const HARSH = 'ACS-0077';   // Sr. Engineer, Paras's squad
const RIDHHI = 'ACS-0076';  // Sr. Engineer, Paras's squad
const HET = 'ACS-0067';     // Jr. Engineer, MUNAF's squad

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

async function main() {
  console.log('='.repeat(70));
  console.log('  HANDOVER REWORK — RULE VERIFICATION');
  console.log('='.repeat(70));

  const paras = await principalFor(PARAS);
  const munaf = await principalFor(MUNAF);
  const dilip = await principalFor(DILIP);
  const harsh = await principalFor(HARSH);

  const harshId = await idFor(HARSH);
  const ridhhiId = await idFor(RIDHHI);
  const hetId = await idFor(HET);

  // ---------------------------------------------------------------- fixture
  // Projects and clients are created by a head, not a PM: PROJECT_MANAGER and
  // ASST_MANAGER do not hold `pm.project.create`. The squad leads are *chosen as owner*
  // by the head who creates the project — matching the real flow.
  console.log('\n0. Building a throwaway project (created by Dilip, owned by Paras, assigned to Harsh)');

  const ref = await nextClientRef(dilip.companyId);
  const client = await createClient(dilip, { name: `ZZ VERIFY CLIENT ${Date.now()}`, refNumber: ref });

  const plc = await prisma.checklistTemplate.findFirst({
    where: { code: 'PLC' },
    include: { items: { orderBy: { stepNumber: 'asc' } } },
  });
  if (!plc) throw new Error('PLC checklist template missing — run the main seed.');

  const project = await createAutomationProject(dilip, {
    workOrderNo: String(Date.now()).slice(-7),
    clientId: client.id,
    clientName: client.name,
    managerId: paras.userId,
    scopes: [{ templateCode: 'PLC', quantity: 1 }],
    tasks: plc.items.map((item) => ({
      templateCode: 'PLC',
      unitIndex: 1,
      stepNumber: item.stepNumber,
      title: item.title,
      assigneeId: harshId,
    })),
  });

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
  } finally {
    // ------------------------------------------------------------- cleanup
    console.log('\n8. Cleaning up');
    await prisma.roleAssignment.deleteMany({ where: { scopeType: 'PROJECT', scopeId: project.id } });
    await prisma.project.delete({ where: { id: project.id } });
    await prisma.client.delete({ where: { id: client.id } });
    console.log('   Removed the throwaway project and client.');
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
