import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface ManagerUpdate {
  employeeCode: string;
  expectedManagerCode: string;
  roleDescription: string;
}

const REPORTING_LINE_UPDATES: ManagerUpdate[] = [
  { employeeCode: 'ACS-0061', expectedManagerCode: 'ACS-0004', roleDescription: 'Dilipkumar Asediya -> Shaktikumar Vasava' },
  { employeeCode: 'ACS-0062', expectedManagerCode: 'ACS-0004', roleDescription: 'Rajani Nagar -> Shaktikumar Vasava' },
  { employeeCode: 'ACS-0075', expectedManagerCode: 'ACS-0061', roleDescription: 'Munaf Multani -> Dilip Asediya' },
  { employeeCode: 'ACS-0070', expectedManagerCode: 'ACS-0061', roleDescription: 'Dhrupin Vaghasiya -> Dilip Asediya' },
  { employeeCode: 'ACS-0067', expectedManagerCode: 'ACS-0075', roleDescription: 'Het Patel -> Munaf Multani' },
  { employeeCode: 'ACS-0068', expectedManagerCode: 'ACS-0075', roleDescription: 'Agastya Patel -> Munaf Multani' },
  { employeeCode: 'ACS-0069', expectedManagerCode: 'ACS-0075', roleDescription: 'Dixit Prajapati -> Munaf Multani' },
  { employeeCode: 'ACS-0079', expectedManagerCode: 'ACS-0075', roleDescription: 'Hitesh Malviya -> Munaf Multani' },
  { employeeCode: 'ACS-0082', expectedManagerCode: 'ACS-0075', roleDescription: 'Ashish Hajare -> Munaf Multani' },
  { employeeCode: 'ACS-0073', expectedManagerCode: 'ACS-0070', roleDescription: 'Jigar Nayak -> Dhrupin Vaghasiya' },
  { employeeCode: 'ACS-0083', expectedManagerCode: 'ACS-0070', roleDescription: 'Tejas Rokade -> Dhrupin Vaghasiya' },
  { employeeCode: 'ACS-0072', expectedManagerCode: 'ACS-0074', roleDescription: 'Anurag Vaishnav -> Paras Prajapati' },
  { employeeCode: 'ACS-0080', expectedManagerCode: 'ACS-0063', roleDescription: 'Harmitsinh Udavat -> Parth Nagar' },
];

const DESIGNATION_UPDATES = [
  {
    employeeCode: 'ACS-0080',
    expectedDesignation: 'Service Engineer',
    personName: 'Harmitsinh Udavat',
  },
];

async function main() {
  console.log('====================================================');
  console.log('  PM TEAM REPORTING LINES & DESIGNATION UPDATES     ');
  console.log('====================================================\n');

  // Load all users involved
  const codes = new Set<string>();
  for (const item of REPORTING_LINE_UPDATES) {
    codes.add(item.employeeCode);
    codes.add(item.expectedManagerCode);
  }
  for (const item of DESIGNATION_UPDATES) {
    codes.add(item.employeeCode);
  }

  const users = await prisma.user.findMany({
    where: { employeeCode: { in: Array.from(codes) } },
    select: {
      id: true,
      employeeCode: true,
      fullName: true,
      designation: true,
      managerId: true,
    },
  });

  const byCode = new Map(users.map((u) => [u.employeeCode, u]));
  const byId = new Map(users.map((u) => [u.id, u]));

  console.log('1. Checking and updating reporting lines (matching by employeeCode):');
  let managerUpdatesCount = 0;

  for (const update of REPORTING_LINE_UPDATES) {
    const employee = byCode.get(update.employeeCode);
    const expectedManager = byCode.get(update.expectedManagerCode);

    if (!employee) {
      console.warn(`   [WARN] Employee with code ${update.employeeCode} not found in database! Skipping.`);
      continue;
    }
    if (!expectedManager) {
      console.warn(`   [WARN] Manager with code ${update.expectedManagerCode} not found in database! Skipping.`);
      continue;
    }

    if (employee.managerId === expectedManager.id) {
      console.log(`   - [OK] ${employee.fullName} (${employee.employeeCode}) already reports to ${expectedManager.fullName} (${expectedManager.employeeCode})`);
    } else {
      const currentManager = employee.managerId ? byId.get(employee.managerId) : null;
      const currentManagerText = currentManager
        ? `${currentManager.fullName} (${currentManager.employeeCode})`
        : employee.managerId
        ? `User ID ${employee.managerId}`
        : 'None';

      await prisma.user.update({
        where: { id: employee.id },
        data: { managerId: expectedManager.id },
      });

      console.log(
        `   - [UPDATED] ${employee.fullName} (${employee.employeeCode}): manager changed from ${currentManagerText} -> ${expectedManager.fullName} (${expectedManager.employeeCode})`
      );
      managerUpdatesCount++;
    }
  }

  console.log(`\nReporting lines checked: ${REPORTING_LINE_UPDATES.length}, updated: ${managerUpdatesCount}.\n`);

  console.log('2. Checking and updating designations:');
  let designationUpdatesCount = 0;

  for (const item of DESIGNATION_UPDATES) {
    const employee = byCode.get(item.employeeCode);
    if (!employee) {
      console.warn(`   [WARN] Employee with code ${item.employeeCode} not found! Skipping.`);
      continue;
    }

    if (employee.designation === item.expectedDesignation) {
      console.log(`   - [OK] ${employee.fullName} (${employee.employeeCode}) designation is already '${item.expectedDesignation}'`);
    } else {
      await prisma.user.update({
        where: { id: employee.id },
        data: { designation: item.expectedDesignation },
      });
      console.log(
        `   - [UPDATED] ${employee.fullName} (${employee.employeeCode}): designation changed from '${employee.designation}' -> '${item.expectedDesignation}'`
      );
      designationUpdatesCount++;
    }
  }

  console.log(`\nDesignations checked: ${DESIGNATION_UPDATES.length}, updated: ${designationUpdatesCount}.\n`);

  // Summary verification
  console.log('3. Verification summary for Squad Leads & reporting hierarchy:');
  const dilip = byCode.get('ACS-0061');
  if (dilip) {
    const squadLeads = await prisma.user.findMany({
      where: { managerId: dilip.id },
      select: { employeeCode: true, fullName: true, designation: true },
    });
    console.log(`   Reports under Dilip Asediya (${dilip.fullName}):`);
    for (const lead of squadLeads) {
      console.log(`     * ${lead.fullName} (${lead.employeeCode}) - ${lead.designation}`);
    }
  }

  console.log('\n==> PM team update completed successfully.');
}

main()
  .catch((e) => {
    console.error('[ERROR] Failed to update PM team:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
