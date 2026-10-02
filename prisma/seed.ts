/**
 * Seed data for ACS Engitech Pvt Ltd.
 *
 * Full organizational chart with 95 employees across all departments:
 * Directors, HR, Admin, Purchase, Sales, Trading, IT, Accounts, Stores,
 * Design, Production (Logistics, Assembly, Wiring), QC, Technical (PMO, Service, Engineers),
 * with 3 live switchgear projects, WBS, dependencies, progress, handovers, and leaves.
 */
import { PrismaClient, type Grade, type ScopeType } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { ALL_PERMISSIONS, PERMISSIONS, SYSTEM_ROLES } from '../src/core/rbac/permissions';
import { MODULES } from '../src/core/modules/registry';

const prisma = new PrismaClient();

const PASSWORD: string = process.env.SEED_PASSWORD || 'ACSengi@2026';

const COLOURS = ['#2f5fd8', '#0f9d58', '#d93025', '#f4b400', '#7b1fa2', '#00838f', '#ef6c00', '#5d4037'];
const colourFor = (seed: string) => {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) % 997;
  return COLOURS[hash % COLOURS.length]!;
};

async function main() {
  console.log('Seeding Engineering OS with full organization chart...');

  // ---------------------------------------------------------------- permissions
  for (const key of ALL_PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key },
      create: { key, module: key.split('.')[0]!, description: PERMISSIONS[key] },
      update: { description: PERMISSIONS[key] },
    });
  }
  const permissions = await prisma.permission.findMany();
  const permissionId = new Map(permissions.map((p) => [p.key, p.id]));

  // ---------------------------------------------------------------------- roles
  // Create-only: this script runs on every container start, so it must never undo what
  // admins changed in the app. A role's permissions are seeded only when the role is new;
  // granting an existing role a new permission needs an explicit one-off script.
  for (const [key, definition] of Object.entries(SYSTEM_ROLES)) {
    if (await prisma.role.findUnique({ where: { key }, select: { id: true } })) continue;
    const role = await prisma.role.create({
      data: { key, name: definition.name, description: definition.description, isSystem: true },
    });
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
      update: {},
    });
  }

  // -------------------------------------------------------- checklist templates
  const PLC_TASKS = [
    { step: 1, code: 'PLC_STEP_01', title: 'Review Control Philosophy / Functional Requirements', seniority: 'SENIOR', days: 1, depends: null },
    { step: 2, code: 'PLC_STEP_02', title: 'Verify I/O List and Tag List as per Approved Documents', seniority: 'JUNIOR', days: 1, depends: 1 },
    { step: 3, code: 'PLC_STEP_03', title: 'Verify PLC Hardware Configuration as per Electrical Dwg', seniority: 'JUNIOR', days: 1, depends: 2 },
    { step: 4, code: 'PLC_STEP_04', title: 'Verify PLC CPU, Comm Modules & Network Configuration', seniority: 'SENIOR', days: 1, depends: 3 },
    { step: 5, code: 'PLC_STEP_05', title: 'DI Mapping', seniority: 'JUNIOR', days: 1, depends: 4 },
    { step: 6, code: 'PLC_STEP_06', title: 'DQ Mapping', seniority: 'JUNIOR', days: 1, depends: 5 },
    { step: 7, code: 'PLC_STEP_07', title: 'Analog Input Scaling, Engineering Units & Range Settings', seniority: 'JUNIOR', days: 1, depends: 6 },
    { step: 8, code: 'PLC_STEP_08', title: 'Analog Output / PID Control Logic', seniority: 'SENIOR', days: 1, depends: 7 },
    { step: 9, code: 'PLC_STEP_09', title: 'Motor Control Logic, Faceplate, Alarms & Animation', seniority: 'SENIOR', days: 1, depends: null },
    { step: 10, code: 'PLC_STEP_10', title: 'Valve Control Logic, Faceplate, Alarms & Animation', seniority: 'SENIOR', days: 1, depends: 9 },
    { step: 11, code: 'PLC_STEP_11', title: 'Auto Sequence Complete', seniority: 'SENIOR', days: 1, depends: 10 },
    { step: 12, code: 'PLC_STEP_12', title: 'Simulation Trial of Manual Function', seniority: 'JUNIOR', days: 1, depends: null },
    { step: 13, code: 'PLC_STEP_13', title: 'Simulation with Auto sequence trial and SCADA/HMI', seniority: 'SENIOR', days: 1, depends: 12, isSim: true },
  ];

  const SCADA_TASKS = [
    { step: 1, code: 'SCADA_STEP_01', title: 'Review P&ID and requirement', seniority: 'SENIOR', days: 1, depends: null },
    { step: 2, code: 'SCADA_STEP_02', title: 'Diagnostic Screen of DI', seniority: 'JUNIOR', days: 1, depends: 1 },
    { step: 3, code: 'SCADA_STEP_03', title: 'Diagnostic Screen of DQ', seniority: 'JUNIOR', days: 1, depends: 2 },
    { step: 4, code: 'SCADA_STEP_04', title: 'Diagnostic Screen of AI', seniority: 'JUNIOR', days: 1, depends: 3 },
    { step: 5, code: 'SCADA_STEP_05', title: 'Diagnostic Screen of AQ', seniority: 'JUNIOR', days: 1, depends: 4 },
    { step: 6, code: 'SCADA_STEP_06', title: 'Scaling Screen of Analog parameter', seniority: 'JUNIOR', days: 1, depends: 5 },
    { step: 7, code: 'SCADA_STEP_07', title: 'Faceplate Development', seniority: 'SENIOR', days: 1, depends: 6 },
    { step: 8, code: 'SCADA_STEP_08', title: 'Alarm + History development', seniority: 'SENIOR', days: 1, depends: 7 },
    { step: 9, code: 'SCADA_STEP_09', title: 'Trend development', seniority: 'JUNIOR', days: 1, depends: 8 },
    { step: 10, code: 'SCADA_STEP_10', title: 'P&ID Developed without tag', seniority: 'JUNIOR', days: 1, depends: 9 },
    { step: 11, code: 'SCADA_STEP_11', title: 'P&ID developed with Tag Complete', seniority: 'SENIOR', days: 1, depends: 10 },
    { step: 12, code: 'SCADA_STEP_12', title: 'Communication Architect', seniority: 'SENIOR', days: 1, depends: 11 },
    { step: 13, code: 'SCADA_STEP_13', title: 'Simulation Trial', seniority: 'SENIOR', days: 1, depends: 12, isSim: true },
  ];

  const HMI_TASKS = [
    { step: 1, code: 'HMI_STEP_01', title: 'Review P&ID and HMI screen requirements', seniority: 'SENIOR', days: 1, depends: null },
    { step: 2, code: 'HMI_STEP_02', title: 'Diagnostic Screen of DI', seniority: 'JUNIOR', days: 1, depends: 1 },
    { step: 3, code: 'HMI_STEP_03', title: 'Diagnostic Screen of DQ', seniority: 'JUNIOR', days: 1, depends: 2 },
    { step: 4, code: 'HMI_STEP_04', title: 'Diagnostic Screen of AI', seniority: 'JUNIOR', days: 1, depends: 3 },
    { step: 5, code: 'HMI_STEP_05', title: 'Diagnostic Screen of AQ', seniority: 'JUNIOR', days: 1, depends: 4 },
    { step: 6, code: 'HMI_STEP_06', title: 'Scaling Screen of Analog parameter', seniority: 'JUNIOR', days: 1, depends: 5 },
    { step: 7, code: 'HMI_STEP_07', title: 'Faceplate Development', seniority: 'SENIOR', days: 1, depends: 6 },
    { step: 8, code: 'HMI_STEP_08', title: 'Alarm + History development', seniority: 'SENIOR', days: 1, depends: 7 },
    { step: 9, code: 'HMI_STEP_09', title: 'Trend development', seniority: 'JUNIOR', days: 1, depends: 8 },
    { step: 10, code: 'HMI_STEP_10', title: 'Screen Navigation & Layouts', seniority: 'JUNIOR', days: 1, depends: 9 },
    { step: 11, code: 'HMI_STEP_11', title: 'HMI Tag Linking with PLC DBs', seniority: 'SENIOR', days: 1, depends: 10 },
    { step: 12, code: 'HMI_STEP_12', title: 'Communication Configuration & Drivers', seniority: 'SENIOR', days: 1, depends: 11 },
    { step: 13, code: 'HMI_STEP_13', title: 'Simulation Trial', seniority: 'SENIOR', days: 1, depends: 12, isSim: true },
  ];

  const templates = [
    { code: 'PLC', name: 'PLC Programming + Simulation', description: 'Standard 13-step PLC programming, hardware verification, I/O mapping, and simulation pipeline.', items: PLC_TASKS },
    { code: 'SCADA', name: 'SCADA Programming + Simulation', description: 'Standard 13-step SCADA system development, P&ID mimics, faceplates, alarms, and simulation.', items: SCADA_TASKS },
    { code: 'HMI', name: 'HMI Programming + Simulation', description: 'Standard 13-step HMI operator panel development, diagnostic screens, tag linking, and simulation.', items: HMI_TASKS },
  ];

  // Create-only: a template that already exists belongs to the Checklists screen now.
  for (const t of templates) {
    if (await prisma.checklistTemplate.findUnique({ where: { code: t.code }, select: { id: true } })) continue;
    const template = await prisma.checklistTemplate.create({
      data: { code: t.code, name: t.name, description: t.description, category: 'AUTOMATION', isActive: true },
    });

    await prisma.checklistTemplateItem.createMany({
      data: t.items.map((item) => ({
        templateId: template.id,
        stepNumber: item.step,
        code: item.code,
        title: item.title,
        recommendedSeniority: item.seniority,
        defaultDurationHours: item.days * 8,
        dependsOnStep: item.depends,
        isSimulationSignoff: Boolean(item.isSim),
        sortOrder: item.step,
      })),
    });
  }

  // One-time move from whole-day durations to hours. Rows with a legacy multi-day value get
  // days x 8 hours and are reset to 1 day, so this never touches them again (idempotent).
  await prisma.$executeRaw`
    UPDATE pm_checklist_template_items
    SET "defaultDurationHours" = "defaultDurationDays" * 8, "defaultDurationDays" = 1
    WHERE "defaultDurationDays" <> 1`;

  // -------------------------------------------------------------------- company
  const company = await prisma.company.upsert({
    where: { code: 'ACS' },
    create: {
      code: 'ACS',
      name: 'ACS Engitech Pvt Ltd',
      gstin: '27AABCV1234M1Z5',
      address: 'Plot 42, GIDC Industrial Estate, Gujarat',
    },
    update: {},
  });

  const departmentTree: Array<{ code: string; name: string; parent?: string }> = [
    { code: 'DIR', name: 'Board of Directors' },
    { code: 'HR', name: 'Human Resources' },
    { code: 'ADMIN', name: 'General Administration & Front Desk' },
    { code: 'PUR', name: 'Purchase & Procurement' },
    { code: 'SALES', name: 'Sales & Estimation' },
    { code: 'TRADING', name: 'Trading Sales', parent: 'SALES' },
    { code: 'IT', name: 'Information Technology' },
    { code: 'ACC', name: 'Accounts & Finance' },
    { code: 'STORES', name: 'Stores & Inventory' },
    { code: 'DESIGN', name: 'Design & Engineering' },
    { code: 'PROD', name: 'Production & Manufacturing' },
    { code: 'PROD_LOG', name: 'Logistics', parent: 'PROD' },
    { code: 'PROD_ASSY', name: 'Assembly', parent: 'PROD' },
    { code: 'PROD_WIRE', name: 'Wiring & Cable Harness', parent: 'PROD' },
    { code: 'QC', name: 'Quality Control & Testing' },
    { code: 'TECH', name: 'Technical & Project Management' },
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
      update: {},
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
    // Super Admin & Director
    {
      code: 'ACS-0001',
      name: 'Satish Nagar',
      email: 'admin@acsengitech.com',
      designation: 'Director',
      grade: 'DIRECTOR',
      dept: 'DIR',
      skills: ['corporate strategy', 'operations', 'executive governance'],
      roles: [
        { key: 'SUPER_ADMIN', scopeType: 'GLOBAL' },
        { key: 'DIRECTOR', scopeType: 'GLOBAL' },
      ],
    },

    // Directors
    {
      code: 'ACS-0002',
      name: 'Satish Nagar',
      email: 'satishkumar.nagar@acsengitech.com',
      designation: 'Director',
      grade: 'DIRECTOR',
      dept: 'DIR',
      skills: ['corporate strategy', 'operations', 'executive sponsorship'],
      roles: [{ key: 'DIRECTOR', scopeType: 'GLOBAL' }],
    },
    {
      code: 'ACS-0003',
      name: 'Bhavesh Ishwarbhai Prajapati',
      email: 'bhavesh.prajapati@acsengitech.com',
      designation: 'Director',
      grade: 'DIRECTOR',
      dept: 'DIR',
      skills: ['commercial governance', 'finance', 'project sponsorship'],
      roles: [{ key: 'DIRECTOR', scopeType: 'GLOBAL' }],
    },
    {
      code: 'ACS-0004',
      name: 'Shaktikumar Vasava',
      email: 'shaktikumar.vasava@acsengitech.com',
      designation: 'Director',
      grade: 'DIRECTOR',
      dept: 'DIR',
      skills: ['factory operations', 'plant management'],
      roles: [{ key: 'DIRECTOR', scopeType: 'GLOBAL' }],
    },

    // HR
    {
      code: 'ACS-0005',
      name: 'Truptee Manubhai Chavda',
      email: 'truptee.chavda@acsengitech.com',
      designation: 'Hr.Executive',
      grade: 'ENGINEER',
      dept: 'HR',
      manager: 'ACS-0002',
      skills: ['talent management', 'recruitment', 'leave management'],
      roles: [{ key: 'DEPARTMENT_HEAD', scopeType: 'DEPARTMENT', scope: 'HR' }],
    },

    // Receptionist
    {
      code: 'ACS-0006',
      name: 'Pooja Ashokbhai Bhut',
      email: 'pooja.bhut@acsengitech.com',
      designation: 'Receptionist',
      grade: 'JUNIOR_ENGINEER',
      dept: 'ADMIN',
      manager: 'ACS-0005',
      skills: ['front desk', 'guest coordination'],
      roles: [],
    },

    // Purchase
    {
      code: 'ACS-0007',
      name: 'Bhavik Revabhai Patel',
      email: 'bhavik.patel@acsengitech.com',
      designation: 'Sr. Purchase Executive',
      grade: 'SENIOR_ENGINEER',
      dept: 'PUR',
      manager: 'ACS-0002',
      skills: ['switchgear procurement', 'vendor negotiations', 'BOM costing'],
      roles: [{ key: 'DEPARTMENT_HEAD', scopeType: 'DEPARTMENT', scope: 'PUR' }],
    },
    {
      code: 'ACS-0008',
      name: 'Hardik Arvindbhai Kanani',
      email: 'hardik.kanani@acsengitech.com',
      designation: 'Purchase Engineer',
      grade: 'ENGINEER',
      dept: 'PUR',
      manager: 'ACS-0007',
      skills: ['raw material purchase', 'copper busbar sourcing'],
      roles: [],
    },
    {
      code: 'ACS-0009',
      name: 'Dhaval Narendrabhai Patel',
      email: 'dhaval.patel@acsengitech.com',
      designation: 'Purchase Engineer',
      grade: 'ENGINEER',
      dept: 'PUR',
      manager: 'ACS-0007',
      skills: ['switchgear components', 'relays sourcing'],
      roles: [],
    },

    // Sales
    {
      code: 'ACS-0010',
      name: 'Dharmesh Bhartbhai Thummar',
      email: 'dharmesh.thummar@acsengitech.com',
      designation: 'Sales Head',
      grade: 'HEAD',
      dept: 'SALES',
      manager: 'ACS-0002',
      skills: ['sales strategy', 'client negotiations', 'key accounts'],
      roles: [{ key: 'SALES_HEAD', scopeType: 'GLOBAL' }],
    },
    {
      code: 'ACS-0011',
      name: 'Vasant Bhulabhai Patel',
      email: 'vasant.patel@acsengitech.com',
      designation: 'Project Sales Manager',
      grade: 'MANAGER',
      dept: 'SALES',
      manager: 'ACS-0010',
      skills: ['industrial projects', 'client coordination'],
      roles: [],
    },
    {
      code: 'ACS-0012',
      name: 'Hariohm Kiranbhai vyas',
      email: 'hariohm.vyas@acsengitech.com',
      designation: 'Sales Engineer',
      grade: 'ENGINEER',
      dept: 'SALES',
      manager: 'ACS-0010',
      skills: ['tendering', 'technical proposal'],
      roles: [],
    },
    {
      code: 'ACS-0013',
      name: 'Aakash Kirankumar Panchal',
      email: 'aakash.panchal@acsengitech.com',
      designation: 'Sr. Estimation Engineer',
      grade: 'SENIOR_ENGINEER',
      dept: 'SALES',
      manager: 'ACS-0010',
      skills: ['panel estimation', 'BOM calculation', 'costing'],
      roles: [],
    },
    {
      code: 'ACS-0014',
      name: 'Bhavesh Rashikbhai Koli',
      email: 'bhavesh.koli@acsengitech.com',
      designation: 'Estimation Engineer',
      grade: 'ENGINEER',
      dept: 'SALES',
      manager: 'ACS-0013',
      skills: ['cost estimation', 'feeder calculations'],
      roles: [],
    },
    {
      code: 'ACS-0015',
      name: 'Manas Milind Tonapi',
      email: 'manas.tonapi@acsengitech.com',
      designation: 'Resident Sr.Sales Engineer',
      grade: 'SENIOR_ENGINEER',
      dept: 'SALES',
      manager: 'ACS-0010',
      skills: ['site business development', 'OEM sales'],
      roles: [],
    },
    {
      code: 'ACS-0016',
      name: 'Ankit Ravjibhai Parmar',
      email: 'ankit.parmar@acsengitech.com',
      designation: 'Estimation Engineer',
      grade: 'ENGINEER',
      dept: 'SALES',
      manager: 'ACS-0013',
      skills: ['panel costing', 'estimation'],
      roles: [],
    },

    // Trading Sales
    {
      code: 'ACS-0017',
      name: 'Hitesh Aandabhai Suthar',
      email: 'hitesh.suthar@acsengitech.com',
      designation: 'Sr. Purchase Executive',
      grade: 'SENIOR_ENGINEER',
      dept: 'TRADING',
      manager: 'ACS-0010',
      skills: ['trading procurement', 'trading sales'],
      roles: [{ key: 'DEPARTMENT_HEAD', scopeType: 'DEPARTMENT', scope: 'TRADING' }],
    },
    {
      code: 'ACS-0018',
      name: 'Rakshita Jitendrakumar Parmar',
      email: 'rakshita.parmar@acsengitech.com',
      designation: 'Trading Sales Executive',
      grade: 'ENGINEER',
      dept: 'TRADING',
      manager: 'ACS-0017',
      skills: ['switchgear components trading', 'client orders'],
      roles: [],
    },
    {
      code: 'ACS-0019',
      name: 'Sonali Sureshbhai Dodiya',
      email: 'sonali.dodiya@acsengitech.com',
      designation: 'Trading Sales Executive',
      grade: 'ENGINEER',
      dept: 'TRADING',
      manager: 'ACS-0017',
      skills: ['quotations', 'dispatch follow up'],
      roles: [],
    },

    // IT
    {
      code: 'ACS-0020',
      name: 'Kirtan Rajeshkumar Nagar',
      email: 'kirtan.nagar@acsengitech.com',
      designation: 'Network & Hardware Engineer',
      grade: 'ENGINEER',
      dept: 'IT',
      manager: 'ACS-0002',
      skills: ['system administration', 'networking', 'hardware'],
      roles: [{ key: 'DEPARTMENT_HEAD', scopeType: 'DEPARTMENT', scope: 'IT' }],
    },

    // Account
    {
      code: 'ACS-0021',
      name: 'Kishan Dayabhai Prajapati',
      email: 'kishan.prajapati@acsengitech.com',
      designation: 'Sr. Accountant',
      grade: 'HEAD',
      dept: 'ACC',
      manager: 'ACS-0003',
      skills: ['financial accounting', 'GST', 'billing', 'audit'],
      roles: [{ key: 'DEPARTMENT_HEAD', scopeType: 'DEPARTMENT', scope: 'ACC' }],
    },
    {
      code: 'ACS-0022',
      name: 'Ajay Prakashbhai Pandya',
      email: 'ajay.pandya@acsengitech.com',
      designation: 'Jr. Accountant',
      grade: 'JUNIOR_ENGINEER',
      dept: 'ACC',
      manager: 'ACS-0021',
      skills: ['vouchers', 'ledger entry', 'invoicing'],
      roles: [],
    },
    {
      code: 'ACS-0023',
      name: 'Parth Prakashbhai Sai Darji',
      email: 'parth.darji@acsengitech.com',
      designation: 'Jr. Accountant',
      grade: 'JUNIOR_ENGINEER',
      dept: 'ACC',
      manager: 'ACS-0021',
      skills: ['payroll reconciliation', 'banking'],
      roles: [],
    },

    // Stores
    {
      code: 'ACS-0024',
      name: 'Chirag Ishwarbhai Valand',
      email: 'chirag.valand@acsengitech.com',
      designation: 'Store in Charge',
      grade: 'MANAGER',
      dept: 'STORES',
      manager: 'ACS-0004',
      skills: ['inventory control', 'GRN', 'material issue'],
      roles: [{ key: 'DEPARTMENT_HEAD', scopeType: 'DEPARTMENT', scope: 'STORES' }],
    },
    {
      code: 'ACS-0025',
      name: 'Kavin Sureshbhai Patel',
      email: 'kavin.patel@acsengitech.com',
      designation: 'Store in Charge',
      grade: 'MANAGER',
      dept: 'STORES',
      manager: 'ACS-0024',
      skills: ['stock verification', 'dispatch stores'],
      roles: [],
    },
    {
      code: 'ACS-0026',
      name: 'Urvish Kamleshbhai Patel',
      email: 'urvish.patel@acsengitech.com',
      designation: 'Store Officer',
      grade: 'ENGINEER',
      dept: 'STORES',
      manager: 'ACS-0024',
      skills: ['stock inward', 'bin tracking'],
      roles: [],
    },
    {
      code: 'ACS-0027',
      name: 'Bharat Dabhi',
      email: 'bharat.dabhi@acsengitech.com',
      designation: 'Store Officer',
      grade: 'ENGINEER',
      dept: 'STORES',
      manager: 'ACS-0024',
      skills: ['raw materials', 'hardware stores'],
      roles: [],
    },

    // Design
    {
      code: 'ACS-0028',
      name: 'Jay Vijaykumar Patel',
      email: 'jay.patel@acsengitech.com',
      designation: 'Sr. Design Engineer',
      grade: 'SENIOR_ENGINEER',
      dept: 'DESIGN',
      manager: 'ACS-0061',
      skills: ['GA drawing', 'EPLAN', 'AutoCAD', 'LV switchgear', 'busbar calculation'],
      roles: [{ key: 'DEPARTMENT_HEAD', scopeType: 'DEPARTMENT', scope: 'DESIGN' }],
    },
    {
      code: 'ACS-0029',
      name: 'Surajkumar Jaysukhbhai Chaniyara',
      email: 'surajkumar.chaniyara@acsengitech.com',
      designation: 'Sr. Design Engineer',
      grade: 'SENIOR_ENGINEER',
      dept: 'DESIGN',
      manager: 'ACS-0028',
      skills: ['schematics', 'EPLAN', 'MCC design', 'PCC design'],
      roles: [],
    },
    {
      code: 'ACS-0030',
      name: 'Aniq Istiyak Farooqui',
      email: 'aniq.farooqui@acsengitech.com',
      designation: 'Design Engineer',
      grade: 'ENGINEER',
      dept: 'DESIGN',
      manager: 'ACS-0028',
      skills: ['AutoCAD electrical', 'busbar routing', 'panel layouts'],
      roles: [],
    },
    {
      code: 'ACS-0031',
      name: 'Jagdish Prakashbhai Prajapati',
      email: 'jagdish.prajapati@acsengitech.com',
      designation: 'Design Engineer',
      grade: 'ENGINEER',
      dept: 'DESIGN',
      manager: 'ACS-0028',
      skills: ['BOM generation', 'control wiring design'],
      roles: [],
    },
    {
      code: 'ACS-0032',
      name: 'Darshan Upendrabhai Prajapati',
      email: 'darshan.prajapati@acsengitech.com',
      designation: 'Design Engineer',
      grade: 'ENGINEER',
      dept: 'DESIGN',
      manager: 'ACS-0028',
      skills: ['enclosure fabrication drawings', 'SolidWorks', 'sheet metal'],
      roles: [],
    },
    {
      code: 'ACS-0033',
      name: 'Mayurkumar Vishnubhai Patel',
      email: 'mayurkumar.patel@acsengitech.com',
      designation: 'Design Engineer',
      grade: 'ENGINEER',
      dept: 'DESIGN',
      manager: 'ACS-0028',
      skills: ['APFC panel design', 'feeder pillars'],
      roles: [],
    },
    {
      code: 'ACS-0034',
      name: 'Hardik Jayntibhai Jethva',
      email: 'hardik.jethva@acsengitech.com',
      designation: 'Design Engineer',
      grade: 'ENGINEER',
      dept: 'DESIGN',
      manager: 'ACS-0028',
      skills: ['terminal block diagrams', 'cable schedules'],
      roles: [],
    },

    // Production - Supervisor
    {
      code: 'ACS-0035',
      name: 'Jignesh Ganpatbhai Prajapati',
      email: 'jignesh.prajapati@acsengitech.com',
      designation: 'Sr.Production Supervisor',
      grade: 'MANAGER',
      dept: 'PROD',
      manager: 'ACS-0004',
      skills: ['shop floor management', 'panel assembly', 'busbar fabrication', 'wiring supervision'],
      roles: [{ key: 'DEPARTMENT_HEAD', scopeType: 'DEPARTMENT', scope: 'PROD' }],
    },

    // Production - Logistics
    {
      code: 'ACS-0036',
      name: 'Vicky Amrutbhai Chauhan',
      email: 'vicky.chauhan@acsengitech.com',
      designation: 'Logistics',
      grade: 'ENGINEER',
      dept: 'PROD_LOG',
      manager: 'ACS-0035',
      skills: ['material movement', 'panel packing', 'dispatch'],
      roles: [],
    },
    {
      code: 'ACS-0037',
      name: 'Anil Vishnubhai Prajapati',
      email: 'anil.v.prajapati@acsengitech.com',
      designation: 'Logistics',
      grade: 'ENGINEER',
      dept: 'PROD_LOG',
      manager: 'ACS-0035',
      skills: ['transportation', 'loading'],
      roles: [],
    },
    {
      code: 'ACS-0038',
      name: 'Darshan Bhadreshbhai Patel',
      email: 'darshan.b.patel@acsengitech.com',
      designation: 'Logistics',
      grade: 'ENGINEER',
      dept: 'PROD_LOG',
      manager: 'ACS-0035',
      skills: ['forklift', 'crate packing'],
      roles: [],
    },
    {
      code: 'ACS-0039',
      name: 'Kishankumar Kalaji Parmar',
      email: 'kishankumar.parmar@acsengitech.com',
      designation: 'Logistics',
      grade: 'ENGINEER',
      dept: 'PROD_LOG',
      manager: 'ACS-0035',
      skills: ['dispatch documentation', 'handling'],
      roles: [],
    },
    {
      code: 'ACS-0040',
      name: 'Rashik Thakor',
      email: 'rashik.thakor@acsengitech.com',
      designation: 'Logistics',
      grade: 'ENGINEER',
      dept: 'PROD_LOG',
      manager: 'ACS-0035',
      skills: ['dispatch', 'packing'],
      roles: [],
    },

    // Production - Assembly
    {
      code: 'ACS-0041',
      name: 'Vijay Jantibhai Patel',
      email: 'vijay.patel@acsengitech.com',
      designation: 'Assembly',
      grade: 'ENGINEER',
      dept: 'PROD_ASSY',
      manager: 'ACS-0035',
      skills: ['enclosure assembly', 'switchgear mounting', 'busbar fitting'],
      roles: [],
    },
    {
      code: 'ACS-0042',
      name: 'Chetan Sumanbhai Patel',
      email: 'chetan.patel@acsengitech.com',
      designation: 'Assembly',
      grade: 'ENGINEER',
      dept: 'PROD_ASSY',
      manager: 'ACS-0035',
      skills: ['breaker mounting', 'door interlocks', 'busbar assembly'],
      roles: [],
    },
    {
      code: 'ACS-0043',
      name: 'Raju Vajesinh Dabhi',
      email: 'raju.dabhi@acsengitech.com',
      designation: 'Assembly',
      grade: 'ENGINEER',
      dept: 'PROD_ASSY',
      manager: 'ACS-0035',
      skills: ['mechanical assembly', 'hardware'],
      roles: [],
    },

    // Production - Wire Men
    {
      code: 'ACS-0044',
      name: 'Jigarbhai Sureshbhai Prajapati',
      email: 'jigar.prajapati@acsengitech.com',
      designation: 'Sr.Wire Man',
      grade: 'SENIOR_ENGINEER',
      dept: 'PROD_WIRE',
      manager: 'ACS-0035',
      skills: ['power wiring', 'control wiring', 'ferrule numbering', 'MCC wiring'],
      roles: [],
    },
    {
      code: 'ACS-0045',
      name: 'Darshan Jayntibhai Patel',
      email: 'darshan.j.patel@acsengitech.com',
      designation: 'Sr.Wire Man',
      grade: 'SENIOR_ENGINEER',
      dept: 'PROD_WIRE',
      manager: 'ACS-0035',
      skills: ['relay wiring', 'PLC wiring', 'panel dressing'],
      roles: [],
    },
    {
      code: 'ACS-0046',
      name: 'Alkesh Rajeshbhai Patel',
      email: 'alkesh.patel@acsengitech.com',
      designation: 'Wire Man',
      grade: 'ENGINEER',
      dept: 'PROD_WIRE',
      manager: 'ACS-0044',
      skills: ['control wiring', 'crimping'],
      roles: [],
    },
    {
      code: 'ACS-0047',
      name: 'Aryan Pankajbhai Patel',
      email: 'aryan.patel@acsengitech.com',
      designation: 'Wire Man',
      grade: 'ENGINEER',
      dept: 'PROD_WIRE',
      manager: 'ACS-0044',
      skills: ['feeder wiring', 'bus wiring'],
      roles: [],
    },
    {
      code: 'ACS-0048',
      name: 'Hitkumar Rakeshbhai Patel',
      email: 'hitkumar.patel@acsengitech.com',
      designation: 'Wire Man',
      grade: 'ENGINEER',
      dept: 'PROD_WIRE',
      manager: 'ACS-0044',
      skills: ['wiring', 'bunching', 'dressing'],
      roles: [],
    },
    {
      code: 'ACS-0049',
      name: 'Pradip Govindbhai Sodha',
      email: 'pradip.sodha@acsengitech.com',
      designation: 'Wire Man',
      grade: 'ENGINEER',
      dept: 'PROD_WIRE',
      manager: 'ACS-0044',
      skills: ['wiring', 'crimping'],
      roles: [],
    },
    {
      code: 'ACS-0050',
      name: 'Arun Prabhatbhai Solanki',
      email: 'arun.solanki@acsengitech.com',
      designation: 'Wire Man',
      grade: 'ENGINEER',
      dept: 'PROD_WIRE',
      manager: 'ACS-0044',
      skills: ['wiring', 'ferruling'],
      roles: [],
    },
    {
      code: 'ACS-0051',
      name: 'Virendrasinh Amarsinh Solanki',
      email: 'virendrasinh.solanki@acsengitech.com',
      designation: 'Wire Man',
      grade: 'ENGINEER',
      dept: 'PROD_WIRE',
      manager: 'ACS-0044',
      skills: ['wiring', 'cable routing'],
      roles: [],
    },
    {
      code: 'ACS-0052',
      name: 'Dipakkumar Manealbhai Zala',
      email: 'dipak.zala@acsengitech.com',
      designation: 'Wire Man',
      grade: 'ENGINEER',
      dept: 'PROD_WIRE',
      manager: 'ACS-0044',
      skills: ['wiring', 'cable terminal connection'],
      roles: [],
    },
    {
      code: 'ACS-0053',
      name: 'Kishanbhai Ashokbhai Sodha',
      email: 'kishan.sodha@acsengitech.com',
      designation: 'Wire Man',
      grade: 'ENGINEER',
      dept: 'PROD_WIRE',
      manager: 'ACS-0044',
      skills: ['wiring', 'earthing'],
      roles: [],
    },
    {
      code: 'ACS-0054',
      name: 'Pratik Vishanubhai Dabhi',
      email: 'pratik.dabhi@acsengitech.com',
      designation: 'Wire Man',
      grade: 'ENGINEER',
      dept: 'PROD_WIRE',
      manager: 'ACS-0044',
      skills: ['wiring', 'terminal marking'],
      roles: [],
    },
    {
      code: 'ACS-0055',
      name: 'Mittal Bhupendrakumar Dabhi',
      email: 'mittal.dabhi@acsengitech.com',
      designation: 'Sticker Operator',
      grade: 'TRAINEE',
      dept: 'PROD_WIRE',
      manager: 'ACS-0044',
      skills: ['panel labeling', 'mimic stickers', 'ferrule printing'],
      roles: [],
    },
    {
      code: 'ACS-0056',
      name: 'Anilkumar Arjitsinh Dabhi',
      email: 'anil.a.dabhi@acsengitech.com',
      designation: 'Sticker Operator',
      grade: 'TRAINEE',
      dept: 'PROD_WIRE',
      manager: 'ACS-0044',
      skills: ['sticker printing', 'legend plates'],
      roles: [],
    },

    // QC
    {
      code: 'ACS-0057',
      name: 'Amey Pradipbhai Kulkarni',
      email: 'amey.kulkarni@acsengitech.com',
      designation: 'Testing & QC Manager',
      grade: 'HEAD',
      dept: 'QC',
      manager: 'ACS-0002',
      skills: ['routine testing', 'HV testing', 'megger test', 'protection relay calibration', 'IEC 61439'],
      roles: [{ key: 'DEPARTMENT_HEAD', scopeType: 'DEPARTMENT', scope: 'QC' }],
    },
    {
      code: 'ACS-0058',
      name: 'Bhanupratapsingh Vasantsingh Rajput',
      email: 'bhanupratapsingh.rajput@acsengitech.com',
      designation: 'Sr.Testing Engineer',
      grade: 'SENIOR_ENGINEER',
      dept: 'QC',
      manager: 'ACS-0057',
      skills: ['breaker testing', 'relay testing', 'control circuit testing'],
      roles: [],
    },
    {
      code: 'ACS-0059',
      name: 'Meet Bharatbhai Varma',
      email: 'meet.varma@acsengitech.com',
      designation: 'Sr.Testing Engineer',
      grade: 'SENIOR_ENGINEER',
      dept: 'QC',
      manager: 'ACS-0057',
      skills: ['FAT coordination', 'CT/PT polarity', 'insulation test'],
      roles: [],
    },
    {
      code: 'ACS-0060',
      name: 'Rishit Jayeshbhai Joshi',
      email: 'rishit.joshi@acsengitech.com',
      designation: 'Junior Engineer',
      grade: 'JUNIOR_ENGINEER',
      dept: 'QC',
      manager: 'ACS-0058',
      skills: ['routine testing reports', 'continuity test'],
      roles: [],
    },

    // Technical
    {
      code: 'ACS-0061',
      name: 'Dilipkumar Rameshbhai Asediya',
      email: 'dilipkumar.asediya@acsengitech.com',
      designation: 'Head of Technical',
      grade: 'HEAD',
      dept: 'TECH',
      manager: 'ACS-0004',
      skills: ['technical leadership', 'project governance', 'engineering standards', 'WBS scheduling'],
      roles: [
        { key: 'TECHNICAL_HEAD', scopeType: 'DEPARTMENT', scope: 'TECH' },
        { key: 'TECHNICAL_HEAD', scopeType: 'DEPARTMENT', scope: 'DESIGN' },
      ],
    },
    {
      code: 'ACS-0062',
      name: 'Rajani Bhurabhai Nagar',
      email: 'rajani.nagar@acsengitech.com',
      designation: 'Head of Service',
      grade: 'HEAD',
      dept: 'TECH',
      manager: 'ACS-0004',
      skills: ['site commissioning', 'client service', 'AMC support'],
      roles: [{ key: 'SERVICE_HEAD', scopeType: 'DEPARTMENT', scope: 'TECH' }],
    },
    {
      code: 'ACS-0063',
      name: 'Parth Dasharathbhai Nagar',
      email: 'parth.nagar@acsengitech.com',
      designation: 'Project Manager',
      grade: 'MANAGER',
      dept: 'TECH',
      manager: 'ACS-0061',
      skills: ['project management', 'scheduling', 'MCC panels', 'client delivery', 'critical path'],
      roles: [{ key: 'PROJECT_MANAGER', scopeType: 'GLOBAL' }, { key: 'PM_BASE', scopeType: 'GLOBAL' }],
    },
    {
      code: 'ACS-0064',
      name: 'Shivam Bipinchandra Prajapati',
      email: 'shivam.prajapati@acsengitech.com',
      designation: 'Sr. Engineer',
      grade: 'SENIOR_ENGINEER',
      dept: 'TECH',
      manager: 'ACS-0063',
      skills: ['PLC automation', 'SCADA', 'control panels'],
      roles: [{ key: 'SENIOR_ENGINEER', scopeType: 'GLOBAL' }],
    },
    {
      code: 'ACS-0065',
      name: 'Sahil Dipakbhai Patil',
      email: 'sahil.patil@acsengitech.com',
      designation: 'Jr. Engineer',
      grade: 'JUNIOR_ENGINEER',
      dept: 'TECH',
      manager: 'ACS-0063',
      skills: ['automation testing', 'logic programming'],
      roles: [{ key: 'JUNIOR_ENGINEER', scopeType: 'GLOBAL' }],
    },
    {
      code: 'ACS-0066',
      name: 'Abbasali Mahamadali Sunasara',
      email: 'abbasali.sunasara@acsengitech.com',
      designation: 'Jr. Engineer',
      grade: 'JUNIOR_ENGINEER',
      dept: 'TECH',
      manager: 'ACS-0063',
      skills: ['field wiring', 'commissioning'],
      roles: [{ key: 'JUNIOR_ENGINEER', scopeType: 'GLOBAL' }],
    },
    {
      code: 'ACS-0067',
      name: 'Het Harshadbhai Patel',
      email: 'het.patel@acsengitech.com',
      designation: 'Jr. Engineer',
      grade: 'JUNIOR_ENGINEER',
      dept: 'TECH',
      manager: 'ACS-0075',
      skills: ['PLC troubleshooting', 'drives commissioning'],
      roles: [{ key: 'JUNIOR_ENGINEER', scopeType: 'GLOBAL' }],
    },
    {
      code: 'ACS-0068',
      name: 'Agastya Dilipbhai Patel',
      email: 'agastya.patel@acsengitech.com',
      designation: 'Sr. Engineer',
      grade: 'SENIOR_ENGINEER',
      dept: 'TECH',
      manager: 'ACS-0075',
      skills: ['protection schemes', 'switchboard engineering'],
      roles: [{ key: 'SENIOR_ENGINEER', scopeType: 'GLOBAL' }],
    },
    {
      code: 'ACS-0069',
      name: 'Dixit Prajapati',
      email: 'dixit.prajapati@acsengitech.com',
      designation: 'Sr. Engineer',
      grade: 'SENIOR_ENGINEER',
      dept: 'TECH',
      manager: 'ACS-0075',
      skills: ['synchronizing panels', 'DG automation'],
      roles: [{ key: 'SENIOR_ENGINEER', scopeType: 'GLOBAL' }],
    },
    {
      code: 'ACS-0070',
      name: 'Dhrupin Vithalbhai Vaghasiya',
      email: 'dhrupin.vaghasiya@acsengitech.com',
      designation: 'Asst. Manager',
      grade: 'SENIOR_ENGINEER',
      dept: 'TECH',
      manager: 'ACS-0061',
      skills: ['project coordination', 'vendor follow up', 'scheduling'],
      roles: [{ key: 'ASST_MANAGER', scopeType: 'GLOBAL' }],
    },
    {
      code: 'ACS-0071',
      name: 'Yogi Bharatbhai Patel',
      email: 'yogi.patel@acsengitech.com',
      designation: 'Sr. Engineer',
      grade: 'SENIOR_ENGINEER',
      dept: 'TECH',
      manager: 'ACS-0070',
      skills: ['site coordination', 'client FAT'],
      roles: [{ key: 'SENIOR_ENGINEER', scopeType: 'GLOBAL' }],
    },
    {
      code: 'ACS-0072',
      name: 'Anurag Sohandas Vaishnav',
      email: 'anurag.vaishnav@acsengitech.com',
      designation: 'Jr. Engineer',
      grade: 'JUNIOR_ENGINEER',
      dept: 'TECH',
      manager: 'ACS-0074',
      skills: ['testing assist', 'drawing review'],
      roles: [{ key: 'JUNIOR_ENGINEER', scopeType: 'GLOBAL' }],
    },
    {
      code: 'ACS-0073',
      name: 'Jigar Girishbhai Nayak',
      email: 'jigar.nayak@acsengitech.com',
      designation: 'Trainee Engineer',
      grade: 'TRAINEE',
      dept: 'TECH',
      manager: 'ACS-0070',
      skills: ['panel documentation', 'trainee'],
      roles: [{ key: 'JUNIOR_ENGINEER', scopeType: 'GLOBAL' }],
    },
    {
      code: 'ACS-0074',
      name: 'Paras Rajendrakumar Prajapati',
      email: 'paras.prajapati@acsengitech.com',
      designation: 'Project Manager',
      grade: 'MANAGER',
      dept: 'TECH',
      manager: 'ACS-0061',
      skills: ['PCC panels', 'power distribution', 'project planning', 'client coordination'],
      roles: [{ key: 'PROJECT_MANAGER', scopeType: 'GLOBAL' }, { key: 'PM_BASE', scopeType: 'GLOBAL' }],
    },
    {
      code: 'ACS-0075',
      name: 'Munaf Anavarbhai Multani',
      email: 'munaf.multani@acsengitech.com',
      designation: 'Asst. Manager',
      grade: 'SENIOR_ENGINEER',
      dept: 'TECH',
      manager: 'ACS-0061',
      skills: ['site management', 'resource planning'],
      roles: [{ key: 'ASST_MANAGER', scopeType: 'GLOBAL' }],
    },
    {
      code: 'ACS-0076',
      name: 'Ridhhi Kiranbhai Patel',
      email: 'ridhhi.patel@acsengitech.com',
      designation: 'Sr. Engineer',
      grade: 'SENIOR_ENGINEER',
      dept: 'TECH',
      manager: 'ACS-0074',
      skills: ['busbar calculation', 'schematics verification'],
      roles: [{ key: 'SENIOR_ENGINEER', scopeType: 'GLOBAL' }],
    },
    {
      code: 'ACS-0077',
      name: 'Harsh Ajaybhai Suthar',
      email: 'harsh.suthar@acsengitech.com',
      designation: 'Sr. Engineer',
      grade: 'SENIOR_ENGINEER',
      dept: 'TECH',
      manager: 'ACS-0074',
      skills: ['control schematics', 'interlocking logic'],
      roles: [{ key: 'SENIOR_ENGINEER', scopeType: 'GLOBAL' }],
    },
    {
      code: 'ACS-0078',
      name: 'Chirag Rameshbhai Prajapati',
      email: 'chirag.prajapati@acsengitech.com',
      designation: 'Sr. Engineer',
      grade: 'SENIOR_ENGINEER',
      dept: 'TECH',
      manager: 'ACS-0074',
      skills: ['APFC calculation', 'harmonic filters'],
      roles: [{ key: 'SENIOR_ENGINEER', scopeType: 'GLOBAL' }],
    },
    {
      code: 'ACS-0079',
      name: 'Hitesh Rameshbhai Malviya',
      email: 'hitesh.malviya@acsengitech.com',
      designation: 'Sr. Engineer',
      grade: 'SENIOR_ENGINEER',
      dept: 'TECH',
      manager: 'ACS-0075',
      skills: ['protection coordination', 'breaker selection'],
      roles: [{ key: 'SENIOR_ENGINEER', scopeType: 'GLOBAL' }],
    },
    {
      code: 'ACS-0080',
      name: 'Harmitsinh Udavat',
      email: 'harmitsinh.udavat@acsengitech.com',
      designation: 'Service Engineer',
      grade: 'JUNIOR_ENGINEER',
      dept: 'TECH',
      manager: 'ACS-0063',
      skills: ['drawing assistance', 'site punch list'],
      roles: [{ key: 'JUNIOR_ENGINEER', scopeType: 'GLOBAL' }],
    },
    {
      code: 'ACS-0081',
      name: 'Krupesh Bhikhbhai Solanki',
      email: 'krupesh.solanki@acsengitech.com',
      designation: 'Sr. Engineer',
      grade: 'SENIOR_ENGINEER',
      dept: 'QC',
      manager: 'ACS-0057',
      skills: ['testing support', 'client coordination'],
      roles: [{ key: 'SENIOR_ENGINEER', scopeType: 'GLOBAL' }],
    },
    {
      code: 'ACS-0082',
      name: 'Ashish Dinkar Hajare',
      email: 'ashish.hajare@acsengitech.com',
      designation: 'Trainee Engineer',
      grade: 'TRAINEE',
      dept: 'TECH',
      manager: 'ACS-0075',
      skills: ['trainee', 'testing support'],
      roles: [{ key: 'JUNIOR_ENGINEER', scopeType: 'GLOBAL' }],
    },
    {
      code: 'ACS-0083',
      name: 'Tejas Yogesh Rokade',
      email: 'tejas.rokade@acsengitech.com',
      designation: 'Trainee Engineer',
      grade: 'TRAINEE',
      dept: 'TECH',
      manager: 'ACS-0070',
      skills: ['trainee', 'documentation'],
      roles: [{ key: 'JUNIOR_ENGINEER', scopeType: 'GLOBAL' }],
    },

    // Others / Office Staff
    {
      code: 'ACS-0084',
      name: 'Anil bhai Patel',
      email: 'anilbhai.patel@acsengitech.com',
      designation: 'Office Staff',
      grade: 'TRAINEE',
      dept: 'ADMIN',
      manager: 'ACS-0005',
      skills: ['facility management'],
      roles: [],
    },
    {
      code: 'ACS-0085',
      name: 'Geeta Telukula',
      email: 'geeta.telukula@acsengitech.com',
      designation: 'Office Staff',
      grade: 'TRAINEE',
      dept: 'ADMIN',
      manager: 'ACS-0005',
      skills: ['office support'],
      roles: [],
    },
    {
      code: 'ACS-0086',
      name: 'Manjiben Sodhaparmar',
      email: 'manjiben.sodhaparmar@acsengitech.com',
      designation: 'Office Staff',
      grade: 'TRAINEE',
      dept: 'ADMIN',
      manager: 'ACS-0005',
      skills: ['office support'],
      roles: [],
    },
    {
      code: 'ACS-0087',
      name: 'Bhanuben',
      email: 'bhanuben@acsengitech.com',
      designation: 'Office Staff',
      grade: 'TRAINEE',
      dept: 'ADMIN',
      manager: 'ACS-0005',
      skills: ['office support'],
      roles: [],
    },
    {
      code: 'ACS-0088',
      name: 'Suriya Ben Kichen Cleaning',
      email: 'suriyaben@acsengitech.com',
      designation: 'Office Staff',
      grade: 'TRAINEE',
      dept: 'ADMIN',
      manager: 'ACS-0005',
      skills: ['pantry support'],
      roles: [],
    },
    {
      code: 'ACS-0089',
      name: 'Mali',
      email: 'mali@acsengitech.com',
      designation: 'Office Staff',
      grade: 'TRAINEE',
      dept: 'ADMIN',
      manager: 'ACS-0005',
      skills: ['gardening'],
      roles: [],
    },
    {
      code: 'ACS-0090',
      name: 'Kiritbhai Patel - Canteen',
      email: 'kiritbhai.patel@acsengitech.com',
      designation: 'Office Staff',
      grade: 'TRAINEE',
      dept: 'ADMIN',
      manager: 'ACS-0005',
      skills: ['canteen services'],
      roles: [],
    },
    {
      code: 'ACS-0091',
      name: 'Chhanabhai',
      email: 'chhanabhai.security@acsengitech.com',
      designation: 'Office Staff - Security',
      grade: 'TRAINEE',
      dept: 'ADMIN',
      manager: 'ACS-0005',
      skills: ['gate security', 'visitor logging'],
      roles: [],
    },
    {
      code: 'ACS-0092',
      name: 'Kantibhai',
      email: 'kantibhai.security@acsengitech.com',
      designation: 'Office Staff - Security',
      grade: 'TRAINEE',
      dept: 'ADMIN',
      manager: 'ACS-0005',
      skills: ['factory security'],
      roles: [],
    },
    {
      code: 'ACS-0093',
      name: 'Punji Ben',
      email: 'punjiben@acsengitech.com',
      designation: 'Office Staff',
      grade: 'TRAINEE',
      dept: 'ADMIN',
      manager: 'ACS-0005',
      skills: ['housekeeping'],
      roles: [],
    },
    {
      code: 'ACS-0094',
      name: 'Inaben',
      email: 'inaben@acsengitech.com',
      designation: 'Office Staff',
      grade: 'TRAINEE',
      dept: 'ADMIN',
      manager: 'ACS-0005',
      skills: ['housekeeping'],
      roles: [],
    },
    {
      code: 'ACS-0095',
      name: 'Govindbhai',
      email: 'govindbhai@acsengitech.com',
      designation: 'Office Staff',
      grade: 'TRAINEE',
      dept: 'ADMIN',
      manager: 'ACS-0005',
      skills: ['courier & transport support'],
      roles: [],
    },
  ];

  // Create-only: never overwrite a person's details, password, manager or roles that
  // were changed in the app. Only people created in this run get their seed defaults.
  const userId = new Map<string, string>();
  const createdCodes = new Set<string>();
  for (const person of people) {
    const existing = await prisma.user.findUnique({ where: { employeeCode: person.code }, select: { id: true } });
    if (existing) {
      userId.set(person.code, existing.id);
      continue;
    }
    createdCodes.add(person.code);
    const user = await prisma.user.create({
      data: {
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
    });
    userId.set(person.code, user.id);
  }

  // Line managers: only for people created in this run.
  for (const person of people) {
    if (!person.manager || !createdCodes.has(person.code)) continue;
    await prisma.user.update({
      where: { id: userId.get(person.code)! },
      data: { managerId: userId.get(person.manager) ?? null },
    });
  }

  // Department heads: only where no head is set yet.
  const departmentHeads: Array<[string, string]> = [
    ['TECH', 'ACS-0061'], ['DESIGN', 'ACS-0028'], ['PROD', 'ACS-0035'], ['QC', 'ACS-0057'],
    ['SALES', 'ACS-0010'], ['PUR', 'ACS-0007'], ['ACC', 'ACS-0021'], ['STORES', 'ACS-0024'],
  ];
  for (const [dept, code] of departmentHeads) {
    const deptId = departmentId.get(dept);
    const headId = userId.get(code);
    if (!deptId || !headId) continue;
    await prisma.department.updateMany({ where: { id: deptId, headId: null }, data: { headId } });
  }

  // Seed role grants: only for people created in this run. Roles given or removed in the
  // admin screen are never touched.
  for (const person of people) {
    if (!createdCodes.has(person.code)) continue;
    const uid = userId.get(person.code)!;
    for (const grant of person.roles) {
      const rid = roleId.get(grant.key);
      if (!rid) continue;
      const scopeId = grant.scope ? departmentId.get(grant.scope) ?? null : null;
      await prisma.roleAssignment.create({
        data: { userId: uid, roleId: rid, scopeType: grant.scopeType, scopeId },
      });
    }
  }

  // --------------------------------------------------------------------- clients
  // Deliberately NOT seeded. The client master is owned by the app: users add clients
  // through the project wizard's "Add new client". Seeding sample clients here meant
  // deleted ones reappeared on the next container start. Do not reintroduce this.

  console.log(`Successfully seeded ${people.length} people across ${departmentTree.length} departments!`);
  console.log(`Primary Super Admin: admin@acsengitech.com / <SEED_PASSWORD>`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
