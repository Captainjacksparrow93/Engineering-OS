import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function getCounts() {
  const [
    projects,
    tasks,
    assignments,
    progressLogs,
    commLogs,
    commAssignments,
    projectHandovers,
    taskHandovers,
    projectRoles,
    users,
    clients,
    templates,
  ] = await Promise.all([
    prisma.project.count(),
    prisma.task.count(),
    prisma.taskAssignment.count(),
    prisma.taskProgressLog.count(),
    prisma.commissioningLog.count(),
    prisma.commissioningAssignment.count(),
    prisma.projectHandover.count(),
    prisma.taskHandover.count(),
    prisma.roleAssignment.count({ where: { scopeType: 'PROJECT' } }),
    prisma.user.count(),
    prisma.client.count(),
    prisma.checklistTemplate.count(),
  ]);

  return {
    projects,
    tasks,
    assignments,
    progressLogs,
    commLogs,
    commAssignments,
    projectHandovers,
    taskHandovers,
    projectRoles,
    users,
    clients,
    templates,
  };
}

async function main() {
  console.log('====================================================');
  console.log('  WIPE ALL PROJECTS — DATA RESET RUNNER             ');
  console.log('====================================================\n');

  console.log('1. Checking current database counts before wipe...');
  const before = await getCounts();
  console.log('   - Projects:                          ', before.projects);
  console.log('   - Tasks:                             ', before.tasks);
  console.log('   - Task Assignments:                  ', before.assignments);
  console.log('   - Task Progress Logs:                ', before.progressLogs);
  console.log('   - Commissioning Logs:                ', before.commLogs);
  console.log('   - Commissioning Assignments:         ', before.commAssignments);
  console.log('   - Project Handovers:                 ', before.projectHandovers);
  console.log('   - Task Handovers:                    ', before.taskHandovers);
  console.log('   - PROJECT-scoped Role Assignments:   ', before.projectRoles);
  console.log('   - Users (should stay unchanged):     ', before.users);
  console.log('   - Clients (should stay unchanged):   ', before.clients);
  console.log('   - Templates (should stay unchanged): ', before.templates);

  if (before.projects === 0 && before.projectRoles === 0) {
    console.log('\n[INFO] 0 projects and 0 project-scoped roles found. System is already clean.');
    return;
  }

  console.log('\n2. Deleting project-scoped role assignments and all projects in a transaction...');
  await prisma.$transaction(async (tx) => {
    const deletedRoles = await tx.roleAssignment.deleteMany({
      where: { scopeType: 'PROJECT' },
    });
    console.log(`   - Deleted ${deletedRoles.count} PROJECT-scoped role assignments.`);

    const deletedProjects = await tx.project.deleteMany({});
    console.log(`   - Deleted ${deletedProjects.count} projects (cascading all dependent records).`);
  });

  console.log('\n3. Verifying post-wipe counts...');
  const after = await getCounts();
  console.log('   - Projects:                          ', after.projects, after.projects === 0 ? '✓' : '✗ FAILED');
  console.log('   - Tasks:                             ', after.tasks, after.tasks === 0 ? '✓' : '✗ FAILED');
  console.log('   - Task Assignments:                  ', after.assignments, after.assignments === 0 ? '✓' : '✗ FAILED');
  console.log('   - Task Progress Logs:                ', after.progressLogs, after.progressLogs === 0 ? '✓' : '✗ FAILED');
  console.log('   - Commissioning Logs:                ', after.commLogs, after.commLogs === 0 ? '✓' : '✗ FAILED');
  console.log('   - Commissioning Assignments:         ', after.commAssignments, after.commAssignments === 0 ? '✓' : '✗ FAILED');
  console.log('   - Project Handovers:                 ', after.projectHandovers, after.projectHandovers === 0 ? '✓' : '✗ FAILED');
  console.log('   - Task Handovers:                    ', after.taskHandovers, after.taskHandovers === 0 ? '✓' : '✗ FAILED');
  console.log('   - PROJECT-scoped Role Assignments:   ', after.projectRoles, after.projectRoles === 0 ? '✓' : '✗ FAILED');
  console.log('   - Users (unchanged):                 ', after.users, after.users === before.users ? '✓' : '✗ CHANGED');
  console.log('   - Clients (unchanged):               ', after.clients, after.clients === before.clients ? '✓' : '✗ CHANGED');
  console.log('   - Templates (unchanged):             ', after.templates, after.templates === before.templates ? '✓' : '✗ CHANGED');

  if (after.projects === 0 && after.tasks === 0 && after.projectRoles === 0 && after.users === before.users) {
    console.log('\n==> SUCCESS: All projects and cascading project data wiped cleanly.');
  } else {
    throw new Error('Verification failed: some records were not wiped or non-project records changed.');
  }
}

main()
  .catch((e) => {
    console.error('\n[ERROR] Project wipe failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
