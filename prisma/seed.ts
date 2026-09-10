/**
 * Seed data for a panel-manufacturing company.
 *
 * Produces a realistic slice: a real department tree, people at every grade, three
 * live projects with a WBS, cross-task dependencies, assignments, progress history,
 * a pending handover and some approved leave - enough that every screen in the
 * Project Management module has something meaningful to show on first run.
 */
import { PrismaClient, type Grade, type ScopeType } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { ALL_PERMISSIONS, PERMISSIONS, SYSTEM_ROLES } from '../src/core/rbac/permissions';
import { MODULES } from '../src/core/modules/registry';

const prisma = new PrismaClient();

const PASSWORD: string = process.env.SEED_PASSWORD ?? '';
if (!PASSWORD) {
  throw new Error('Set SEED_PASSWORD in your environment before seeding.');
}

const COLOURS = ['#2f5fd8', '#0f9d58', '#d93025', '#f4b400', '#7b1fa2', '#00838f', '#ef6c00', '#5d4037'];
const colourFor = (seed: string) => {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) % 997;
  return COLOURS[hash % COLOURS.length]!;
};

const day = (offsetDays: number) => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d;
};

async function main() {
  console.log('Seeding Engineering OS...');

  // ---------------------------------------------------------------- permissions
  for (const key of ALL_PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key },
      create: { key, module: key.split('.')[0]!, description: PERMISSIONS[key] },
      update: { description: PERMISSIONS[key], module: key.split('.')[0]! },
    });
  }
  const permissionRows = await prisma.permission.findMany();
  const permissionId = new Map(permissionRows.map((p) => [p.key, p.id]));

  // ---------------------------------------------------------------------- roles
  for (const [key, definition] of Object.entries(SYSTEM_ROLES)) {
    const role = await prisma.role.upsert({
      where: { key },
      create: { key, name: definition.name, description: definition.description, isSystem: true },
      update: { name: definition.name, description: definition.description, isSystem: true },
    });
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: definition.permissions
        .map((p) => permissionId.get(p))
        .filter((id): id is string => Boolean(id))
        .map((id) => ({ roleId: role.id, permissionId: id })),
      skipDuplicates: true,
    });
  }
  const roles = await prisma.role.findMany();
  const roleId = new Map(roles.map((r) => [r.key, r.id]));

  // ------------------------------------------------------------ module registry
  for (const module of MODULES) {
    await prisma.moduleRegistryEntry.upsert({
      where: { key: module.key },
      create: {
        key: module.key,
        name: module.name,
        description: module.description,
        icon: module.icon,
        route: module.route,
        status: module.status,
        plannedFor: module.plannedFor,
        sortOrder: module.sortOrder,
      },
      update: { status: module.status, plannedFor: module.plannedFor, sortOrder: module.sortOrder },
    });
  }

  // -------------------------------------------------------------------- company
  const company = await prisma.company.upsert({
    where: { code: 'VSPL' },
    create: {
      code: 'VSPL',
      name: 'Vidyut Switchgear Pvt Ltd',
      gstin: '27AABCV1234M1Z5',
      address: 'Plot 42, MIDC Industrial Area, Pune 411026',
    },
    update: {},
  });

  const departmentTree: Array<{ code: string; name: string; parent?: string }> = [
    { code: 'ENG', name: 'Engineering' },
    { code: 'ELEC', name: 'Electrical Design', parent: 'ENG' },
    { code: 'MECH', name: 'Mechanical Design', parent: 'ENG' },
    { code: 'AUTO', name: 'Automation & Software', parent: 'ENG' },
    { code: 'PMO', name: 'Project Management Office' },
    { code: 'PROD', name: 'Production' },
    { code: 'QA', name: 'Quality Assurance' },
    { code: 'SCM', name: 'Supply Chain' },
  ];

  const departmentId = new Map<string, string>();
  for (const dept of departmentTree) {
    const created = await prisma.department.upsert({
      where: { companyId_code: { companyId: company.id, code: dept.code } },
      create: {
        companyId: company.id,
        code: dept.code,
        name: dept.name,
        parentId: dept.parent ? departmentId.get(dept.parent) : null,
      },
      update: { parentId: dept.parent ? departmentId.get(dept.parent) : null },
    });
    departmentId.set(dept.code, created.id);
  }

  // ---------------------------------------------------------------------- people
  const passwordHash = await bcrypt.hash(PASSWORD, 12);

  interface PersonSeed {
    code: string;
    name: string;
    email: string;
    designation: string;
    grade: Grade;
    dept?: string;
    manager?: string;
    skills: string[];
    capacity?: number;
    roles: Array<{ key: string; scopeType: ScopeType; scope?: string }>;
  }

  const people: PersonSeed[] = [
    {
      code: 'VS-0001',
      name: 'Admin Controller',
      email: 'admin@vidyutswitchgear.com',
      designation: 'System Administrator',
      grade: 'MANAGER',
      skills: [],
      roles: [{ key: 'SUPER_ADMIN', scopeType: 'GLOBAL' }],
    },
    {
      code: 'VS-0002',
      name: 'Rajesh Deshmukh',
      email: 'rajesh.deshmukh@vidyutswitchgear.com',
      designation: 'Director - Operations',
      grade: 'DIRECTOR',
      skills: ['portfolio planning'],
      roles: [{ key: 'DIRECTOR', scopeType: 'GLOBAL' }],
    },
    {
      code: 'VS-0003',
      name: 'Meera Iyer',
      email: 'meera.iyer@vidyutswitchgear.com',
      designation: 'Head - Engineering',
      grade: 'HEAD',
      dept: 'ENG',
      manager: 'VS-0002',
      skills: ['LV switchgear', 'design review'],
      roles: [{ key: 'DEPARTMENT_HEAD', scopeType: 'DEPARTMENT', scope: 'ENG' }],
    },
    {
      code: 'VS-0004',
      name: 'Anil Kulkarni',
      email: 'anil.kulkarni@vidyutswitchgear.com',
      designation: 'Head - PMO',
      grade: 'HEAD',
      dept: 'PMO',
      manager: 'VS-0002',
      skills: ['scheduling', 'client coordination'],
      roles: [
        { key: 'DEPARTMENT_HEAD', scopeType: 'DEPARTMENT', scope: 'PMO' },
        { key: 'DEPARTMENT_HEAD', scopeType: 'DEPARTMENT', scope: 'ENG' },
      ],
    },
    {
      code: 'VS-0005',
      name: 'Priya Nair',
      email: 'priya.nair@vidyutswitchgear.com',
      designation: 'Senior Project Manager',
      grade: 'MANAGER',
      dept: 'PMO',
      manager: 'VS-0004',
      skills: ['MCC panels', 'scheduling'],
      roles: [],
    },
    {
      code: 'VS-0006',
      name: 'Sameer Joshi',
      email: 'sameer.joshi@vidyutswitchgear.com',
      designation: 'Project Manager',
      grade: 'MANAGER',
      dept: 'PMO',
      manager: 'VS-0004',
      skills: ['PCC panels', 'costing'],
      roles: [],
    },
    {
      code: 'VS-0007',
      name: 'Kavita Rao',
      email: 'kavita.rao@vidyutswitchgear.com',
      designation: 'Lead Engineer - Electrical',
      grade: 'LEAD_ENGINEER',
      dept: 'ELEC',
      manager: 'VS-0003',
      skills: ['schematics', 'busbar sizing', 'EPLAN', 'relay logic'],
      roles: [{ key: 'SENIOR_ENGINEER', scopeType: 'DEPARTMENT', scope: 'ELEC' }],
    },
    {
      code: 'VS-0008',
      name: 'Vikram Shah',
      email: 'vikram.shah@vidyutswitchgear.com',
      designation: 'Senior Design Engineer',
      grade: 'SENIOR_ENGINEER',
      dept: 'ELEC',
      manager: 'VS-0007',
      skills: ['schematics', 'EPLAN', 'GA drawing'],
      roles: [{ key: 'SENIOR_ENGINEER', scopeType: 'DEPARTMENT', scope: 'ELEC' }],
    },
    {
      code: 'VS-0009',
      name: 'Farhan Qureshi',
      email: 'farhan.qureshi@vidyutswitchgear.com',
      designation: 'Design Engineer',
      grade: 'ENGINEER',
      dept: 'ELEC',
      manager: 'VS-0007',
      skills: ['schematics', 'BOM', 'cable schedule'],
      roles: [{ key: 'JUNIOR_ENGINEER', scopeType: 'DEPARTMENT', scope: 'ELEC' }],
    },
    {
      code: 'VS-0010',
      name: 'Sneha Patil',
      email: 'sneha.patil@vidyutswitchgear.com',
      designation: 'Junior Design Engineer',
      grade: 'JUNIOR_ENGINEER',
      dept: 'ELEC',
      manager: 'VS-0008',
      skills: ['BOM', 'cable schedule'],
      capacity: 8,
      roles: [{ key: 'JUNIOR_ENGINEER', scopeType: 'DEPARTMENT', scope: 'ELEC' }],
    },
    {
      code: 'VS-0011',
      name: 'Arjun Menon',
      email: 'arjun.menon@vidyutswitchgear.com',
      designation: 'Senior Engineer - Mechanical',
      grade: 'SENIOR_ENGINEER',
      dept: 'MECH',
      manager: 'VS-0003',
      skills: ['sheet metal', 'enclosure design', 'SolidWorks'],
      roles: [{ key: 'SENIOR_ENGINEER', scopeType: 'DEPARTMENT', scope: 'MECH' }],
    },
    {
      code: 'VS-0012',
      name: 'Divya Sharma',
      email: 'divya.sharma@vidyutswitchgear.com',
      designation: 'Junior Engineer - Mechanical',
      grade: 'JUNIOR_ENGINEER',
      dept: 'MECH',
      manager: 'VS-0011',
      skills: ['sheet metal', 'SolidWorks'],
      roles: [{ key: 'JUNIOR_ENGINEER', scopeType: 'DEPARTMENT', scope: 'MECH' }],
    },
    {
      code: 'VS-0013',
      name: 'Imran Sheikh',
      email: 'imran.sheikh@vidyutswitchgear.com',
      designation: 'Automation Engineer',
      grade: 'ENGINEER',
      dept: 'AUTO',
      manager: 'VS-0003',
      skills: ['PLC', 'SCADA', 'relay logic'],
      roles: [{ key: 'SENIOR_ENGINEER', scopeType: 'DEPARTMENT', scope: 'AUTO' }],
    },
    {
      code: 'VS-0014',
      name: 'Neha Bhosale',
      email: 'neha.bhosale@vidyutswitchgear.com',
      designation: 'Quality Engineer',
      grade: 'ENGINEER',
      dept: 'QA',
      manager: 'VS-0002',
      skills: ['routine testing', 'IEC 61439'],
      roles: [{ key: 'JUNIOR_ENGINEER', scopeType: 'DEPARTMENT', scope: 'QA' }],
    },
    {
      code: 'VS-0015',
      name: 'Ganesh Pawar',
      email: 'ganesh.pawar@vidyutswitchgear.com',
      designation: 'Production Supervisor',
      grade: 'SENIOR_ENGINEER',
      dept: 'PROD',
      manager: 'VS-0002',
      skills: ['wiring', 'assembly', 'busbar fabrication'],
      roles: [{ key: 'SENIOR_ENGINEER', scopeType: 'DEPARTMENT', scope: 'PROD' }],
    },
  ];

  const userId = new Map<string, string>();
  for (const person of people) {
    const user = await prisma.user.upsert({
      where: { employeeCode: person.code },
      create: {
        companyId: company.id,
        employeeCode: person.code,
        email: person.email,
        passwordHash,
        fullName: person.name,
        designation: person.designation,
        grade: person.grade,
        departmentId: person.dept ? departmentId.get(person.dept) : null,
        dailyCapacityHours: person.capacity ?? 8,
        skills: person.skills,
        avatarColor: colourFor(person.name),
      },
      update: { passwordHash, skills: person.skills, designation: person.designation },
    });
    userId.set(person.code, user.id);
  }

  // Reporting lines need every user to exist first.
  for (const person of people) {
    if (!person.manager) continue;
    await prisma.user.update({
      where: { id: userId.get(person.code)! },
      data: { managerId: userId.get(person.manager) ?? null },
    });
  }

  await prisma.department.update({ where: { id: departmentId.get('ENG')! }, data: { headId: userId.get('VS-0003') } });
  await prisma.department.update({ where: { id: departmentId.get('PMO')! }, data: { headId: userId.get('VS-0004') } });

  for (const person of people) {
    for (const grant of person.roles) {
      const rid = roleId.get(grant.key);
      if (!rid) continue;
      const scopeId = grant.scope ? departmentId.get(grant.scope) ?? null : null;
      const existing = await prisma.roleAssignment.findFirst({
        where: { userId: userId.get(person.code)!, roleId: rid, scopeType: grant.scopeType, scopeId },
      });
      if (!existing) {
        await prisma.roleAssignment.create({
          data: { userId: userId.get(person.code)!, roleId: rid, scopeType: grant.scopeType, scopeId },
        });
      }
    }
  }

  // ------------------------------------------------------------------- projects
  const projectSeeds = [
    {
      code: 'PRJ-2026-001',
      name: 'Tata Chemicals - MCC & PCC Panels',
      clientName: 'Tata Chemicals Ltd',
      poNumber: 'TCL/PO/2026/0781',
      orderValue: 12_400_000,
      panelType: 'MCC + PCC, IP54, IEC 61439',
      panelCount: 14,
      priority: 'HIGH' as const,
      status: 'IN_PROGRESS' as const,
      startDate: day(-30),
      targetEndDate: day(45),
      manager: 'VS-0005',
      department: 'PMO',
    },
    {
      code: 'PRJ-2026-002',
      name: 'Sunrise Cement - APFC & Feeder Pillars',
      clientName: 'Sunrise Cement Industries',
      poNumber: 'SCI/PO/26/114',
      orderValue: 5_600_000,
      panelType: 'APFC 400kVAr + Feeder Pillar',
      panelCount: 6,
      priority: 'MEDIUM' as const,
      status: 'IN_PROGRESS' as const,
      startDate: day(-12),
      targetEndDate: day(60),
      manager: 'VS-0006',
      department: 'PMO',
    },
    {
      code: 'PRJ-2026-003',
      name: 'Godrej Foods - PLC Automation Panels',
      clientName: 'Godrej Foods Pvt Ltd',
      poNumber: 'GF/PO/2026/0034',
      orderValue: 8_900_000,
      panelType: 'PLC control panels with SCADA',
      panelCount: 9,
      priority: 'CRITICAL' as const,
      status: 'PLANNING' as const,
      startDate: day(-4),
      targetEndDate: day(75),
      manager: 'VS-0005',
      department: 'PMO',
    },
  ];

  const projectId = new Map<string, string>();
  for (const seed of projectSeeds) {
    const project = await prisma.project.upsert({
      where: { code: seed.code },
      create: {
        companyId: company.id,
        code: seed.code,
        name: seed.name,
        clientName: seed.clientName,
        description: `Design, manufacture, test and dispatch of ${seed.panelType}.`,
        poNumber: seed.poNumber,
        orderValue: seed.orderValue,
        panelType: seed.panelType,
        panelCount: seed.panelCount,
        priority: seed.priority,
        status: seed.status,
        startDate: seed.startDate,
        targetEndDate: seed.targetEndDate,
        managerId: userId.get(seed.manager)!,
        sponsorId: userId.get('VS-0002'),
        departmentId: departmentId.get(seed.department),
      },
      update: {},
    });
    projectId.set(seed.code, project.id);

    await prisma.projectMember.upsert({
      where: { projectId_userId: { projectId: project.id, userId: userId.get(seed.manager)! } },
      create: { projectId: project.id, userId: userId.get(seed.manager)!, role: 'MANAGER' },
      update: {},
    });

    const pmRole = roleId.get('PROJECT_MANAGER');
    if (pmRole) {
      const existing = await prisma.roleAssignment.findFirst({
        where: { userId: userId.get(seed.manager)!, roleId: pmRole, scopeType: 'PROJECT', scopeId: project.id },
      });
      if (!existing) {
        await prisma.roleAssignment.create({
          data: { userId: userId.get(seed.manager)!, roleId: pmRole, scopeType: 'PROJECT', scopeId: project.id },
        });
      }
    }
  }

  // ---------------------------------------------------------------------- tasks
  interface TaskSeed {
    key: string;
    project: string;
    title: string;
    parent?: string;
    type?: 'PROJECT' | 'ADHOC' | 'PHASE';
    hours: number;
    priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    start: number;
    end: number;
    skills?: string[];
    assignee?: string;
    percent?: number;
    status?: 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'COMPLETED' | 'BLOCKED';
    dependsOn?: Array<{ on: string; type?: 'FINISH_TO_START' | 'START_TO_START' | 'FINISH_TO_FINISH'; lag?: number }>;
  }

  const taskSeeds: TaskSeed[] = [
    // ---- PRJ-2026-001 -------------------------------------------------------
    { key: 'P1-PH1', project: 'PRJ-2026-001', title: 'Engineering & Design', type: 'PHASE', hours: 0, start: -30, end: 5 },
    {
      key: 'P1-T1', project: 'PRJ-2026-001', parent: 'P1-PH1', title: 'General arrangement drawings for MCC',
      hours: 32, start: -30, end: -22, skills: ['GA drawing', 'EPLAN'], assignee: 'VS-0008', percent: 100, status: 'COMPLETED',
    },
    {
      key: 'P1-T2', project: 'PRJ-2026-001', parent: 'P1-PH1', title: 'Power & control schematics - MCC feeders',
      hours: 48, start: -21, end: -10, skills: ['schematics', 'EPLAN'], assignee: 'VS-0007', percent: 100, status: 'COMPLETED',
      dependsOn: [{ on: 'P1-T1' }],
    },
    {
      key: 'P1-T3', project: 'PRJ-2026-001', parent: 'P1-PH1', title: 'Busbar sizing and short-circuit calculations',
      hours: 24, start: -20, end: -14, skills: ['busbar sizing'], assignee: 'VS-0007', percent: 100, status: 'COMPLETED',
      dependsOn: [{ on: 'P1-T1', type: 'START_TO_START', lag: 2 }],
    },
    {
      key: 'P1-T4', project: 'PRJ-2026-001', parent: 'P1-PH1', title: 'Bill of material and cable schedule',
      hours: 28, start: -9, end: -2, skills: ['BOM', 'cable schedule'], assignee: 'VS-0009', percent: 65, status: 'IN_PROGRESS',
      dependsOn: [{ on: 'P1-T2' }, { on: 'P1-T3' }],
    },
    {
      key: 'P1-T5', project: 'PRJ-2026-001', parent: 'P1-PH1', title: 'Enclosure fabrication drawings',
      hours: 36, start: -8, end: 2, skills: ['sheet metal', 'SolidWorks'], assignee: 'VS-0011', percent: 40, status: 'IN_PROGRESS',
      dependsOn: [{ on: 'P1-T1' }],
    },
    {
      key: 'P1-T6', project: 'PRJ-2026-001', parent: 'P1-PH1', title: 'Customer drawing approval follow-up',
      hours: 12, start: 0, end: 6, priority: 'HIGH', assignee: 'VS-0005', percent: 0, status: 'TODO',
      dependsOn: [{ on: 'P1-T4' }, { on: 'P1-T5' }],
    },
    { key: 'P1-PH2', project: 'PRJ-2026-001', title: 'Manufacturing', type: 'PHASE', hours: 0, start: 5, end: 35 },
    {
      key: 'P1-T7', project: 'PRJ-2026-001', parent: 'P1-PH2', title: 'Busbar fabrication and plating',
      hours: 60, start: 6, end: 18, priority: 'HIGH', skills: ['busbar fabrication'], assignee: 'VS-0015', status: 'TODO',
      dependsOn: [{ on: 'P1-T6' }],
    },
    {
      key: 'P1-T8', project: 'PRJ-2026-001', parent: 'P1-PH2', title: 'Panel wiring - 14 panels',
      hours: 160, start: 12, end: 32, priority: 'HIGH', skills: ['wiring', 'assembly'], assignee: 'VS-0015', status: 'TODO',
      dependsOn: [{ on: 'P1-T7', type: 'START_TO_START', lag: 3 }],
    },
    {
      key: 'P1-T9', project: 'PRJ-2026-001', parent: 'P1-PH2', title: 'Routine testing as per IEC 61439',
      hours: 40, start: 33, end: 40, priority: 'CRITICAL', skills: ['routine testing', 'IEC 61439'], assignee: 'VS-0014', status: 'TODO',
      dependsOn: [{ on: 'P1-T8' }],
    },
    {
      key: 'P1-ADHOC1', project: 'PRJ-2026-001', title: 'URGENT: rework feeder 7 schematic after client comment',
      type: 'ADHOC', hours: 6, start: 0, end: 1, priority: 'CRITICAL', skills: ['schematics'], assignee: 'VS-0008',
      percent: 30, status: 'IN_PROGRESS',
    },

    // ---- PRJ-2026-002 -------------------------------------------------------
    { key: 'P2-PH1', project: 'PRJ-2026-002', title: 'Design', type: 'PHASE', hours: 0, start: -12, end: 12 },
    {
      key: 'P2-T1', project: 'PRJ-2026-002', parent: 'P2-PH1', title: 'APFC panel sizing and capacitor bank selection',
      hours: 24, start: -12, end: -6, skills: ['schematics'], assignee: 'VS-0007', percent: 100, status: 'COMPLETED',
    },
    {
      key: 'P2-T2', project: 'PRJ-2026-002', parent: 'P2-PH1', title: 'Feeder pillar GA and foundation details',
      hours: 30, start: -5, end: 4, skills: ['enclosure design'], assignee: 'VS-0012', percent: 45, status: 'IN_PROGRESS',
      dependsOn: [{ on: 'P2-T1' }],
    },
    {
      key: 'P2-T3', project: 'PRJ-2026-002', parent: 'P2-PH1', title: 'Relay logic and protection settings',
      hours: 20, start: 2, end: 9, skills: ['relay logic'], assignee: 'VS-0013', status: 'TODO',
      dependsOn: [{ on: 'P2-T1' }],
    },
    {
      key: 'P2-T4', project: 'PRJ-2026-002', parent: 'P2-PH1', title: 'BOM release to purchase',
      hours: 16, start: 5, end: 11, priority: 'HIGH', skills: ['BOM'], assignee: 'VS-0010', status: 'TODO',
      dependsOn: [{ on: 'P2-T2' }, { on: 'P2-T3' }],
    },

    // ---- PRJ-2026-003 -------------------------------------------------------
    { key: 'P3-PH1', project: 'PRJ-2026-003', title: 'Requirement & Design', type: 'PHASE', hours: 0, start: -4, end: 25 },
    {
      key: 'P3-T1', project: 'PRJ-2026-003', parent: 'P3-PH1', title: 'IO list finalisation with client',
      hours: 20, start: -4, end: 3, priority: 'CRITICAL', skills: ['PLC'], assignee: 'VS-0013', percent: 55, status: 'IN_PROGRESS',
    },
    {
      key: 'P3-T2', project: 'PRJ-2026-003', parent: 'P3-PH1', title: 'PLC panel schematics',
      hours: 40, start: 4, end: 14, priority: 'HIGH', skills: ['schematics', 'PLC'], assignee: 'VS-0008', status: 'TODO',
      dependsOn: [{ on: 'P3-T1' }],
    },
    {
      key: 'P3-T3', project: 'PRJ-2026-003', parent: 'P3-PH1', title: 'SCADA screen development',
      hours: 56, start: 6, end: 22, priority: 'HIGH', skills: ['SCADA'], status: 'TODO',
      dependsOn: [{ on: 'P3-T1', type: 'FINISH_TO_START', lag: 2 }],
    },
    {
      key: 'P3-T4', project: 'PRJ-2026-003', parent: 'P3-PH1', title: 'Enclosure design for PLC panels',
      hours: 32, start: 4, end: 15, skills: ['enclosure design', 'SolidWorks'], status: 'TODO',
      dependsOn: [{ on: 'P3-T1' }],
    },
  ];

  const taskId = new Map<string, string>();
  const counters = new Map<string, number>();

  for (const seed of taskSeeds) {
    const pid = projectId.get(seed.project)!;
    const next = (counters.get(seed.project) ?? 0) + 1;
    counters.set(seed.project, next);
    const code = `${seed.project}-T${String(next).padStart(3, '0')}`;

    const existing = await prisma.task.findFirst({ where: { projectId: pid, title: seed.title } });
    const task =
      existing ??
      (await prisma.task.create({
        data: {
          projectId: pid,
          parentId: seed.parent ? taskId.get(seed.parent) : null,
          code,
          title: seed.title,
          description: `${seed.title} for ${seed.project}.`,
          type: seed.type ?? 'PROJECT',
          status: seed.status ?? 'TODO',
          priority: seed.priority ?? 'MEDIUM',
          estimatedHours: seed.hours || 8,
          percentComplete: seed.percent ?? 0,
          plannedStart: day(seed.start),
          plannedEnd: day(seed.end),
          actualStart: seed.status && seed.status !== 'TODO' ? day(seed.start) : null,
          actualEnd: seed.status === 'COMPLETED' ? day(seed.end) : null,
          requiredSkills: seed.skills ?? [],
          createdById: userId.get('VS-0004')!,
        },
      }));
    taskId.set(seed.key, task.id);

    if (seed.assignee) {
      const already = await prisma.taskAssignment.findFirst({ where: { taskId: task.id, userId: userId.get(seed.assignee)! } });
      if (!already) {
        await prisma.taskAssignment.create({
          data: {
            taskId: task.id,
            userId: userId.get(seed.assignee)!,
            role: 'OWNER',
            status: seed.status === 'COMPLETED' ? 'COMPLETED' : 'ACTIVE',
            allocatedHours: seed.hours || 8,
            assignedById: userId.get('VS-0004')!,
          },
        });
      }
      await prisma.projectMember.upsert({
        where: { projectId_userId: { projectId: pid, userId: userId.get(seed.assignee)! } },
        create: { projectId: pid, userId: userId.get(seed.assignee)!, role: 'ENGINEER' },
        update: {},
      });
    }
  }

  for (const seed of taskSeeds) {
    for (const dependency of seed.dependsOn ?? []) {
      const predecessorId = taskId.get(dependency.on);
      const successorId = taskId.get(seed.key);
      if (!predecessorId || !successorId) continue;
      await prisma.taskDependency.upsert({
        where: { predecessorId_successorId: { predecessorId, successorId } },
        create: {
          predecessorId,
          successorId,
          type: dependency.type ?? 'FINISH_TO_START',
          lagDays: dependency.lag ?? 0,
        },
        update: {},
      });
    }
  }

  // -------------------------------------------------------------- progress logs
  const progressSeeds = [
    { task: 'P1-T4', user: 'VS-0009', percent: 30, hours: 6, days: -6, note: 'Completed BOM for incomer and 4 outgoing feeders.' },
    { task: 'P1-T4', user: 'VS-0009', percent: 65, hours: 7, days: -2, note: 'Cable schedule drafted; waiting on client cable tray layout.', blocker: 'Client has not shared the cable tray routing drawing. BOM cannot be frozen without it.' },
    { task: 'P1-T5', user: 'VS-0011', percent: 40, hours: 12, days: -3, note: 'Enclosure frames modelled, door cut-outs pending.' },
    { task: 'P2-T2', user: 'VS-0012', percent: 45, hours: 9, days: -2, note: 'Foundation details done for 4 of 6 pillars.' },
    { task: 'P3-T1', user: 'VS-0013', percent: 55, hours: 8, days: -1, note: 'IO list reviewed with client instrumentation team; 40 points added.' },
    { task: 'P1-ADHOC1', user: 'VS-0008', percent: 30, hours: 2, days: 0, note: 'Started rework on feeder 7 after client mark-ups.' },
  ];

  for (const seed of progressSeeds) {
    const tid = taskId.get(seed.task);
    if (!tid) continue;
    const already = await prisma.taskProgressLog.findFirst({ where: { taskId: tid, note: seed.note } });
    if (already) continue;
    await prisma.taskProgressLog.create({
      data: {
        taskId: tid,
        userId: userId.get(seed.user)!,
        percentComplete: seed.percent,
        hoursSpent: seed.hours,
        note: seed.note,
        blocker: seed.blocker ?? null,
        loggedFor: day(seed.days),
      },
    });
    await prisma.task.update({ where: { id: tid }, data: { actualHours: { increment: seed.hours } } });
  }

  // ------------------------------------------------------------------ handovers
  const handoverTask = taskId.get('P1-T5');
  if (handoverTask) {
    const already = await prisma.taskHandover.findFirst({ where: { taskId: handoverTask } });
    if (!already) {
      await prisma.taskHandover.create({
        data: {
          taskId: handoverTask,
          fromUserId: userId.get('VS-0011')!,
          toUserId: userId.get('VS-0012')!,
          reason: 'Called to the Sunrise Cement site for a dimensional survey for three days. Door cut-outs and mounting plate details are still open.',
          remainingPercent: 60,
          remainingHours: 21.6,
        },
      });
    }
  }

  // --------------------------------------------------------------------- leaves
  const leaveSeeds = [
    { user: 'VS-0007', from: 3, to: 6, reason: 'Planned leave - family function' },
    { user: 'VS-0014', from: 1, to: 2, reason: 'Certification exam' },
  ];
  for (const seed of leaveSeeds) {
    const uid = userId.get(seed.user)!;
    const already = await prisma.leave.findFirst({ where: { userId: uid, startDate: day(seed.from) } });
    if (already) continue;
    await prisma.leave.create({
      data: { userId: uid, startDate: day(seed.from), endDate: day(seed.to), reason: seed.reason, status: 'APPROVED' },
    });
  }

  console.log(`Seeded ${people.length} people, ${projectSeeds.length} projects, ${taskSeeds.length} tasks.`);
  console.log(`Sign in with admin@vidyutswitchgear.com / <SEED_PASSWORD>`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
