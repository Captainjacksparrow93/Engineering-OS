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
      create: { key, module: key.split('.')[0]!, description: PERMISSIONS[key] },
      update: { description: PERMISSIONS[key] },
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
      roles: [{ key: 'DEPARTMENT_HEAD', scopeType: 'DEPARTMENT', scope: 'SALES' }],
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
      manager: 'ACS-0002',
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
      manager: 'ACS-0061',
      skills: ['site commissioning', 'client service', 'AMC support'],
      roles: [{ key: 'TECHNICAL_HEAD', scopeType: 'DEPARTMENT', scope: 'TECH' }],
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
      roles: [{ key: 'PM_BASE', scopeType: 'GLOBAL' }],
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
      manager: 'ACS-0063',
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
      manager: 'ACS-0063',
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
      manager: 'ACS-0063',
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
      manager: 'ACS-0063',
      skills: ['project coordination', 'vendor follow up', 'scheduling'],
      roles: [{ key: 'PM_BASE', scopeType: 'GLOBAL' }],
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
      manager: 'ACS-0071',
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
      manager: 'ACS-0071',
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
      roles: [{ key: 'PM_BASE', scopeType: 'GLOBAL' }],
    },
    {
      code: 'ACS-0075',
      name: 'Munaf Anavarbhai Multani',
      email: 'munaf.multani@acsengitech.com',
      designation: 'Asst. Manager',
      grade: 'SENIOR_ENGINEER',
      dept: 'TECH',
      manager: 'ACS-0074',
      skills: ['site management', 'resource planning'],
      roles: [{ key: 'PM_BASE', scopeType: 'GLOBAL' }],
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
      manager: 'ACS-0074',
      skills: ['protection coordination', 'breaker selection'],
      roles: [{ key: 'SENIOR_ENGINEER', scopeType: 'GLOBAL' }],
    },
    {
      code: 'ACS-0080',
      name: 'Harmitsinh Udavat',
      email: 'harmitsinh.udavat@acsengitech.com',
      designation: 'Jr. Engineer',
      grade: 'JUNIOR_ENGINEER',
      dept: 'TECH',
      manager: 'ACS-0078',
      skills: ['drawing assistance', 'site punch list'],
      roles: [{ key: 'JUNIOR_ENGINEER', scopeType: 'GLOBAL' }],
    },
    {
      code: 'ACS-0081',
      name: 'Krupesh Bhikhbhai Solanki',
      email: 'krupesh.solanki@acsengitech.com',
      designation: 'Sr. Engineer',
      grade: 'SENIOR_ENGINEER',
      dept: 'TECH',
      manager: 'ACS-0074',
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
      manager: 'ACS-0081',
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
      manager: 'ACS-0081',
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
  if (departmentId.get('TECH') && userId.get('ACS-0061')) {
    await prisma.department.update({ where: { id: departmentId.get('TECH')! }, data: { headId: userId.get('ACS-0061') } });
  }
  if (departmentId.get('DESIGN') && userId.get('ACS-0028')) {
    await prisma.department.update({ where: { id: departmentId.get('DESIGN')! }, data: { headId: userId.get('ACS-0028') } });
  }
  if (departmentId.get('PROD') && userId.get('ACS-0035')) {
    await prisma.department.update({ where: { id: departmentId.get('PROD')! }, data: { headId: userId.get('ACS-0035') } });
  }
  if (departmentId.get('QC') && userId.get('ACS-0057')) {
    await prisma.department.update({ where: { id: departmentId.get('QC')! }, data: { headId: userId.get('ACS-0057') } });
  }
  if (departmentId.get('SALES') && userId.get('ACS-0010')) {
    await prisma.department.update({ where: { id: departmentId.get('SALES')! }, data: { headId: userId.get('ACS-0010') } });
  }
  if (departmentId.get('PUR') && userId.get('ACS-0007')) {
    await prisma.department.update({ where: { id: departmentId.get('PUR')! }, data: { headId: userId.get('ACS-0007') } });
  }
  if (departmentId.get('ACC') && userId.get('ACS-0021')) {
    await prisma.department.update({ where: { id: departmentId.get('ACC')! }, data: { headId: userId.get('ACS-0021') } });
  }
  if (departmentId.get('STORES') && userId.get('ACS-0024')) {
    await prisma.department.update({ where: { id: departmentId.get('STORES')! }, data: { headId: userId.get('ACS-0024') } });
  }

  // Reconcile role assignments cleanly
  const seededUserIds = Array.from(userId.values());
  await prisma.roleAssignment.deleteMany({
    where: {
      userId: { in: seededUserIds },
      scopeType: { not: 'PROJECT' },
    },
  });

  // Clean up any stale PROJECT-scoped PROJECT_MANAGER grants whose project's managerId isn't that user
  const allExistingProjects = await prisma.project.findMany({ select: { id: true, managerId: true } });
  const validProjectManagers = new Set(allExistingProjects.map((p) => `${p.id}:${p.managerId}`));
  const projectRoleAssignments = await prisma.roleAssignment.findMany({
    where: { scopeType: 'PROJECT' },
    select: { id: true, scopeId: true, userId: true },
  });
  for (const ra of projectRoleAssignments) {
    if (!ra.scopeId || !validProjectManagers.has(`${ra.scopeId}:${ra.userId}`)) {
      await prisma.roleAssignment.delete({ where: { id: ra.id } });
    }
  }

  for (const person of people) {
    const uid = userId.get(person.code);
    if (!uid) continue;
    for (const grant of person.roles) {
      const rid = roleId.get(grant.key);
      if (!rid) continue;
      const scopeId = grant.scope ? departmentId.get(grant.scope) ?? null : null;
      await prisma.roleAssignment.create({
        data: { userId: uid, roleId: rid, scopeType: grant.scopeType, scopeId },
      });
    }
  }

  // ------------------------------------------------------------------- projects
  const projectSeeds = [
    {
      code: 'PRJ-2026-001',
      name: 'Tata Chemicals - PLC Automation',
      clientName: 'Tata Chemicals Ltd',
      poNumber: 'TCL/PO/2026/0781',
      orderValue: 12_400_000,
      panelType: 'PLC Programming & Simulation',
      panelCount: 14,
      priority: 'HIGH' as const,
      status: 'IN_PROGRESS' as const,
      startDate: day(-20),
      targetEndDate: day(40),
      manager: 'ACS-0063', // Parth Dasharathbhai Nagar
      sponsor: 'ACS-0002', // Satishkumar Mohanbhai Nagar
      department: 'TECH',
    },
    {
      code: 'PRJ-2026-002',
      name: 'Sunrise Cement - SCADA Automation',
      clientName: 'Sunrise Cement Industries',
      poNumber: 'SCI/PO/26/114',
      orderValue: 5_600_000,
      panelType: 'SCADA Programming & Simulation',
      panelCount: 6,
      priority: 'MEDIUM' as const,
      status: 'IN_PROGRESS' as const,
      startDate: day(-12),
      targetEndDate: day(45),
      manager: 'ACS-0074', // Paras Rajendrakumar Prajapati
      sponsor: 'ACS-0003', // Bhavesh Ishwarbhai Prajapati
      department: 'TECH',
    },
    {
      code: 'PRJ-2026-003',
      name: 'Godrej Foods - HMI Automation',
      clientName: 'Godrej Foods Pvt Ltd',
      poNumber: 'GF/PO/2026/0034',
      orderValue: 8_900_000,
      panelType: 'HMI Programming & Simulation',
      panelCount: 9,
      priority: 'CRITICAL' as const,
      status: 'IN_PROGRESS' as const,
      startDate: day(-6),
      targetEndDate: day(50),
      manager: 'ACS-0063', // Parth Dasharathbhai Nagar
      sponsor: 'ACS-0004', // Shaktikumar Vasava
      department: 'TECH',
    },
  ];

  // Purge any old mock/test projects not in the standard set
  const standardCodes = projectSeeds.map((p) => p.code);
  const oldProjects = await prisma.project.findMany({
    where: { code: { notIn: standardCodes } },
    select: { id: true },
  });
  if (oldProjects.length > 0) {
    const oldIds = oldProjects.map((p) => p.id);
    await prisma.taskProgressLog.deleteMany({ where: { task: { projectId: { in: oldIds } } } });
    await prisma.taskHandover.deleteMany({ where: { task: { projectId: { in: oldIds } } } });
    await prisma.projectHandover.deleteMany({ where: { projectId: { in: oldIds } } });
    await prisma.taskAssignment.deleteMany({ where: { task: { projectId: { in: oldIds } } } });
    await prisma.taskDependency.deleteMany({
      where: {
        OR: [
          { predecessor: { projectId: { in: oldIds } } },
          { successor: { projectId: { in: oldIds } } },
        ],
      },
    });
    await prisma.task.deleteMany({ where: { projectId: { in: oldIds } } });
    await prisma.projectMember.deleteMany({ where: { projectId: { in: oldIds } } });
    await prisma.roleAssignment.deleteMany({ where: { scopeType: 'PROJECT', scopeId: { in: oldIds } } });
    await prisma.project.deleteMany({ where: { id: { in: oldIds } } });
  }

  // Also clean up tasks, dependencies, assignments, logs for standard projects to refresh to exact 13 steps
  const existingStandardProjects = await prisma.project.findMany({
    where: { code: { in: standardCodes } },
    select: { id: true },
  });
  if (existingStandardProjects.length > 0) {
    const stdIds = existingStandardProjects.map((p) => p.id);
    await prisma.taskProgressLog.deleteMany({ where: { task: { projectId: { in: stdIds } } } });
    await prisma.taskHandover.deleteMany({ where: { task: { projectId: { in: stdIds } } } });
    await prisma.projectHandover.deleteMany({ where: { projectId: { in: stdIds } } });
    await prisma.taskAssignment.deleteMany({ where: { task: { projectId: { in: stdIds } } } });
    await prisma.taskDependency.deleteMany({
      where: {
        OR: [
          { predecessor: { projectId: { in: stdIds } } },
          { successor: { projectId: { in: stdIds } } },
        ],
      },
    });
    await prisma.task.deleteMany({ where: { projectId: { in: stdIds } } });
    await prisma.projectMember.deleteMany({ where: { projectId: { in: stdIds } } });
  }

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
    hours: number;
    start: number;
    end: number;
    skills?: string[];
    assignee?: string;
    percent?: number;
    status?: 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'COMPLETED' | 'BLOCKED';
    dependsOn?: Array<{ on: string; type?: 'FINISH_TO_START' | 'START_TO_START' | 'FINISH_TO_FINISH'; lag?: number }>;
  }

  const taskSeeds: TaskSeed[] = [
    // =========================================================================
    // PRJ-2026-001: Tata Chemicals — PLC Automation (13 standard checklist steps)
    // PM: Parth Dasharathbhai Nagar (ACS-0063)
    // =========================================================================
    {
      key: 'PRJ-001-T01', project: 'PRJ-2026-001',
      title: 'Review Control Philosophy / Functional Requirements',
      hours: 16, start: -20, end: -16, skills: ['PLC automation', 'control philosophy'],
      assignee: 'ACS-0064', percent: 100, status: 'COMPLETED',
    },
    {
      key: 'PRJ-001-T02', project: 'PRJ-2026-001',
      title: 'Verify I/O List and Tag List as per Approved Documents',
      hours: 16, start: -16, end: -12, skills: ['I/O list', 'tag list'],
      assignee: 'ACS-0065', percent: 100, status: 'COMPLETED',
      dependsOn: [{ on: 'PRJ-001-T01' }],
    },
    {
      key: 'PRJ-001-T03', project: 'PRJ-2026-001',
      title: 'Verify PLC Hardware Configuration as per Electrical Dwg',
      hours: 8, start: -12, end: -9, skills: ['hardware configuration'],
      assignee: 'ACS-0066', percent: 100, status: 'COMPLETED',
      dependsOn: [{ on: 'PRJ-001-T02' }],
    },
    {
      key: 'PRJ-001-T04', project: 'PRJ-2026-001',
      title: 'Verify PLC CPU, Comm Modules & Network Configuration',
      hours: 8, start: -9, end: -6, skills: ['CPU config', 'Profinet'],
      assignee: 'ACS-0068', percent: 100, status: 'COMPLETED',
      dependsOn: [{ on: 'PRJ-001-T03' }],
    },
    {
      key: 'PRJ-001-T05', project: 'PRJ-2026-001',
      title: 'DI Mapping',
      hours: 16, start: -6, end: -3, skills: ['DI mapping', 'logic programming'],
      assignee: 'ACS-0067', percent: 100, status: 'COMPLETED',
      dependsOn: [{ on: 'PRJ-001-T04' }],
    },
    {
      key: 'PRJ-001-T06', project: 'PRJ-2026-001',
      title: 'DQ Mapping',
      hours: 16, start: -3, end: 3, skills: ['DQ mapping', 'logic programming'],
      assignee: 'ACS-0069', percent: 60, status: 'IN_PROGRESS',
      dependsOn: [{ on: 'PRJ-001-T05' }],
    },
    {
      key: 'PRJ-001-T07', project: 'PRJ-2026-001',
      title: 'Analog Input Scaling, Engineering Units & Range Settings',
      hours: 16, start: 3, end: 8, skills: ['analog scaling', 'sensor scaling'],
      assignee: 'ACS-0071', percent: 0, status: 'TODO',
      dependsOn: [{ on: 'PRJ-001-T06' }],
    },
    {
      key: 'PRJ-001-T08', project: 'PRJ-2026-001',
      title: 'Analog Output / PID Control Logic',
      hours: 24, start: 8, end: 14, skills: ['PID control', 'loop tuning'],
      assignee: 'ACS-0072', percent: 0, status: 'TODO',
      dependsOn: [{ on: 'PRJ-001-T07' }],
    },
    {
      key: 'PRJ-001-T09', project: 'PRJ-2026-001',
      title: 'Motor Control Logic, Faceplate, Alarms & Animation',
      hours: 24, start: 14, end: 20, skills: ['motor control', 'alarms logic'],
      assignee: 'ACS-0064', percent: 0, status: 'TODO',
      dependsOn: [{ on: 'PRJ-001-T08' }],
    },
    {
      key: 'PRJ-001-T10', project: 'PRJ-2026-001',
      title: 'Valve Control Logic, Faceplate, Alarms & Animation',
      hours: 16, start: 20, end: 25, skills: ['valve control', 'interlocks'],
      assignee: 'ACS-0068', percent: 0, status: 'TODO',
      dependsOn: [{ on: 'PRJ-001-T09' }],
    },
    {
      key: 'PRJ-001-T11', project: 'PRJ-2026-001',
      title: 'Auto Sequence Complete',
      hours: 32, start: 25, end: 31, skills: ['auto sequence', 'interlocking logic'],
      assignee: 'ACS-0069', percent: 0, status: 'TODO',
      dependsOn: [{ on: 'PRJ-001-T10' }],
    },
    {
      key: 'PRJ-001-T12', project: 'PRJ-2026-001',
      title: 'Simulation Trial of Manual Function',
      hours: 16, start: 31, end: 35, skills: ['simulation', 'manual testing'],
      assignee: 'ACS-0067', percent: 0, status: 'TODO',
      dependsOn: [{ on: 'PRJ-001-T11' }],
    },
    {
      key: 'PRJ-001-T13', project: 'PRJ-2026-001',
      title: 'Simulation with Auto sequence trial and SCADA/HMI',
      hours: 24, start: 35, end: 40, skills: ['full simulation', 'FAT signoff'],
      assignee: 'ACS-0064', percent: 0, status: 'TODO',
      dependsOn: [{ on: 'PRJ-001-T12' }],
    },

    // =========================================================================
    // PRJ-2026-002: Sunrise Cement — SCADA Automation (13 standard checklist steps)
    // PM: Paras Rajendrakumar Prajapati (ACS-0074)
    // =========================================================================
    {
      key: 'PRJ-002-T01', project: 'PRJ-2026-002',
      title: 'Review P&ID and requirement',
      hours: 16, start: -12, end: -9, skills: ['SCADA', 'P&ID review'],
      assignee: 'ACS-0076', percent: 100, status: 'COMPLETED',
    },
    {
      key: 'PRJ-002-T02', project: 'PRJ-2026-002',
      title: 'Diagnostic Screen of DI',
      hours: 8, start: -9, end: -6, skills: ['SCADA graphics', 'diagnostic screens'],
      assignee: 'ACS-0077', percent: 100, status: 'COMPLETED',
      dependsOn: [{ on: 'PRJ-002-T01' }],
    },
    {
      key: 'PRJ-002-T03', project: 'PRJ-2026-002',
      title: 'Diagnostic Screen of DQ',
      hours: 8, start: -6, end: -3, skills: ['SCADA graphics', 'diagnostic screens'],
      assignee: 'ACS-0078', percent: 100, status: 'COMPLETED',
      dependsOn: [{ on: 'PRJ-002-T02' }],
    },
    {
      key: 'PRJ-002-T04', project: 'PRJ-2026-002',
      title: 'Diagnostic Screen of AI',
      hours: 8, start: -3, end: 3, skills: ['analog diagnostics', 'SCADA screens'],
      assignee: 'ACS-0079', percent: 50, status: 'IN_PROGRESS',
      dependsOn: [{ on: 'PRJ-002-T03' }],
    },
    {
      key: 'PRJ-002-T05', project: 'PRJ-2026-002',
      title: 'Diagnostic Screen of AQ',
      hours: 8, start: 3, end: 8, skills: ['SCADA screens'],
      assignee: 'ACS-0080', percent: 0, status: 'TODO',
      dependsOn: [{ on: 'PRJ-002-T04' }],
    },
    {
      key: 'PRJ-002-T06', project: 'PRJ-2026-002',
      title: 'Scaling Screen of Analog parameter',
      hours: 16, start: 8, end: 13, skills: ['parameter scaling', 'SCADA'],
      assignee: 'ACS-0081', percent: 0, status: 'TODO',
      dependsOn: [{ on: 'PRJ-002-T05' }],
    },
    {
      key: 'PRJ-002-T07', project: 'PRJ-2026-002',
      title: 'Faceplate Development',
      hours: 24, start: 13, end: 19, skills: ['faceplates', 'custom popups'],
      assignee: 'ACS-0076', percent: 0, status: 'TODO',
      dependsOn: [{ on: 'PRJ-002-T06' }],
    },
    {
      key: 'PRJ-002-T08', project: 'PRJ-2026-002',
      title: 'Alarm + History development',
      hours: 16, start: 19, end: 24, skills: ['alarm logging', 'historian'],
      assignee: 'ACS-0077', percent: 0, status: 'TODO',
      dependsOn: [{ on: 'PRJ-002-T07' }],
    },
    {
      key: 'PRJ-002-T09', project: 'PRJ-2026-002',
      title: 'Trend development',
      hours: 16, start: 24, end: 29, skills: ['real-time trends', 'historical trends'],
      assignee: 'ACS-0078', percent: 0, status: 'TODO',
      dependsOn: [{ on: 'PRJ-002-T08' }],
    },
    {
      key: 'PRJ-002-T10', project: 'PRJ-2026-002',
      title: 'P&ID Developed without tag',
      hours: 24, start: 29, end: 34, skills: ['mimic graphics', 'P&ID drawing'],
      assignee: 'ACS-0080', percent: 0, status: 'TODO',
      dependsOn: [{ on: 'PRJ-002-T09' }],
    },
    {
      key: 'PRJ-002-T11', project: 'PRJ-2026-002',
      title: 'P&ID developed with Tag Complete',
      hours: 24, start: 34, end: 39, skills: ['tag animation', 'PLC tag linking'],
      assignee: 'ACS-0079', percent: 0, status: 'TODO',
      dependsOn: [{ on: 'PRJ-002-T10' }],
    },
    {
      key: 'PRJ-002-T12', project: 'PRJ-2026-002',
      title: 'Communication Architect',
      hours: 16, start: 39, end: 42, skills: ['OPC UA', 'industrial networks'],
      assignee: 'ACS-0081', percent: 0, status: 'TODO',
      dependsOn: [{ on: 'PRJ-002-T11' }],
    },
    {
      key: 'PRJ-002-T13', project: 'PRJ-2026-002',
      title: 'Simulation Trial',
      hours: 24, start: 42, end: 45, skills: ['SCADA simulation', 'FAT signoff'],
      assignee: 'ACS-0076', percent: 0, status: 'TODO',
      dependsOn: [{ on: 'PRJ-002-T12' }],
    },

    // =========================================================================
    // PRJ-2026-003: Godrej Foods — HMI Automation (13 standard checklist steps)
    // PM: Parth Dasharathbhai Nagar (ACS-0063)
    // =========================================================================
    {
      key: 'PRJ-003-T01', project: 'PRJ-2026-003',
      title: 'Review P&ID and HMI screen requirements',
      hours: 16, start: -6, end: -2, skills: ['HMI screens', 'P&ID review'],
      assignee: 'ACS-0070', percent: 100, status: 'COMPLETED',
    },
    {
      key: 'PRJ-003-T02', project: 'PRJ-2026-003',
      title: 'Diagnostic Screen of DI',
      hours: 8, start: -2, end: 3, skills: ['HMI graphics', 'diagnostics'],
      assignee: 'ACS-0065', percent: 40, status: 'IN_PROGRESS',
      dependsOn: [{ on: 'PRJ-003-T01' }],
    },
    {
      key: 'PRJ-003-T03', project: 'PRJ-2026-003',
      title: 'Diagnostic Screen of DQ',
      hours: 8, start: 3, end: 7, skills: ['HMI graphics', 'diagnostics'],
      assignee: 'ACS-0066', percent: 0, status: 'TODO',
      dependsOn: [{ on: 'PRJ-003-T02' }],
    },
    {
      key: 'PRJ-003-T04', project: 'PRJ-2026-003',
      title: 'Diagnostic Screen of AI',
      hours: 8, start: 7, end: 12, skills: ['analog diagnostics', 'HMI'],
      assignee: 'ACS-0067', percent: 0, status: 'TODO',
      dependsOn: [{ on: 'PRJ-003-T03' }],
    },
    {
      key: 'PRJ-003-T05', project: 'PRJ-2026-003',
      title: 'Diagnostic Screen of AQ',
      hours: 8, start: 12, end: 16, skills: ['HMI diagnostics'],
      assignee: 'ACS-0072', percent: 0, status: 'TODO',
      dependsOn: [{ on: 'PRJ-003-T04' }],
    },
    {
      key: 'PRJ-003-T06', project: 'PRJ-2026-003',
      title: 'Scaling Screen of Analog parameter',
      hours: 16, start: 16, end: 21, skills: ['analog scaling', 'HMI touch'],
      assignee: 'ACS-0073', percent: 0, status: 'TODO',
      dependsOn: [{ on: 'PRJ-003-T05' }],
    },
    {
      key: 'PRJ-003-T07', project: 'PRJ-2026-003',
      title: 'Faceplate Development',
      hours: 24, start: 21, end: 26, skills: ['faceplate templates', 'popups'],
      assignee: 'ACS-0068', percent: 0, status: 'TODO',
      dependsOn: [{ on: 'PRJ-003-T06' }],
    },
    {
      key: 'PRJ-003-T08', project: 'PRJ-2026-003',
      title: 'Alarm + History development',
      hours: 16, start: 26, end: 31, skills: ['alarm banners', 'history tables'],
      assignee: 'ACS-0069', percent: 0, status: 'TODO',
      dependsOn: [{ on: 'PRJ-003-T07' }],
    },
    {
      key: 'PRJ-003-T09', project: 'PRJ-2026-003',
      title: 'Trend development',
      hours: 16, start: 31, end: 36, skills: ['HMI trend displays'],
      assignee: 'ACS-0071', percent: 0, status: 'TODO',
      dependsOn: [{ on: 'PRJ-003-T08' }],
    },
    {
      key: 'PRJ-003-T10', project: 'PRJ-2026-003',
      title: 'Screen Navigation & Layouts',
      hours: 16, start: 36, end: 41, skills: ['navigation hierarchy', 'header/footer'],
      assignee: 'ACS-0070', percent: 0, status: 'TODO',
      dependsOn: [{ on: 'PRJ-003-T09' }],
    },
    {
      key: 'PRJ-003-T11', project: 'PRJ-2026-003',
      title: 'HMI Tag Linking with PLC DBs',
      hours: 24, start: 41, end: 45, skills: ['tag linking', 'PLC DB integration'],
      assignee: 'ACS-0064', percent: 0, status: 'TODO',
      dependsOn: [{ on: 'PRJ-003-T10' }],
    },
    {
      key: 'PRJ-003-T12', project: 'PRJ-2026-003',
      title: 'Communication Configuration & Drivers',
      hours: 8, start: 45, end: 48, skills: ['Ethernet IP', 'driver setup'],
      assignee: 'ACS-0068', percent: 0, status: 'TODO',
      dependsOn: [{ on: 'PRJ-003-T11' }],
    },
    {
      key: 'PRJ-003-T13', project: 'PRJ-2026-003',
      title: 'Simulation Trial',
      hours: 16, start: 48, end: 50, skills: ['HMI runtime simulation', 'FAT signoff'],
      assignee: 'ACS-0064', percent: 0, status: 'TODO',
      dependsOn: [{ on: 'PRJ-003-T12' }],
    },
  ];

  const taskId = new Map<string, string>();
  for (const seed of taskSeeds) {
    const pid = projectId.get(seed.project)!;
    const isCompleted = seed.status === 'COMPLETED';
    const isInProgress = seed.status === 'IN_PROGRESS';
    const taskAssigneeId = seed.assignee ? userId.get(seed.assignee) : undefined;

    const task = await prisma.task.upsert({
      where: { projectId_code: { projectId: pid, code: seed.key } },
      create: {
        projectId: pid,
        code: seed.key,
        title: seed.title,
        type: 'PROJECT',
        estimatedHours: seed.hours,
        plannedStart: day(seed.start),
        plannedEnd: day(seed.end),
        actualStart: isCompleted || isInProgress ? day(seed.start) : null,
        actualEnd: isCompleted ? day(seed.end) : null,
        submittedAt: isCompleted ? day(seed.end) : null,
        completedAt: isCompleted ? day(seed.end) : null,
        completedById: isCompleted ? (taskAssigneeId ?? userId.get('ACS-0063')!) : null,
        priority: 'MEDIUM',
        status: seed.status ?? 'TODO',
        percentComplete: seed.percent ?? 0,
        requiredSkills: seed.skills ?? [],
        createdById: userId.get('ACS-0061') || userId.get('ACS-0001')!,
      },
      update: {
        title: seed.title,
        estimatedHours: seed.hours,
        plannedStart: day(seed.start),
        plannedEnd: day(seed.end),
        actualStart: isCompleted || isInProgress ? day(seed.start) : null,
        actualEnd: isCompleted ? day(seed.end) : null,
        submittedAt: isCompleted ? day(seed.end) : null,
        completedAt: isCompleted ? day(seed.end) : null,
        completedById: isCompleted ? (taskAssigneeId ?? userId.get('ACS-0063')!) : null,
        percentComplete: seed.percent ?? 0,
        status: seed.status ?? 'TODO',
      },
    });
    taskId.set(seed.key, task.id);
  }

  // Set task assignments
  for (const seed of taskSeeds) {
    if (!seed.assignee) continue;
    const uid = userId.get(seed.assignee)!;
    const tid = taskId.get(seed.key)!;
    const pid = projectId.get(seed.project)!;

    await prisma.projectMember.upsert({
      where: { projectId_userId: { projectId: pid, userId: uid } },
      create: { projectId: pid, userId: uid, role: 'ENGINEER' },
      update: {},
    });

    const existingAssignment = await prisma.taskAssignment.findFirst({
      where: { taskId: tid, userId: uid },
    });
    if (!existingAssignment) {
      await prisma.taskAssignment.create({
        data: { taskId: tid, userId: uid, allocatedHours: seed.hours, status: 'ACTIVE' },
      });
    } else {
      await prisma.taskAssignment.update({
        where: { id: existingAssignment.id },
        data: { allocatedHours: seed.hours },
      });
    }
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
  const handoverTask = taskId.get('PRJ-001-T06');
  if (handoverTask) {
    const from = userId.get('ACS-0069')!; // Dixit Prajapati
    const to = userId.get('ACS-0067')!;   // Het Patel
    const already = await prisma.taskHandover.findFirst({ where: { taskId: handoverTask, status: 'PENDING' } });
    if (!already) {
      await prisma.taskHandover.create({
        data: {
          taskId: handoverTask,
          fromUserId: from,
          toUserId: to,
          reason: 'Site visit for Tata Chemicals plant survey - handing over DQ mapping completion.',
          remainingPercent: 40,
          remainingHours: 6.4,
        },
      });
    }
  }

  // Leaves
  const leaveSeeds = [
    { user: 'ACS-0065', from: 3, to: 5, reason: 'Family function' },
    { user: 'ACS-0078', from: 2, to: 4, reason: 'Certification exam' },
  ];
  for (const seed of leaveSeeds) {
    const uid = userId.get(seed.user);
    if (!uid) continue;
    const already = await prisma.leave.findFirst({ where: { userId: uid, startDate: day(seed.from) } });
    if (already) continue;
    await prisma.leave.create({
      data: { userId: uid, startDate: day(seed.from), endDate: day(seed.to), reason: seed.reason, status: 'APPROVED' },
    });
  }

  console.log(`Successfully seeded ${people.length} people across ${departmentTree.length} departments!`);
  console.log(`3 live automation projects seeded with 13 standard checklist tasks each, dependencies, assignments and handovers.`);
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
