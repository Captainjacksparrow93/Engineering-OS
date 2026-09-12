/**
 * Seed data for Vidyut Switchgear Pvt Ltd.
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

const PASSWORD: string = process.env.SEED_PASSWORD || 'ChangeMe@2026!';

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
  console.log('Seeding Engineering OS with full organization chart...');

  // ---------------------------------------------------------------- permissions
  for (const key of ALL_PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key },
      create: { key, name: PERMISSIONS[key], module: key.split('.')[0]!, description: PERMISSIONS[key] },
      update: { name: PERMISSIONS[key], description: PERMISSIONS[key] },
    });
  }
  const permissions = await prisma.permission.findMany();
  const permissionId = new Map(permissions.map((p) => [p.key, p.id]));

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
      update: { name: dept.name, parentId: dept.parent ? departmentId.get(dept.parent) : null },
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
    // Super Admin Controller
    {
      code: 'VS-0001',
      name: 'Admin Controller',
      email: 'admin@vidyutswitchgear.com',
      designation: 'System Administrator',
      grade: 'MANAGER',
      skills: ['system administration', 'security'],
      roles: [{ key: 'SUPER_ADMIN', scopeType: 'GLOBAL' }],
    },

    // Directors
    {
      code: 'VS-0002',
      name: 'Satishkumar Mohanbhai Nagar',
      email: 'satishkumar.nagar@vidyutswitchgear.com',
      designation: 'Director',
      grade: 'DIRECTOR',
      dept: 'DIR',
      skills: ['corporate strategy', 'operations', 'executive sponsorship'],
      roles: [{ key: 'DIRECTOR', scopeType: 'GLOBAL' }],
    },
    {
      code: 'VS-0003',
      name: 'Bhavesh Ishwarbhai Prajapati',
      email: 'bhavesh.prajapati@vidyutswitchgear.com',
      designation: 'Director',
      grade: 'DIRECTOR',
      dept: 'DIR',
      skills: ['commercial governance', 'finance', 'project sponsorship'],
      roles: [{ key: 'DIRECTOR', scopeType: 'GLOBAL' }],
    },
    {
      code: 'VS-0004',
      name: 'Shaktikumar Vasava',
      email: 'shaktikumar.vasava@vidyutswitchgear.com',
      designation: 'Director',
      grade: 'DIRECTOR',
      dept: 'DIR',
      skills: ['factory operations', 'plant management'],
      roles: [{ key: 'DIRECTOR', scopeType: 'GLOBAL' }],
    },

    // HR
    {
      code: 'VS-0005',
      name: 'Truptee Manubhai Chavda',
      email: 'truptee.chavda@vidyutswitchgear.com',
      designation: 'Hr.Executive',
      grade: 'ENGINEER',
      dept: 'HR',
      manager: 'VS-0002',
      skills: ['talent management', 'recruitment', 'leave management'],
      roles: [{ key: 'DEPARTMENT_HEAD', scopeType: 'DEPARTMENT', scope: 'HR' }],
    },

    // Receptionist
    {
      code: 'VS-0006',
      name: 'Pooja Ashokbhai Bhut',
      email: 'pooja.bhut@vidyutswitchgear.com',
      designation: 'Receptionist',
      grade: 'JUNIOR_ENGINEER',
      dept: 'ADMIN',
      manager: 'VS-0005',
      skills: ['front desk', 'guest coordination'],
      roles: [{ key: 'VIEWER', scopeType: 'DEPARTMENT', scope: 'ADMIN' }],
    },

    // Purchase
    {
      code: 'VS-0007',
      name: 'Bhavik Revabhai Patel',
      email: 'bhavik.patel@vidyutswitchgear.com',
      designation: 'Sr. Purchase Executive',
      grade: 'SENIOR_ENGINEER',
      dept: 'PUR',
      manager: 'VS-0002',
      skills: ['switchgear procurement', 'vendor negotiations', 'BOM costing'],
      roles: [{ key: 'DEPARTMENT_HEAD', scopeType: 'DEPARTMENT', scope: 'PUR' }],
    },
    {
      code: 'VS-0008',
      name: 'Hardik Arvindbhai Kanani',
      email: 'hardik.kanani@vidyutswitchgear.com',
      designation: 'Purchase Engineer',
      grade: 'ENGINEER',
      dept: 'PUR',
      manager: 'VS-0007',
      skills: ['raw material purchase', 'copper busbar sourcing'],
      roles: [{ key: 'JUNIOR_ENGINEER', scopeType: 'DEPARTMENT', scope: 'PUR' }],
    },
    {
      code: 'VS-0009',
      name: 'Dhaval Narendrabhai Patel',
      email: 'dhaval.patel@vidyutswitchgear.com',
      designation: 'Purchase Engineer',
      grade: 'ENGINEER',
      dept: 'PUR',
      manager: 'VS-0007',
      skills: ['switchgear components', 'relays sourcing'],
      roles: [{ key: 'JUNIOR_ENGINEER', scopeType: 'DEPARTMENT', scope: 'PUR' }],
    },

    // Sales
    {
      code: 'VS-0010',
      name: 'Dharmesh Bhartbhai Thummar',
      email: 'dharmesh.thummar@vidyutswitchgear.com',
      designation: 'Sales Head',
      grade: 'HEAD',
      dept: 'SALES',
      manager: 'VS-0002',
      skills: ['sales strategy', 'client negotiations', 'key accounts'],
      roles: [{ key: 'DEPARTMENT_HEAD', scopeType: 'DEPARTMENT', scope: 'SALES' }],
    },
    {
      code: 'VS-0011',
      name: 'Vasant Bhulabhai Patel',
      email: 'vasant.patel@vidyutswitchgear.com',
      designation: 'Project Sales Manager',
      grade: 'MANAGER',
      dept: 'SALES',
      manager: 'VS-0010',
      skills: ['industrial projects', 'client coordination'],
      roles: [{ key: 'PROJECT_MANAGER', scopeType: 'DEPARTMENT', scope: 'SALES' }],
    },
    {
      code: 'VS-0012',
      name: 'Hariohm Kiranbhai vyas',
      email: 'hariohm.vyas@vidyutswitchgear.com',
      designation: 'Sales Engineer',
      grade: 'ENGINEER',
      dept: 'SALES',
      manager: 'VS-0010',
      skills: ['tendering', 'technical proposal'],
      roles: [{ key: 'JUNIOR_ENGINEER', scopeType: 'DEPARTMENT', scope: 'SALES' }],
    },
    {
      code: 'VS-0013',
      name: 'Aakash Kirankumar Panchal',
      email: 'aakash.panchal@vidyutswitchgear.com',
      designation: 'Sr. Estimation Engineer',
      grade: 'SENIOR_ENGINEER',
      dept: 'SALES',
      manager: 'VS-0010',
      skills: ['panel estimation', 'BOM calculation', 'costing'],
      roles: [{ key: 'SENIOR_ENGINEER', scopeType: 'DEPARTMENT', scope: 'SALES' }],
    },
    {
      code: 'VS-0014',
      name: 'Bhavesh Rashikbhai Koli',
      email: 'bhavesh.koli@vidyutswitchgear.com',
      designation: 'Estimation Engineer',
      grade: 'ENGINEER',
      dept: 'SALES',
      manager: 'VS-0013',
      skills: ['cost estimation', 'feeder calculations'],
      roles: [{ key: 'JUNIOR_ENGINEER', scopeType: 'DEPARTMENT', scope: 'SALES' }],
    },
    {
      code: 'VS-0015',
      name: 'Manas Milind Tonapi',
      email: 'manas.tonapi@vidyutswitchgear.com',
      designation: 'Resident Sr.Sales Engineer',
      grade: 'SENIOR_ENGINEER',
      dept: 'SALES',
      manager: 'VS-0010',
      skills: ['site business development', 'OEM sales'],
      roles: [{ key: 'SENIOR_ENGINEER', scopeType: 'DEPARTMENT', scope: 'SALES' }],
    },
    {
      code: 'VS-0016',
      name: 'Ankit Ravjibhai Parmar',
      email: 'ankit.parmar@vidyutswitchgear.com',
      designation: 'Estimation Engineer',
      grade: 'ENGINEER',
      dept: 'SALES',
      manager: 'VS-0013',
      skills: ['panel costing', 'estimation'],
      roles: [{ key: 'JUNIOR_ENGINEER', scopeType: 'DEPARTMENT', scope: 'SALES' }],
    },

    // Trading Sales
    {
      code: 'VS-0017',
      name: 'Hitesh Aandabhai Suthar',
      email: 'hitesh.suthar@vidyutswitchgear.com',
      designation: 'Sr. Purchase Executive',
      grade: 'SENIOR_ENGINEER',
      dept: 'TRADING',
      manager: 'VS-0010',
      skills: ['trading procurement', 'trading sales'],
      roles: [{ key: 'DEPARTMENT_HEAD', scopeType: 'DEPARTMENT', scope: 'TRADING' }],
    },
    {
      code: 'VS-0018',
      name: 'Rakshita Jitendrakumar Parmar',
      email: 'rakshita.parmar@vidyutswitchgear.com',
      designation: 'Trading Sales Executive',
      grade: 'ENGINEER',
      dept: 'TRADING',
      manager: 'VS-0017',
      skills: ['switchgear components trading', 'client orders'],
      roles: [{ key: 'JUNIOR_ENGINEER', scopeType: 'DEPARTMENT', scope: 'TRADING' }],
    },
    {
      code: 'VS-0019',
      name: 'Sonali Sureshbhai Dodiya',
      email: 'sonali.dodiya@vidyutswitchgear.com',
      designation: 'Trading Sales Executive',
      grade: 'ENGINEER',
      dept: 'TRADING',
      manager: 'VS-0017',
      skills: ['quotations', 'dispatch follow up'],
      roles: [{ key: 'JUNIOR_ENGINEER', scopeType: 'DEPARTMENT', scope: 'TRADING' }],
    },

    // IT
    {
      code: 'VS-0020',
      name: 'Kirtan Rajeshkumar Nagar',
      email: 'kirtan.nagar@vidyutswitchgear.com',
      designation: 'Network & Hardware Engineer',
      grade: 'ENGINEER',
      dept: 'IT',
      manager: 'VS-0002',
      skills: ['system administration', 'networking', 'hardware'],
      roles: [{ key: 'DEPARTMENT_HEAD', scopeType: 'DEPARTMENT', scope: 'IT' }],
    },

    // Account
    {
      code: 'VS-0021',
      name: 'Kishan Dayabhai Prajapati',
      email: 'kishan.prajapati@vidyutswitchgear.com',
      designation: 'Sr. Accountant',
      grade: 'HEAD',
      dept: 'ACC',
      manager: 'VS-0003',
      skills: ['financial accounting', 'GST', 'billing', 'audit'],
      roles: [{ key: 'DEPARTMENT_HEAD', scopeType: 'DEPARTMENT', scope: 'ACC' }],
    },
    {
      code: 'VS-0022',
      name: 'Ajay Prakashbhai Pandya',
      email: 'ajay.pandya@vidyutswitchgear.com',
      designation: 'Jr. Accountant',
      grade: 'JUNIOR_ENGINEER',
      dept: 'ACC',
      manager: 'VS-0021',
      skills: ['vouchers', 'ledger entry', 'invoicing'],
      roles: [{ key: 'VIEWER', scopeType: 'DEPARTMENT', scope: 'ACC' }],
    },
    {
      code: 'VS-0023',
      name: 'Parth Prakashbhai Sai Darji',
      email: 'parth.darji@vidyutswitchgear.com',
      designation: 'Jr. Accountant',
      grade: 'JUNIOR_ENGINEER',
      dept: 'ACC',
      manager: 'VS-0021',
      skills: ['payroll reconciliation', 'banking'],
      roles: [{ key: 'VIEWER', scopeType: 'DEPARTMENT', scope: 'ACC' }],
    },

    // Stores
    {
      code: 'VS-0024',
      name: 'Chirag Ishwarbhai Valand',
      email: 'chirag.valand@vidyutswitchgear.com',
      designation: 'Store in Charge',
      grade: 'MANAGER',
      dept: 'STORES',
      manager: 'VS-0004',
      skills: ['inventory control', 'GRN', 'material issue'],
      roles: [{ key: 'DEPARTMENT_HEAD', scopeType: 'DEPARTMENT', scope: 'STORES' }],
    },
    {
      code: 'VS-0025',
      name: 'Kavin Sureshbhai Patel',
      email: 'kavin.patel@vidyutswitchgear.com',
      designation: 'Store in Charge',
      grade: 'MANAGER',
      dept: 'STORES',
      manager: 'VS-0024',
      skills: ['stock verification', 'dispatch stores'],
      roles: [{ key: 'PROJECT_MANAGER', scopeType: 'DEPARTMENT', scope: 'STORES' }],
    },
    {
      code: 'VS-0026',
      name: 'Urvish Kamleshbhai Patel',
      email: 'urvish.patel@vidyutswitchgear.com',
      designation: 'Store Officer',
      grade: 'ENGINEER',
      dept: 'STORES',
      manager: 'VS-0024',
      skills: ['stock inward', 'bin tracking'],
      roles: [{ key: 'JUNIOR_ENGINEER', scopeType: 'DEPARTMENT', scope: 'STORES' }],
    },
    {
      code: 'VS-0027',
      name: 'Bharat Dabhi',
      email: 'bharat.dabhi@vidyutswitchgear.com',
      designation: 'Store Officer',
      grade: 'ENGINEER',
      dept: 'STORES',
      manager: 'VS-0024',
      skills: ['raw materials', 'hardware stores'],
      roles: [{ key: 'JUNIOR_ENGINEER', scopeType: 'DEPARTMENT', scope: 'STORES' }],
    },

    // Design
    {
      code: 'VS-0028',
      name: 'Jay Vijaykumar Patel',
      email: 'jay.patel@vidyutswitchgear.com',
      designation: 'Sr. Design Engineer',
      grade: 'SENIOR_ENGINEER',
      dept: 'DESIGN',
      manager: 'VS-0061',
      skills: ['GA drawing', 'EPLAN', 'AutoCAD', 'LV switchgear', 'busbar calculation'],
      roles: [
        { key: 'DEPARTMENT_HEAD', scopeType: 'DEPARTMENT', scope: 'DESIGN' },
        { key: 'SENIOR_ENGINEER', scopeType: 'DEPARTMENT', scope: 'DESIGN' },
      ],
    },
    {
      code: 'VS-0029',
      name: 'Surajkumar Jaysukhbhai Chaniyara',
      email: 'surajkumar.chaniyara@vidyutswitchgear.com',
      designation: 'Sr. Design Engineer',
      grade: 'SENIOR_ENGINEER',
      dept: 'DESIGN',
      manager: 'VS-0028',
      skills: ['schematics', 'EPLAN', 'MCC design', 'PCC design'],
      roles: [{ key: 'SENIOR_ENGINEER', scopeType: 'DEPARTMENT', scope: 'DESIGN' }],
    },
    {
      code: 'VS-0030',
      name: 'Aniq Istiyak Farooqui',
      email: 'aniq.farooqui@vidyutswitchgear.com',
      designation: 'Design Engineer',
      grade: 'ENGINEER',
      dept: 'DESIGN',
      manager: 'VS-0028',
      skills: ['AutoCAD electrical', 'busbar routing', 'panel layouts'],
      roles: [{ key: 'SENIOR_ENGINEER', scopeType: 'DEPARTMENT', scope: 'DESIGN' }],
    },
    {
      code: 'VS-0031',
      name: 'Jagdish Prakashbhai Prajapati',
      email: 'jagdish.prajapati@vidyutswitchgear.com',
      designation: 'Design Engineer',
      grade: 'ENGINEER',
      dept: 'DESIGN',
      manager: 'VS-0028',
      skills: ['BOM generation', 'control wiring design'],
      roles: [{ key: 'JUNIOR_ENGINEER', scopeType: 'DEPARTMENT', scope: 'DESIGN' }],
    },
    {
      code: 'VS-0032',
      name: 'Darshan Upendrabhai Prajapati',
      email: 'darshan.prajapati@vidyutswitchgear.com',
      designation: 'Design Engineer',
      grade: 'ENGINEER',
      dept: 'DESIGN',
      manager: 'VS-0028',
      skills: ['enclosure fabrication drawings', 'SolidWorks', 'sheet metal'],
      roles: [{ key: 'JUNIOR_ENGINEER', scopeType: 'DEPARTMENT', scope: 'DESIGN' }],
    },
    {
      code: 'VS-0033',
      name: 'Mayurkumar Vishnubhai Patel',
      email: 'mayurkumar.patel@vidyutswitchgear.com',
      designation: 'Design Engineer',
      grade: 'ENGINEER',
      dept: 'DESIGN',
      manager: 'VS-0028',
      skills: ['APFC panel design', 'feeder pillars'],
      roles: [{ key: 'JUNIOR_ENGINEER', scopeType: 'DEPARTMENT', scope: 'DESIGN' }],
    },
    {
      code: 'VS-0034',
      name: 'Hardik Jayntibhai Jethva',
      email: 'hardik.jethva@vidyutswitchgear.com',
      designation: 'Design Engineer',
      grade: 'ENGINEER',
      dept: 'DESIGN',
      manager: 'VS-0028',
      skills: ['terminal block diagrams', 'cable schedules'],
      roles: [{ key: 'JUNIOR_ENGINEER', scopeType: 'DEPARTMENT', scope: 'DESIGN' }],
    },

    // Production - Supervisor
    {
      code: 'VS-0035',
      name: 'Jignesh Ganpatbhai Prajapati',
      email: 'jignesh.prajapati@vidyutswitchgear.com',
      designation: 'Sr.Production Supervisor',
      grade: 'MANAGER',
      dept: 'PROD',
      manager: 'VS-0004',
      skills: ['shop floor management', 'panel assembly', 'busbar fabrication', 'wiring supervision'],
      roles: [{ key: 'DEPARTMENT_HEAD', scopeType: 'DEPARTMENT', scope: 'PROD' }],
    },

    // Production - Logistics
    {
      code: 'VS-0036',
      name: 'Vicky Amrutbhai Chauhan',
      email: 'vicky.chauhan@vidyutswitchgear.com',
      designation: 'Logistics',
      grade: 'ENGINEER',
      dept: 'PROD_LOG',
      manager: 'VS-0035',
      skills: ['material movement', 'panel packing', 'dispatch'],
      roles: [{ key: 'JUNIOR_ENGINEER', scopeType: 'DEPARTMENT', scope: 'PROD' }],
    },
    {
      code: 'VS-0037',
      name: 'Anil Vishnubhai Prajapati',
      email: 'anil.v.prajapati@vidyutswitchgear.com',
      designation: 'Logistics',
      grade: 'ENGINEER',
      dept: 'PROD_LOG',
      manager: 'VS-0035',
      skills: ['transportation', 'loading'],
      roles: [{ key: 'JUNIOR_ENGINEER', scopeType: 'DEPARTMENT', scope: 'PROD' }],
    },
    {
      code: 'VS-0038',
      name: 'Darshan Bhadreshbhai Patel',
      email: 'darshan.b.patel@vidyutswitchgear.com',
      designation: 'Logistics',
      grade: 'ENGINEER',
      dept: 'PROD_LOG',
      manager: 'VS-0035',
      skills: ['forklift', 'crate packing'],
      roles: [{ key: 'JUNIOR_ENGINEER', scopeType: 'DEPARTMENT', scope: 'PROD' }],
    },
    {
      code: 'VS-0039',
      name: 'Kishankumar Kalaji Parmar',
      email: 'kishankumar.parmar@vidyutswitchgear.com',
      designation: 'Logistics',
      grade: 'ENGINEER',
      dept: 'PROD_LOG',
      manager: 'VS-0035',
      skills: ['dispatch documentation', 'handling'],
      roles: [{ key: 'JUNIOR_ENGINEER', scopeType: 'DEPARTMENT', scope: 'PROD' }],
    },
    {
      code: 'VS-0040',
      name: 'Rashik Thakor',
      email: 'rashik.thakor@vidyutswitchgear.com',
      designation: 'Logistics',
      grade: 'ENGINEER',
      dept: 'PROD_LOG',
      manager: 'VS-0035',
      skills: ['dispatch', 'packing'],
      roles: [{ key: 'JUNIOR_ENGINEER', scopeType: 'DEPARTMENT', scope: 'PROD' }],
    },

    // Production - Assembly
    {
      code: 'VS-0041',
      name: 'Vijay Jantibhai Patel',
      email: 'vijay.patel@vidyutswitchgear.com',
      designation: 'Assembly',
      grade: 'ENGINEER',
      dept: 'PROD_ASSY',
      manager: 'VS-0035',
      skills: ['enclosure assembly', 'switchgear mounting', 'busbar fitting'],
      roles: [{ key: 'JUNIOR_ENGINEER', scopeType: 'DEPARTMENT', scope: 'PROD' }],
    },
    {
      code: 'VS-0042',
      name: 'Chetan Sumanbhai Patel',
      email: 'chetan.patel@vidyutswitchgear.com',
      designation: 'Assembly',
      grade: 'ENGINEER',
      dept: 'PROD_ASSY',
      manager: 'VS-0035',
      skills: ['breaker mounting', 'door interlocks', 'busbar assembly'],
      roles: [{ key: 'JUNIOR_ENGINEER', scopeType: 'DEPARTMENT', scope: 'PROD' }],
    },
    {
      code: 'VS-0043',
      name: 'Raju Vajesinh Dabhi',
      email: 'raju.dabhi@vidyutswitchgear.com',
      designation: 'Assembly',
      grade: 'ENGINEER',
      dept: 'PROD_ASSY',
      manager: 'VS-0035',
      skills: ['mechanical assembly', 'hardware'],
      roles: [{ key: 'JUNIOR_ENGINEER', scopeType: 'DEPARTMENT', scope: 'PROD' }],
    },

    // Production - Wire Men
    {
      code: 'VS-0044',
      name: 'Jigarbhai Sureshbhai Prajapati',
      email: 'jigar.prajapati@vidyutswitchgear.com',
      designation: 'Sr.Wire Man',
      grade: 'SENIOR_ENGINEER',
      dept: 'PROD_WIRE',
      manager: 'VS-0035',
      skills: ['power wiring', 'control wiring', 'ferrule numbering', 'MCC wiring'],
      roles: [{ key: 'SENIOR_ENGINEER', scopeType: 'DEPARTMENT', scope: 'PROD' }],
    },
    {
      code: 'VS-0045',
      name: 'Darshan Jayntibhai Patel',
      email: 'darshan.j.patel@vidyutswitchgear.com',
      designation: 'Sr.Wire Man',
      grade: 'SENIOR_ENGINEER',
      dept: 'PROD_WIRE',
      manager: 'VS-0035',
      skills: ['relay wiring', 'PLC wiring', 'panel dressing'],
      roles: [{ key: 'SENIOR_ENGINEER', scopeType: 'DEPARTMENT', scope: 'PROD' }],
    },
    {
      code: 'VS-0046',
      name: 'Alkesh Rajeshbhai Patel',
      email: 'alkesh.patel@vidyutswitchgear.com',
      designation: 'Wire Man',
      grade: 'ENGINEER',
      dept: 'PROD_WIRE',
      manager: 'VS-0044',
      skills: ['control wiring', 'crimping'],
      roles: [{ key: 'JUNIOR_ENGINEER', scopeType: 'DEPARTMENT', scope: 'PROD' }],
    },
    {
      code: 'VS-0047',
      name: 'Aryan Pankajbhai Patel',
      email: 'aryan.patel@vidyutswitchgear.com',
      designation: 'Wire Man',
      grade: 'ENGINEER',
      dept: 'PROD_WIRE',
      manager: 'VS-0044',
      skills: ['feeder wiring', 'bus wiring'],
      roles: [{ key: 'JUNIOR_ENGINEER', scopeType: 'DEPARTMENT', scope: 'PROD' }],
    },
    {
      code: 'VS-0048',
      name: 'Hitkumar Rakeshbhai Patel',
      email: 'hitkumar.patel@vidyutswitchgear.com',
      designation: 'Wire Man',
      grade: 'ENGINEER',
      dept: 'PROD_WIRE',
      manager: 'VS-0044',
      skills: ['wiring', 'bunching', 'dressing'],
      roles: [{ key: 'JUNIOR_ENGINEER', scopeType: 'DEPARTMENT', scope: 'PROD' }],
    },
    {
      code: 'VS-0049',
      name: 'Pradip Govindbhai Sodha',
      email: 'pradip.sodha@vidyutswitchgear.com',
      designation: 'Wire Man',
      grade: 'ENGINEER',
      dept: 'PROD_WIRE',
      manager: 'VS-0044',
      skills: ['wiring', 'crimping'],
      roles: [{ key: 'JUNIOR_ENGINEER', scopeType: 'DEPARTMENT', scope: 'PROD' }],
    },
    {
      code: 'VS-0050',
      name: 'Arun Prabhatbhai Solanki',
      email: 'arun.solanki@vidyutswitchgear.com',
      designation: 'Wire Man',
      grade: 'ENGINEER',
      dept: 'PROD_WIRE',
      manager: 'VS-0044',
      skills: ['wiring', 'ferruling'],
      roles: [{ key: 'JUNIOR_ENGINEER', scopeType: 'DEPARTMENT', scope: 'PROD' }],
    },
    {
      code: 'VS-0051',
      name: 'Virendrasinh Amarsinh Solanki',
      email: 'virendrasinh.solanki@vidyutswitchgear.com',
      designation: 'Wire Man',
      grade: 'ENGINEER',
      dept: 'PROD_WIRE',
      manager: 'VS-0044',
      skills: ['wiring', 'cable routing'],
      roles: [{ key: 'JUNIOR_ENGINEER', scopeType: 'DEPARTMENT', scope: 'PROD' }],
    },
    {
      code: 'VS-0052',
      name: 'Dipakkumar Manealbhai Zala',
      email: 'dipak.zala@vidyutswitchgear.com',
      designation: 'Wire Man',
      grade: 'ENGINEER',
      dept: 'PROD_WIRE',
      manager: 'VS-0044',
      skills: ['wiring', 'cable terminal connection'],
      roles: [{ key: 'JUNIOR_ENGINEER', scopeType: 'DEPARTMENT', scope: 'PROD' }],
    },
    {
      code: 'VS-0053',
      name: 'Kishanbhai Ashokbhai Sodha',
      email: 'kishan.sodha@vidyutswitchgear.com',
      designation: 'Wire Man',
      grade: 'ENGINEER',
      dept: 'PROD_WIRE',
      manager: 'VS-0044',
      skills: ['wiring', 'earthing'],
      roles: [{ key: 'JUNIOR_ENGINEER', scopeType: 'DEPARTMENT', scope: 'PROD' }],
    },
    {
      code: 'VS-0054',
      name: 'Pratik Vishanubhai Dabhi',
      email: 'pratik.dabhi@vidyutswitchgear.com',
      designation: 'Wire Man',
      grade: 'ENGINEER',
      dept: 'PROD_WIRE',
      manager: 'VS-0044',
      skills: ['wiring', 'terminal marking'],
      roles: [{ key: 'JUNIOR_ENGINEER', scopeType: 'DEPARTMENT', scope: 'PROD' }],
    },
    {
      code: 'VS-0055',
      name: 'Mittal Bhupendrakumar Dabhi',
      email: 'mittal.dabhi@vidyutswitchgear.com',
      designation: 'Sticker Operator',
      grade: 'TRAINEE',
      dept: 'PROD_WIRE',
      manager: 'VS-0044',
      skills: ['panel labeling', 'mimic stickers', 'ferrule printing'],
      roles: [{ key: 'VIEWER', scopeType: 'DEPARTMENT', scope: 'PROD' }],
    },
    {
      code: 'VS-0056',
      name: 'Anilkumar Arjitsinh Dabhi',
      email: 'anil.a.dabhi@vidyutswitchgear.com',
      designation: 'Sticker Operator',
      grade: 'TRAINEE',
      dept: 'PROD_WIRE',
      manager: 'VS-0044',
      skills: ['sticker printing', 'legend plates'],
      roles: [{ key: 'VIEWER', scopeType: 'DEPARTMENT', scope: 'PROD' }],
    },

    // QC
    {
      code: 'VS-0057',
      name: 'Amey Pradipbhai Kulkarni',
      email: 'amey.kulkarni@vidyutswitchgear.com',
      designation: 'Testing & QC Manager',
      grade: 'HEAD',
      dept: 'QC',
      manager: 'VS-0002',
      skills: ['routine testing', 'HV testing', 'megger test', 'protection relay calibration', 'IEC 61439'],
      roles: [{ key: 'DEPARTMENT_HEAD', scopeType: 'DEPARTMENT', scope: 'QC' }],
    },
    {
      code: 'VS-0058',
      name: 'Bhanupratapsingh Vasantsingh Rajput',
      email: 'bhanupratapsingh.rajput@vidyutswitchgear.com',
      designation: 'Sr.Testing Engineer',
      grade: 'SENIOR_ENGINEER',
      dept: 'QC',
      manager: 'VS-0057',
      skills: ['breaker testing', 'relay testing', 'control circuit testing'],
      roles: [{ key: 'SENIOR_ENGINEER', scopeType: 'DEPARTMENT', scope: 'QC' }],
    },
    {
      code: 'VS-0059',
      name: 'Meet Bharatbhai Varma',
      email: 'meet.varma@vidyutswitchgear.com',
      designation: 'Sr.Testing Engineer',
      grade: 'SENIOR_ENGINEER',
      dept: 'QC',
      manager: 'VS-0057',
      skills: ['FAT coordination', 'CT/PT polarity', 'insulation test'],
      roles: [{ key: 'SENIOR_ENGINEER', scopeType: 'DEPARTMENT', scope: 'QC' }],
    },
    {
      code: 'VS-0060',
      name: 'Rishit Jayeshbhai Joshi',
      email: 'rishit.joshi@vidyutswitchgear.com',
      designation: 'Junior Engineer',
      grade: 'JUNIOR_ENGINEER',
      dept: 'QC',
      manager: 'VS-0058',
      skills: ['routine testing reports', 'continuity test'],
      roles: [{ key: 'JUNIOR_ENGINEER', scopeType: 'DEPARTMENT', scope: 'QC' }],
    },

    // Technical
    {
      code: 'VS-0061',
      name: 'Dilipkumar Rameshbhai Asediya',
      email: 'dilipkumar.asediya@vidyutswitchgear.com',
      designation: 'Head of Technical',
      grade: 'HEAD',
      dept: 'TECH',
      manager: 'VS-0002',
      skills: ['technical leadership', 'project governance', 'engineering standards', 'WBS scheduling'],
      roles: [
        { key: 'DEPARTMENT_HEAD', scopeType: 'DEPARTMENT', scope: 'TECH' },
        { key: 'DEPARTMENT_HEAD', scopeType: 'DEPARTMENT', scope: 'DESIGN' },
      ],
    },
    {
      code: 'VS-0062',
      name: 'Rajani Bhurabhai Nagar',
      email: 'rajani.nagar@vidyutswitchgear.com',
      designation: 'Head of Service',
      grade: 'HEAD',
      dept: 'TECH',
      manager: 'VS-0061',
      skills: ['site commissioning', 'client service', 'AMC support'],
      roles: [{ key: 'DEPARTMENT_HEAD', scopeType: 'DEPARTMENT', scope: 'TECH' }],
    },
    {
      code: 'VS-0063',
      name: 'Parth Dasharathbhai Nagar',
      email: 'parth.nagar@vidyutswitchgear.com',
      designation: 'Project Manager',
      grade: 'MANAGER',
      dept: 'TECH',
      manager: 'VS-0061',
      skills: ['project management', 'scheduling', 'MCC panels', 'client delivery', 'critical path'],
      roles: [{ key: 'PROJECT_MANAGER', scopeType: 'GLOBAL' }],
    },
    {
      code: 'VS-0064',
      name: 'Shivam Bipinchandra Prajapati',
      email: 'shivam.prajapati@vidyutswitchgear.com',
      designation: 'Sr. Engineer',
      grade: 'SENIOR_ENGINEER',
      dept: 'TECH',
      manager: 'VS-0063',
      skills: ['PLC automation', 'SCADA', 'control panels'],
      roles: [{ key: 'SENIOR_ENGINEER', scopeType: 'DEPARTMENT', scope: 'TECH' }],
    },
    {
      code: 'VS-0065',
      name: 'Sahil Dipakbhai Patil',
      email: 'sahil.patil@vidyutswitchgear.com',
      designation: 'Jr. Engineer',
      grade: 'JUNIOR_ENGINEER',
      dept: 'TECH',
      manager: 'VS-0064',
      skills: ['automation testing', 'logic programming'],
      roles: [{ key: 'JUNIOR_ENGINEER', scopeType: 'DEPARTMENT', scope: 'TECH' }],
    },
    {
      code: 'VS-0066',
      name: 'Abbasali Mahamadali Sunasara',
      email: 'abbasali.sunasara@vidyutswitchgear.com',
      designation: 'Jr. Engineer',
      grade: 'JUNIOR_ENGINEER',
      dept: 'TECH',
      manager: 'VS-0064',
      skills: ['field wiring', 'commissioning'],
      roles: [{ key: 'JUNIOR_ENGINEER', scopeType: 'DEPARTMENT', scope: 'TECH' }],
    },
    {
      code: 'VS-0067',
      name: 'Het Harshadbhai Patel',
      email: 'het.patel@vidyutswitchgear.com',
      designation: 'Jr. Engineer',
      grade: 'JUNIOR_ENGINEER',
      dept: 'TECH',
      manager: 'VS-0064',
      skills: ['PLC troubleshooting', 'drives commissioning'],
      roles: [{ key: 'JUNIOR_ENGINEER', scopeType: 'DEPARTMENT', scope: 'TECH' }],
    },
    {
      code: 'VS-0068',
      name: 'Agastya Dilipbhai Patel',
      email: 'agastya.patel@vidyutswitchgear.com',
      designation: 'Sr. Engineer',
      grade: 'SENIOR_ENGINEER',
      dept: 'TECH',
      manager: 'VS-0063',
      skills: ['protection schemes', 'switchboard engineering'],
      roles: [{ key: 'SENIOR_ENGINEER', scopeType: 'DEPARTMENT', scope: 'TECH' }],
    },
    {
      code: 'VS-0069',
      name: 'Dixit Prajapati',
      email: 'dixit.prajapati@vidyutswitchgear.com',
      designation: 'Sr. Engineer',
      grade: 'SENIOR_ENGINEER',
      dept: 'TECH',
      manager: 'VS-0063',
      skills: ['synchronizing panels', 'DG automation'],
      roles: [{ key: 'SENIOR_ENGINEER', scopeType: 'DEPARTMENT', scope: 'TECH' }],
    },
    {
      code: 'VS-0070',
      name: 'Dhrupin Vithalbhai Vaghasiya',
      email: 'dhrupin.vaghasiya@vidyutswitchgear.com',
      designation: 'Asst. Manager',
      grade: 'MANAGER',
      dept: 'TECH',
      manager: 'VS-0061',
      skills: ['project coordination', 'vendor follow up', 'scheduling'],
      roles: [{ key: 'PROJECT_MANAGER', scopeType: 'GLOBAL' }],
    },
    {
      code: 'VS-0071',
      name: 'Yogi Bharatbhai Patel',
      email: 'yogi.patel@vidyutswitchgear.com',
      designation: 'Sr. Engineer',
      grade: 'SENIOR_ENGINEER',
      dept: 'TECH',
      manager: 'VS-0070',
      skills: ['site coordination', 'client FAT'],
      roles: [{ key: 'SENIOR_ENGINEER', scopeType: 'DEPARTMENT', scope: 'TECH' }],
    },
    {
      code: 'VS-0072',
      name: 'Anurag Sohandas Vaishnav',
      email: 'anurag.vaishnav@vidyutswitchgear.com',
      designation: 'Jr. Engineer',
      grade: 'JUNIOR_ENGINEER',
      dept: 'TECH',
      manager: 'VS-0071',
      skills: ['testing assist', 'drawing review'],
      roles: [{ key: 'JUNIOR_ENGINEER', scopeType: 'DEPARTMENT', scope: 'TECH' }],
    },
    {
      code: 'VS-0073',
      name: 'Jigar Girishbhai Nayak',
      email: 'jigar.nayak@vidyutswitchgear.com',
      designation: 'Trainee Engineer',
      grade: 'TRAINEE',
      dept: 'TECH',
      manager: 'VS-0071',
      skills: ['panel documentation', 'trainee'],
      roles: [{ key: 'JUNIOR_ENGINEER', scopeType: 'DEPARTMENT', scope: 'TECH' }],
    },
    {
      code: 'VS-0074',
      name: 'Paras Rajendrakumar Prajapati',
      email: 'paras.prajapati@vidyutswitchgear.com',
      designation: 'Project Manager',
      grade: 'MANAGER',
      dept: 'TECH',
      manager: 'VS-0061',
      skills: ['PCC panels', 'power distribution', 'project planning', 'client coordination'],
      roles: [{ key: 'PROJECT_MANAGER', scopeType: 'GLOBAL' }],
    },
    {
      code: 'VS-0075',
      name: 'Munaf Anavarbhai Multani',
      email: 'munaf.multani@vidyutswitchgear.com',
      designation: 'Asst. Manager',
      grade: 'MANAGER',
      dept: 'TECH',
      manager: 'VS-0061',
      skills: ['site management', 'resource planning'],
      roles: [{ key: 'PROJECT_MANAGER', scopeType: 'GLOBAL' }],
    },
    {
      code: 'VS-0076',
      name: 'Ridhhi Kiranbhai Patel',
      email: 'ridhhi.patel@vidyutswitchgear.com',
      designation: 'Sr. Engineer',
      grade: 'SENIOR_ENGINEER',
      dept: 'TECH',
      manager: 'VS-0074',
      skills: ['busbar calculation', 'schematics verification'],
      roles: [{ key: 'SENIOR_ENGINEER', scopeType: 'DEPARTMENT', scope: 'TECH' }],
    },
    {
      code: 'VS-0077',
      name: 'Harsh Ajaybhai Suthar',
      email: 'harsh.suthar@vidyutswitchgear.com',
      designation: 'Sr. Engineer',
      grade: 'SENIOR_ENGINEER',
      dept: 'TECH',
      manager: 'VS-0074',
      skills: ['control schematics', 'interlocking logic'],
      roles: [{ key: 'SENIOR_ENGINEER', scopeType: 'DEPARTMENT', scope: 'TECH' }],
    },
    {
      code: 'VS-0078',
      name: 'Chirag Rameshbhai Prajapati',
      email: 'chirag.prajapati@vidyutswitchgear.com',
      designation: 'Sr. Engineer',
      grade: 'SENIOR_ENGINEER',
      dept: 'TECH',
      manager: 'VS-0074',
      skills: ['APFC calculation', 'harmonic filters'],
      roles: [{ key: 'SENIOR_ENGINEER', scopeType: 'DEPARTMENT', scope: 'TECH' }],
    },
    {
      code: 'VS-0079',
      name: 'Hitesh Rameshbhai Malviya',
      email: 'hitesh.malviya@vidyutswitchgear.com',
      designation: 'Sr. Engineer',
      grade: 'SENIOR_ENGINEER',
      dept: 'TECH',
      manager: 'VS-0074',
      skills: ['protection coordination', 'breaker selection'],
      roles: [{ key: 'SENIOR_ENGINEER', scopeType: 'DEPARTMENT', scope: 'TECH' }],
    },
    {
      code: 'VS-0080',
      name: 'Harmitsinh Udavat',
      email: 'harmitsinh.udavat@vidyutswitchgear.com',
      designation: 'Jr. Engineer',
      grade: 'JUNIOR_ENGINEER',
      dept: 'TECH',
      manager: 'VS-0078',
      skills: ['drawing assistance', 'site punch list'],
      roles: [{ key: 'JUNIOR_ENGINEER', scopeType: 'DEPARTMENT', scope: 'TECH' }],
    },
    {
      code: 'VS-0081',
      name: 'Krupesh Bhikhbhai Solanki',
      email: 'krupesh.solanki@vidyutswitchgear.com',
      designation: 'Sr. Engineer',
      grade: 'SENIOR_ENGINEER',
      dept: 'TECH',
      manager: 'VS-0074',
      skills: ['testing support', 'client coordination'],
      roles: [{ key: 'SENIOR_ENGINEER', scopeType: 'DEPARTMENT', scope: 'TECH' }],
    },
    {
      code: 'VS-0082',
      name: 'Ashish Dinkar Hajare',
      email: 'ashish.hajare@vidyutswitchgear.com',
      designation: 'Trainee Engineer',
      grade: 'TRAINEE',
      dept: 'TECH',
      manager: 'VS-0081',
      skills: ['trainee', 'testing support'],
      roles: [{ key: 'JUNIOR_ENGINEER', scopeType: 'DEPARTMENT', scope: 'TECH' }],
    },
    {
      code: 'VS-0083',
      name: 'Tejas Yogesh Rokade',
      email: 'tejas.rokade@vidyutswitchgear.com',
      designation: 'Trainee Engineer',
      grade: 'TRAINEE',
      dept: 'TECH',
      manager: 'VS-0081',
      skills: ['trainee', 'documentation'],
      roles: [{ key: 'JUNIOR_ENGINEER', scopeType: 'DEPARTMENT', scope: 'TECH' }],
    },

    // Others / Office Staff
    {
      code: 'VS-0084',
      name: 'Anil bhai Patel',
      email: 'anilbhai.patel@vidyutswitchgear.com',
      designation: 'Office Staff',
      grade: 'TRAINEE',
      dept: 'ADMIN',
      manager: 'VS-0005',
      skills: ['facility management'],
      roles: [{ key: 'VIEWER', scopeType: 'DEPARTMENT', scope: 'ADMIN' }],
    },
    {
      code: 'VS-0085',
      name: 'Geeta Telukula',
      email: 'geeta.telukula@vidyutswitchgear.com',
      designation: 'Office Staff',
      grade: 'TRAINEE',
      dept: 'ADMIN',
      manager: 'VS-0005',
      skills: ['office support'],
      roles: [{ key: 'VIEWER', scopeType: 'DEPARTMENT', scope: 'ADMIN' }],
    },
    {
      code: 'VS-0086',
      name: 'Manjiben Sodhaparmar',
      email: 'manjiben.sodhaparmar@vidyutswitchgear.com',
      designation: 'Office Staff',
      grade: 'TRAINEE',
      dept: 'ADMIN',
      manager: 'VS-0005',
      skills: ['office support'],
      roles: [{ key: 'VIEWER', scopeType: 'DEPARTMENT', scope: 'ADMIN' }],
    },
    {
      code: 'VS-0087',
      name: 'Bhanuben',
      email: 'bhanuben@vidyutswitchgear.com',
      designation: 'Office Staff',
      grade: 'TRAINEE',
      dept: 'ADMIN',
      manager: 'VS-0005',
      skills: ['office support'],
      roles: [{ key: 'VIEWER', scopeType: 'DEPARTMENT', scope: 'ADMIN' }],
    },
    {
      code: 'VS-0088',
      name: 'Suriya Ben Kichen Cleaning',
      email: 'suriyaben@vidyutswitchgear.com',
      designation: 'Office Staff',
      grade: 'TRAINEE',
      dept: 'ADMIN',
      manager: 'VS-0005',
      skills: ['pantry support'],
      roles: [{ key: 'VIEWER', scopeType: 'DEPARTMENT', scope: 'ADMIN' }],
    },
    {
      code: 'VS-0089',
      name: 'Mali',
      email: 'mali@vidyutswitchgear.com',
      designation: 'Office Staff',
      grade: 'TRAINEE',
      dept: 'ADMIN',
      manager: 'VS-0005',
      skills: ['gardening'],
      roles: [{ key: 'VIEWER', scopeType: 'DEPARTMENT', scope: 'ADMIN' }],
    },
    {
      code: 'VS-0090',
      name: 'Kiritbhai Patel - Canteen',
      email: 'kiritbhai.patel@vidyutswitchgear.com',
      designation: 'Office Staff',
      grade: 'TRAINEE',
      dept: 'ADMIN',
      manager: 'VS-0005',
      skills: ['canteen services'],
      roles: [{ key: 'VIEWER', scopeType: 'DEPARTMENT', scope: 'ADMIN' }],
    },
    {
      code: 'VS-0091',
      name: 'Chhanabhai',
      email: 'chhanabhai.security@vidyutswitchgear.com',
      designation: 'Office Staff - Security',
      grade: 'TRAINEE',
      dept: 'ADMIN',
      manager: 'VS-0005',
      skills: ['gate security', 'visitor logging'],
      roles: [{ key: 'VIEWER', scopeType: 'DEPARTMENT', scope: 'ADMIN' }],
    },
    {
      code: 'VS-0092',
      name: 'Kantibhai',
      email: 'kantibhai.security@vidyutswitchgear.com',
      designation: 'Office Staff - Security',
      grade: 'TRAINEE',
      dept: 'ADMIN',
      manager: 'VS-0005',
      skills: ['factory security'],
      roles: [{ key: 'VIEWER', scopeType: 'DEPARTMENT', scope: 'ADMIN' }],
    },
    {
      code: 'VS-0093',
      name: 'Punji Ben',
      email: 'punjiben@vidyutswitchgear.com',
      designation: 'Office Staff',
      grade: 'TRAINEE',
      dept: 'ADMIN',
      manager: 'VS-0005',
      skills: ['housekeeping'],
      roles: [{ key: 'VIEWER', scopeType: 'DEPARTMENT', scope: 'ADMIN' }],
    },
    {
      code: 'VS-0094',
      name: 'Inaben',
      email: 'inaben@vidyutswitchgear.com',
      designation: 'Office Staff',
      grade: 'TRAINEE',
      dept: 'ADMIN',
      manager: 'VS-0005',
      skills: ['housekeeping'],
      roles: [{ key: 'VIEWER', scopeType: 'DEPARTMENT', scope: 'ADMIN' }],
    },
    {
      code: 'VS-0095',
      name: 'Govindbhai',
      email: 'govindbhai@vidyutswitchgear.com',
      designation: 'Office Staff',
      grade: 'TRAINEE',
      dept: 'ADMIN',
      manager: 'VS-0005',
      skills: ['courier & transport support'],
      roles: [{ key: 'VIEWER', scopeType: 'DEPARTMENT', scope: 'ADMIN' }],
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
      update: {
        email: person.email,
        passwordHash,
        fullName: person.name,
        designation: person.designation,
        grade: person.grade,
        departmentId: person.dept ? departmentId.get(person.dept) : null,
        skills: person.skills,
      },
    });
    userId.set(person.code, user.id);
  }

  // Set line managers
  for (const person of people) {
    if (!person.manager) continue;
    await prisma.user.update({
      where: { id: userId.get(person.code)! },
      data: { managerId: userId.get(person.manager) ?? null },
    });
  }

  // Set Department Heads
  if (departmentId.get('TECH') && userId.get('VS-0061')) {
    await prisma.department.update({ where: { id: departmentId.get('TECH')! }, data: { headId: userId.get('VS-0061') } });
  }
  if (departmentId.get('DESIGN') && userId.get('VS-0028')) {
    await prisma.department.update({ where: { id: departmentId.get('DESIGN')! }, data: { headId: userId.get('VS-0028') } });
  }
  if (departmentId.get('PROD') && userId.get('VS-0035')) {
    await prisma.department.update({ where: { id: departmentId.get('PROD')! }, data: { headId: userId.get('VS-0035') } });
  }
  if (departmentId.get('QC') && userId.get('VS-0057')) {
    await prisma.department.update({ where: { id: departmentId.get('QC')! }, data: { headId: userId.get('VS-0057') } });
  }
  if (departmentId.get('SALES') && userId.get('VS-0010')) {
    await prisma.department.update({ where: { id: departmentId.get('SALES')! }, data: { headId: userId.get('VS-0010') } });
  }
  if (departmentId.get('PUR') && userId.get('VS-0007')) {
    await prisma.department.update({ where: { id: departmentId.get('PUR')! }, data: { headId: userId.get('VS-0007') } });
  }
  if (departmentId.get('ACC') && userId.get('VS-0021')) {
    await prisma.department.update({ where: { id: departmentId.get('ACC')! }, data: { headId: userId.get('VS-0021') } });
  }
  if (departmentId.get('STORES') && userId.get('VS-0024')) {
    await prisma.department.update({ where: { id: departmentId.get('STORES')! }, data: { headId: userId.get('VS-0024') } });
  }

  // Grant role assignments
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
      manager: 'VS-0063', // Parth Dasharathbhai Nagar
      sponsor: 'VS-0002', // Satishkumar Mohanbhai Nagar
      department: 'TECH',
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
      manager: 'VS-0074', // Paras Rajendrakumar Prajapati
      sponsor: 'VS-0003', // Bhavesh Ishwarbhai Prajapati
      department: 'TECH',
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
      manager: 'VS-0070', // Dhrupin Vithalbhai Vaghasiya
      sponsor: 'VS-0004', // Shaktikumar Vasava
      department: 'TECH',
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
        sponsorId: userId.get(seed.sponsor)!,
        departmentId: departmentId.get(seed.department),
      },
      update: {
        managerId: userId.get(seed.manager)!,
        sponsorId: userId.get(seed.sponsor)!,
        departmentId: departmentId.get(seed.department),
      },
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
    // ---- PRJ-2026-001 (Tata Chemicals) --------------------------------------
    { key: 'P1-PH1', project: 'PRJ-2026-001', title: 'Engineering & Design', type: 'PHASE', hours: 0, start: -30, end: 5 },
    {
      key: 'P1-T1', project: 'PRJ-2026-001', parent: 'P1-PH1', title: 'General arrangement (GA) drawings for MCC',
      hours: 32, start: -30, end: -22, skills: ['GA drawing', 'AutoCAD'], assignee: 'VS-0028', percent: 100, status: 'COMPLETED',
    },
    {
      key: 'P1-T2', project: 'PRJ-2026-001', parent: 'P1-PH1', title: 'Power & control schematics - MCC feeders',
      hours: 48, start: -21, end: -10, skills: ['schematics', 'EPLAN'], assignee: 'VS-0029', percent: 100, status: 'COMPLETED',
      dependsOn: [{ on: 'P1-T1' }],
    },
    {
      key: 'P1-T3', project: 'PRJ-2026-001', parent: 'P1-PH1', title: 'Busbar sizing and short-circuit calculations',
      hours: 24, start: -15, end: -6, skills: ['busbar calculation'], assignee: 'VS-0030', percent: 100, status: 'COMPLETED',
      dependsOn: [{ on: 'P1-T2', type: 'START_TO_START', lag: 5 }],
    },
    {
      key: 'P1-T4', project: 'PRJ-2026-001', parent: 'P1-PH1', title: 'Bill of Materials (BOM) & switchgear release',
      hours: 20, start: -9, end: -2, skills: ['BOM generation'], assignee: 'VS-0031', percent: 100, status: 'COMPLETED',
      dependsOn: [{ on: 'P1-T2' }, { on: 'P1-T3' }],
    },
    {
      key: 'P1-T5', project: 'PRJ-2026-001', parent: 'P1-PH1', title: 'Customer drawing approval & revision clearance',
      hours: 8, start: -3, end: 5, skills: ['project management'], assignee: 'VS-0063', percent: 80, status: 'IN_PROGRESS',
      dependsOn: [{ on: 'P1-T4' }],
    },

    { key: 'P1-PH2', project: 'PRJ-2026-001', title: 'Fabrication & Assembly', type: 'PHASE', hours: 0, start: -8, end: 28 },
    {
      key: 'P1-T6', project: 'PRJ-2026-001', parent: 'P1-PH2', title: 'Enclosure sheet metal fabrication & 7-tank powder coating',
      hours: 64, start: -8, end: 12, skills: ['sheet metal', 'SolidWorks'], assignee: 'VS-0032', percent: 70, status: 'IN_PROGRESS',
      dependsOn: [{ on: 'P1-T4' }],
    },
    {
      key: 'P1-T7', project: 'PRJ-2026-001', parent: 'P1-PH2', title: 'Copper busbar cutting, bending and heat-shrink sleeving',
      hours: 40, start: 6, end: 18, skills: ['busbar fabrication'], assignee: 'VS-0035', percent: 25, status: 'IN_PROGRESS',
      dependsOn: [{ on: 'P1-T6', type: 'START_TO_START', lag: 10 }, { on: 'P1-T3' }],
    },
    {
      key: 'P1-T8', project: 'PRJ-2026-001', parent: 'P1-PH2', title: 'Switchgear component mounting & chassis fitting',
      hours: 56, start: 13, end: 25, skills: ['enclosure assembly', 'switchgear mounting'], assignee: 'VS-0041', percent: 0, status: 'TODO',
      dependsOn: [{ on: 'P1-T6' }],
    },
    {
      key: 'P1-T9', project: 'PRJ-2026-001', parent: 'P1-PH2', title: 'Power and control wiring with ferrule labeling',
      hours: 80, start: 19, end: 32, skills: ['power wiring', 'control wiring'], assignee: 'VS-0044', percent: 0, status: 'TODO',
      dependsOn: [{ on: 'P1-T7' }, { on: 'P1-T8' }],
    },

    { key: 'P1-PH3', project: 'PRJ-2026-001', title: 'Testing, Inspection & Dispatch', type: 'PHASE', hours: 0, start: 30, end: 45 },
    {
      key: 'P1-T10', project: 'PRJ-2026-001', parent: 'P1-PH3', title: 'Internal routine testing: HV, megger, trip interlocks',
      hours: 24, start: 33, end: 38, skills: ['routine testing', 'HV testing'], assignee: 'VS-0058', percent: 0, status: 'TODO',
      dependsOn: [{ on: 'P1-T9' }],
    },
    {
      key: 'P1-T11', project: 'PRJ-2026-001', parent: 'P1-PH3', title: 'Client Factory Acceptance Test (FAT) & Dispatch clearance',
      hours: 16, start: 39, end: 45, skills: ['FAT coordination'], assignee: 'VS-0057', percent: 0, status: 'TODO',
      dependsOn: [{ on: 'P1-T10' }],
    },

    // ---- PRJ-2026-002 (Sunrise Cement) --------------------------------------
    { key: 'P2-PH1', project: 'PRJ-2026-002', title: 'Engineering & Fabrication', type: 'PHASE', hours: 0, start: -12, end: 35 },
    {
      key: 'P2-T1', project: 'PRJ-2026-002', parent: 'P2-PH1', title: 'APFC capacitor sizing and harmonic study verification',
      hours: 24, start: -12, end: -4, skills: ['APFC panel design'], assignee: 'VS-0033', percent: 100, status: 'COMPLETED',
    },
    {
      key: 'P2-T2', project: 'PRJ-2026-002', parent: 'P2-PH1', title: 'APFC schematic & stage controller drawing',
      hours: 32, start: -3, end: 8, skills: ['schematics'], assignee: 'VS-0034', percent: 65, status: 'IN_PROGRESS',
      dependsOn: [{ on: 'P2-T1' }],
    },
    {
      key: 'P2-T3', project: 'PRJ-2026-002', parent: 'P2-PH1', title: 'Feeder pillar enclosure fabrication & louvers',
      hours: 48, start: 2, end: 18, skills: ['sheet metal'], assignee: 'VS-0042', percent: 20, status: 'IN_PROGRESS',
      dependsOn: [{ on: 'P2-T1' }],
    },
    {
      key: 'P2-T4', project: 'PRJ-2026-002', parent: 'P2-PH1', title: 'Capacitor bank mounting, detuned reactors & wiring',
      hours: 56, start: 19, end: 34, skills: ['power wiring'], assignee: 'VS-0045', percent: 0, status: 'TODO',
      dependsOn: [{ on: 'P2-T2' }, { on: 'P2-T3' }],
    },
    {
      key: 'P2-T5', project: 'PRJ-2026-002', parent: 'P2-PH1', title: 'PF controller calibration, step switching test & dispatch',
      hours: 20, start: 35, end: 42, skills: ['routine testing reports'], assignee: 'VS-0059', percent: 0, status: 'TODO',
      dependsOn: [{ on: 'P2-T4' }],
    },

    // ---- PRJ-2026-003 (Godrej Foods) ---------------------------------------
    { key: 'P3-PH1', project: 'PRJ-2026-003', title: 'Automation Architecture', type: 'PHASE', hours: 0, start: -4, end: 30 },
    {
      key: 'P3-T1', project: 'PRJ-2026-003', parent: 'P3-PH1', title: 'PLC I/O allocation list and network architecture (Profinet)',
      hours: 40, start: -4, end: 10, skills: ['PLC automation', 'SCADA'], assignee: 'VS-0064', percent: 45, status: 'IN_PROGRESS',
    },
    {
      key: 'P3-T2', project: 'PRJ-2026-003', parent: 'P3-PH1', title: 'SCADA screen design, alarm tags and recipe manager',
      hours: 60, start: 11, end: 28, skills: ['SCADA', 'PLC automation'], assignee: 'VS-0068', percent: 0, status: 'TODO',
      dependsOn: [{ on: 'P3-T1' }],
    },
    {
      key: 'P3-T3', project: 'PRJ-2026-003', parent: 'P3-PH1', title: 'VFD drive configuration and Profinet communication setup',
      hours: 32, start: 8, end: 22, skills: ['drives commissioning'], assignee: 'VS-0069', percent: 0, status: 'TODO',
      dependsOn: [{ on: 'P3-T1', type: 'START_TO_START', lag: 8 }],
    },
  ];

  const taskId = new Map<string, string>();
  for (const seed of taskSeeds) {
    const pid = projectId.get(seed.project)!;
    const task = await prisma.task.upsert({
      where: { projectId_taskNumber: { projectId: pid, taskNumber: seed.key } },
      create: {
        projectId: pid,
        taskNumber: seed.key,
        title: seed.title,
        type: seed.type ?? 'PROJECT',
        estimatedHours: seed.hours,
        plannedStartDate: day(seed.start),
        plannedEndDate: day(seed.end),
        priority: seed.priority ?? 'MEDIUM',
        status: seed.status ?? 'TODO',
        percentComplete: seed.percent ?? 0,
        requiredSkills: seed.skills ?? [],
        createdById: userId.get('VS-0061') || userId.get('VS-0001')!,
      },
      update: {
        title: seed.title,
        estimatedHours: seed.hours,
        percentComplete: seed.percent ?? 0,
        status: seed.status ?? 'TODO',
      },
    });
    taskId.set(seed.key, task.id);
  }

  // Set parent pointers
  for (const seed of taskSeeds) {
    if (!seed.parent) continue;
    await prisma.task.update({
      where: { id: taskId.get(seed.key)! },
      data: { parentId: taskId.get(seed.parent)! },
    });
  }

  // Set task assignments
  for (const seed of taskSeeds) {
    if (!seed.assignee) continue;
    const uid = userId.get(seed.assignee)!;
    const tid = taskId.get(seed.key)!;
    const pid = projectId.get(seed.project)!;

    await prisma.projectMember.upsert({
      where: { projectId_userId: { projectId: pid, userId: uid } },
      create: { projectId: pid, userId: uid, role: 'CONTRIBUTOR' },
      update: {},
    });

    await prisma.taskAssignment.upsert({
      where: { taskId_userId: { taskId: tid, userId: uid } },
      create: { taskId: tid, userId: uid, allocatedHours: seed.hours, status: 'ACTIVE' },
      update: { allocatedHours: seed.hours },
    });
  }

  // Set dependencies
  for (const seed of taskSeeds) {
    if (!seed.dependsOn) continue;
    const tid = taskId.get(seed.key)!;
    for (const dep of seed.dependsOn) {
      const predId = taskId.get(dep.on)!;
      await prisma.taskDependency.upsert({
        where: { predecessorId_successorId: { predecessorId: predId, successorId: tid } },
        create: { predecessorId: predId, successorId: tid, type: dep.type ?? 'FINISH_TO_START', lagDays: dep.lag ?? 0 },
        update: {},
      });
    }
  }

  // Progress logs
  const completedSeeds = taskSeeds.filter((t) => (t.percent ?? 0) > 0);
  for (const t of completedSeeds) {
    const tid = taskId.get(t.key)!;
    const uid = userId.get(t.assignee!)!;
    const already = await prisma.taskProgressLog.findFirst({ where: { taskId: tid } });
    if (!already) {
      await prisma.taskProgressLog.create({
        data: {
          taskId: tid,
          userId: uid,
          percentComplete: t.percent!,
          hoursSpent: Math.round(t.hours * ((t.percent ?? 100) / 100)),
          note: t.percent === 100 ? 'Work completed and verified against panel specifications.' : 'In progress, scheduled deliverables on track.',
          loggedFor: day(-2),
        },
      });
    }
  }

  // Handover seed
  const handoverTask = taskId.get('P1-T6');
  if (handoverTask) {
    const from = userId.get('VS-0032')!; // Darshan Upendrabhai Prajapati
    const to = userId.get('VS-0030')!;   // Aniq Istiyak Farooqui
    const already = await prisma.taskHandover.findFirst({ where: { taskId: handoverTask, status: 'PENDING' } });
    if (!already) {
      await prisma.taskHandover.create({
        data: {
          taskId: handoverTask,
          fromUserId: from,
          toUserId: to,
          reason: 'Site visit for Tata Chemicals plant survey - handing over enclosure revision.',
          remainingPercent: 30,
          remainingHours: 19.2,
        },
      });
    }
  }

  // Leaves
  const leaveSeeds = [
    { user: 'VS-0028', from: 3, to: 5, reason: 'Family function' },
    { user: 'VS-0058', from: 1, to: 2, reason: 'Certification exam' },
  ];
  for (const seed of leaveSeeds) {
    const uid = userId.get(seed.user)!;
    const already = await prisma.leave.findFirst({ where: { userId: uid, startDate: day(seed.from) } });
    if (already) continue;
    await prisma.leave.create({
      data: { userId: uid, startDate: day(seed.from), endDate: day(seed.to), reason: seed.reason, status: 'APPROVED' },
    });
  }

  console.log(`Successfully seeded ${people.length} people across ${departmentTree.length} departments!`);
  console.log(`3 live switchgear projects seeded with full WBS, dependencies, assignments and handovers.`);
  console.log(`Primary Super Admin: admin@vidyutswitchgear.com / <SEED_PASSWORD>`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
