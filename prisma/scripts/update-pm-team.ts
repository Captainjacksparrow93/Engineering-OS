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
  console.log('  PM TEAM & ROSTER UPDATE RUNNER (§3b, §3c, §3e, §3f)');
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
  codes.add('ACS-0081'); // Krupesh Solanki
  codes.add('ACS-0057'); // Amey Kulkarni
  codes.add('ACS-0070'); // Dhrupin Vaghasiya
  codes.add('ACS-0075'); // Munaf Multani

  const users = await prisma.user.findMany({
    where: { employeeCode: { in: Array.from(codes) } },
    select: {
      id: true,
      employeeCode: true,
      fullName: true,
      designation: true,
      departmentId: true,
      managerId: true,
    },
  });

  const byCode = new Map(users.map((u) => [u.employeeCode, u]));
  const byId = new Map(users.map((u) => [u.id, u]));

  // ------------------------------------------------------------------- 1. Reporting Lines (§3b)
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

  console.log(`   => Reporting lines checked: ${REPORTING_LINE_UPDATES.length}, updated: ${managerUpdatesCount}.\n`);

  // ------------------------------------------------------------------- 2. Designations (§3c)
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

  console.log(`   => Designations checked: ${DESIGNATION_UPDATES.length}, updated: ${designationUpdatesCount}.\n`);

  // ------------------------------------------------------------------- 3. Krupesh Solanki moves to QC (§3f)
  console.log('3. Krupesh Solanki (ACS-0081) department & manager transfer (§3f):');
  const krupesh = byCode.get('ACS-0081');
  const amey = byCode.get('ACS-0057');

  if (!krupesh) {
    throw new Error('FATAL: User ACS-0081 (Krupesh Solanki) not found in database.');
  }
  if (!amey) {
    throw new Error('FATAL: Manager ACS-0057 (Amey Kulkarni) not found in database.');
  }

  const qcDept = await prisma.department.findFirst({
    where: { code: 'QC' },
  });
  if (!qcDept) {
    throw new Error("FATAL: Department with code 'QC' (Quality Control & Testing) not found in database!");
  }

  if (krupesh.departmentId === qcDept.id && krupesh.managerId === amey.id) {
    console.log(`   - [OK] ${krupesh.fullName} (ACS-0081) is already in department '${qcDept.name}' (QC) reporting to ${amey.fullName} (ACS-0057).`);
  } else {
    const prevDept = krupesh.departmentId
      ? await prisma.department.findUnique({ where: { id: krupesh.departmentId } })
      : null;
    const prevManager = krupesh.managerId ? byId.get(krupesh.managerId) : null;

    await prisma.user.update({
      where: { id: krupesh.id },
      data: {
        departmentId: qcDept.id,
        managerId: amey.id,
      },
    });

    console.log(
      `   - [UPDATED] ${krupesh.fullName} (ACS-0081):\n` +
      `       Department: ${prevDept?.name ?? 'None'} (${prevDept?.code ?? 'N/A'}) -> ${qcDept.name} (QC)\n` +
      `       Manager:    ${prevManager ? `${prevManager.fullName} (${prevManager.employeeCode})` : 'None'} -> ${amey.fullName} (ACS-0057)`
    );
  }
  console.log('');

  // ------------------------------------------------------------------- 4. Role Grants for Asst Managers (§3e)
  console.log('4. Role adjustments for Assistant Managers (§3e):');
  const asstManagerRole = await prisma.role.findFirst({
    where: { key: 'ASST_MANAGER' },
  });
  if (!asstManagerRole) {
    throw new Error("FATAL: Role 'ASST_MANAGER' not found in database! Ensure seed or permission migration has run.");
  }

  const seniorEngineerRole = await prisma.role.findFirst({
    where: { key: 'SENIOR_ENGINEER' },
  });
  if (!seniorEngineerRole) {
    throw new Error("FATAL: Role 'SENIOR_ENGINEER' not found in database!");
  }

  const asstManagers = ['ACS-0070', 'ACS-0075']; // Dhrupin Vaghasiya, Munaf Multani
  for (const code of asstManagers) {
    const user = byCode.get(code);
    if (!user) {
      console.warn(`   [WARN] User with code ${code} not found! Skipping.`);
      continue;
    }

    // 4a. Ensure ASST_MANAGER (GLOBAL)
    const existingAsstManager = await prisma.roleAssignment.findFirst({
      where: {
        userId: user.id,
        roleId: asstManagerRole.id,
        scopeType: 'GLOBAL',
      },
    });

    if (existingAsstManager) {
      console.log(`   - [OK] ${user.fullName} (${user.employeeCode}) already has role ASST_MANAGER (GLOBAL).`);
    } else {
      await prisma.roleAssignment.create({
        data: {
          userId: user.id,
          roleId: asstManagerRole.id,
          scopeType: 'GLOBAL',
          scopeId: null,
        },
      });
      console.log(`   - [GRANTED] ASST_MANAGER (GLOBAL) granted to ${user.fullName} (${user.employeeCode}).`);
    }

    // 4b. Remove SENIOR_ENGINEER role so they are not treated as assignable engineers
    const deletedSeniorEng = await prisma.roleAssignment.deleteMany({
      where: {
        userId: user.id,
        roleId: seniorEngineerRole.id,
      },
    });

    if (deletedSeniorEng.count > 0) {
      console.log(`   - [REMOVED] Removed ${deletedSeniorEng.count} SENIOR_ENGINEER role assignment(s) from ${user.fullName} (${user.employeeCode}).`);
    } else {
      console.log(`   - [OK] ${user.fullName} (${user.employeeCode}) does not hold SENIOR_ENGINEER.`);
    }
  }
  console.log('');

  // ------------------------------------------------------------------- 5. Verification Summary
  console.log('5. Verification summary:');

  // Check eligible project owners (PROJECT_MANAGER or ASST_MANAGER)
  const projectOwners = await prisma.user.findMany({
    where: {
      roleAssignments: {
        some: {
          role: { key: { in: ['PROJECT_MANAGER', 'ASST_MANAGER'] } },
        },
      },
    },
    select: {
      employeeCode: true,
      fullName: true,
      designation: true,
      roleAssignments: { select: { role: { select: { key: true } } } },
    },
    orderBy: { employeeCode: 'asc' },
  });

  console.log(`   Eligible Project Owners in Wizard (found ${projectOwners.length}, expected 4: Parth, Paras, Munaf, Dhrupin):`);
  for (const owner of projectOwners) {
    const roles = owner.roleAssignments.map((r) => r.role.key).join(', ');
    console.log(`     * ${owner.fullName} (${owner.employeeCode}) - ${owner.designation} [${roles}]`);
  }

  // Check squads under the 4 leads
  const leadsToCheck = ['ACS-0063', 'ACS-0075', 'ACS-0070', 'ACS-0074'];
  console.log('\n   Squad breakdowns:');
  for (const leadCode of leadsToCheck) {
    const lead = byCode.get(leadCode);
    if (!lead) continue;
    const reports = await prisma.user.findMany({
      where: { managerId: lead.id },
      select: { employeeCode: true, fullName: true, designation: true },
      orderBy: { employeeCode: 'asc' },
    });
    console.log(`     Lead: ${lead.fullName} (${lead.employeeCode}) - ${reports.length} report(s):`);
    for (const r of reports) {
      console.log(`       - ${r.fullName} (${r.employeeCode}) [${r.designation}]`);
    }
  }

  // Check Krupesh Solanki
  const updatedKrupesh = await prisma.user.findUnique({
    where: { employeeCode: 'ACS-0081' },
    select: {
      fullName: true,
      employeeCode: true,
      department: { select: { name: true, code: true } },
      manager: { select: { fullName: true, employeeCode: true } },
    },
  });
  console.log('\n   Krupesh Solanki placement check:');
  console.log(`     ${updatedKrupesh?.fullName} (${updatedKrupesh?.employeeCode}) is in department '${updatedKrupesh?.department?.name}' (${updatedKrupesh?.department?.code}) under manager ${updatedKrupesh?.manager?.fullName} (${updatedKrupesh?.manager?.employeeCode})`);

  console.log('\n==> PM team, roles and roster updates completed successfully.');
}

main()
  .catch((e) => {
    console.error('\n[ERROR] Update failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
