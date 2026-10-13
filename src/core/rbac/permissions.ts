/**
 * The permission catalogue.
 *
 * Application code checks PERMISSIONS, never role names. Adding a module means adding
 * a block here plus rows in `core_permissions` (the seed syncs the two), and the admin
 * UI can then compose roles out of them without a code change.
 *
 * Key format: `<module>.<resource>.<action>`.
 */

export const PERMISSIONS = {
  // -- Platform administration -------------------------------------------------
  'admin.user.read': 'View employee accounts',
  'admin.user.manage': 'Create, edit and deactivate employee accounts',
  'admin.user.password.reset': "Reset an employee's password",
  'admin.role.read': 'View roles and their permissions',
  'admin.role.manage': 'Create roles and grant/revoke permissions',
  'admin.role.assign': 'Assign roles to people at any scope',
  'admin.audit.read': 'Read the platform audit trail',
  'admin.module.manage': 'Enable or disable modules',

  // -- Project Management ------------------------------------------------------
  'pm.project.read': 'View projects in scope',
  'pm.project.read.all': 'View every project in the company',
  'pm.project.create': 'Define a new project',
  'pm.project.update': 'Edit project details and schedule',
  'pm.project.delete': 'Cancel or delete a project',
  'pm.project.member.manage': 'Add or remove project members',

  'pm.task.read': 'View tasks in scope',
  'pm.task.create': 'Create tasks inside a project',
  'pm.task.update': 'Edit any task in scope',
  'pm.task.cancel': 'Cancel or restore a task',
  'pm.task.delete': 'Delete a task',
  'pm.task.assign': 'Assign or reassign a task to someone',
  'pm.task.adhoc.create': 'Raise an ad-hoc task outside the planned WBS',
  'pm.task.dependency.manage': 'Add or remove task dependencies',

  'pm.progress.log': 'Punch in progress on a task you hold',
  'pm.progress.review': 'Review, approve or reject reported progress',

  'pm.template.read': 'View master checklist templates',
  'pm.template.manage': 'Create, edit and delete master checklist templates',

  'pm.handover.request': 'Hand remaining work to a peer',
  'pm.handover.decide': 'Accept or reject a handover addressed to you',

  'pm.commissioning.read': 'View site commissioning status and assigned engineers',
  'pm.commissioning.manage': 'Assign commissioning engineers and close commissioning',
  'pm.commissioning.log': 'Record daily commissioning logs',
  'pm.commissioning.approve': 'Approve or reject commissioning daily logs',

  'pm.oversight': 'Kept informed about all project activity in scope',
  'pm.resource.read': 'See who is available and how loaded they are',
  'pm.report.read': 'Open portfolio dashboards and reports',

  // -- ERP / Finance -----------------------------------------------------------
  'erp.access': 'Open ERP',
  'erp.stock.read': 'See items, warehouses, stock levels, stock entries and stock reports',
  'erp.stock.manage': 'Maintain items and warehouses; create and submit stock entries and reconciliations',
  'erp.buying.read': 'See suppliers, material requests, purchase orders, receipts and purchase invoices',
  'erp.buying.manage': 'Create and submit material requests, supplier quotations, purchase orders, receipts and purchase invoices',
  'erp.selling.read': 'See customers, sales orders, delivery notes and sales invoices',
  'erp.selling.manage': 'Create and submit sales orders, delivery notes and sales invoices',
  'erp.manufacturing.read': 'See BOMs, work orders, job cards and production plans',
  'erp.manufacturing.manage': 'Maintain BOMs and workstations; run work orders, job cards and production plans',
  'erp.quality.read': 'See quality inspections, non-conformances and controlled documents',
  'erp.quality.manage': 'Record inspections, raise and close non-conformances, release document revisions',
  'erp.assets.read': 'See the asset register, depreciation and maintenance schedules',
  'erp.assets.manage': 'Maintain assets, post depreciation, plan and log maintenance and breakdowns',
  'erp.accounts.read': 'See the books: ledgers, invoices, payments and financial reports',
  'erp.accounts.manage': 'Post journal entries and payments, reconcile banks, close periods',
  'erp.settings.manage': 'Change ERP settings and the chart of accounts',

  // -- Sales -------------------------------------------------------------------
  'sales.deal.read': 'Open Sales; see your own deals, accounts and the price catalogue',
  'sales.deal.read.all': "See every salesperson's deals and quotes",
  'sales.deal.manage': 'Create and edit deals, contacts, BOMs and quotes',
  'sales.account.manage': 'Edit client relationship factors (strategic, payment delay, customer since)',
  'sales.catalog.manage': 'Maintain items and prices; import price lists and past quotes',
  'sales.quote.approve': 'Approve quotes below the minimum margin',
  'sales.settings.manage': 'Set margins, GST, quote terms and price priority',

  // -- Gate & Visitors ---------------------------------------------------------
  // Any employee may schedule visits to themselves and answer arrival alerts: no key needed.
  'gate.desk': 'Run the front desk: schedule visits for anyone, log walk-ins, check visitors in and out',
  'gate.register.read': 'See the full visitor register and history',

  // -- HRMS ----------------------------------------------------------------------
  // Your own profile, documents and the company policies need no key.
  'hr.employee.read': 'See employee records in scope (a department-scoped grant sees that department)',
  'hr.employee.manage': 'Edit employee HR records, upload employee documents and company policies',
  'hr.sensitive.read': 'See bank account and ID numbers (PAN, Aadhaar, UAN, ESIC)',
  // Applying for leave and the reporting manager's approval need no key.
  'hr.leave.approve': 'Give the department-head approval on leave and attendance corrections (a department-scoped grant covers that department)',
  'hr.attendance.manage': 'Import biometric attendance; manage leave types, balances, holidays and shift timings',
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as PermissionKey[];

/** Every ERP key: Directors and the platform administrator hold all of them. */
export const ERP_PERMISSIONS = ALL_PERMISSIONS.filter((k) => k.startsWith('erp.'));

export function permissionModule(key: PermissionKey): string {
  return key.split('.')[0]!;
}

/**
 * Role blueprints shipped with the product.
 *
 * These describe the panel-manufacturing org: directors see everything, department
 * heads run their department's portfolio, project managers run one project, senior
 * engineers can pull peers in, junior engineers work their own queue.
 */
// Seeding is create-only: these lists are applied to a role only when it is first created.
// To grant an existing role a new permission, add a one-off script under prisma/scripts/.
export const SYSTEM_ROLES: Record<
  string,
  { name: string; description: string; permissions: PermissionKey[] }
> = {
  SUPER_ADMIN: {
    name: 'Platform Administrator',
    description: 'Full control over the platform, including roles and modules.',
    permissions: ALL_PERMISSIONS,
  },
  DIRECTOR: {
    name: 'Director',
    description: 'Company-wide visibility, defines projects and reassigns work anywhere.',
    permissions: [
      'admin.user.read',
      'admin.user.manage',
      'admin.user.password.reset',
      'admin.role.read',
      'admin.role.assign',
      'admin.audit.read',
      'pm.project.read',
      'pm.project.read.all',
      'pm.project.create',
      'pm.project.update',
      'pm.project.delete',
      'pm.project.member.manage',
      'pm.task.read',
      'pm.task.create',
      'pm.task.update',
      'pm.task.cancel',
      'pm.task.delete',
      'pm.task.assign',
      'pm.task.adhoc.create',
      'pm.task.dependency.manage',
      'pm.progress.log',
      'pm.progress.review',
      'pm.template.read',
      'pm.template.manage',
      'pm.commissioning.read',
      'pm.commissioning.manage',
      'pm.commissioning.approve',
      'pm.oversight',
      'pm.handover.request',
      'pm.handover.decide',
      'pm.resource.read',
      'pm.report.read',
      ...ERP_PERMISSIONS,
      'sales.deal.read',
      'sales.deal.read.all',
      'sales.deal.manage',
      'sales.account.manage',
      'sales.catalog.manage',
      'sales.quote.approve',
      'sales.settings.manage',
      'gate.register.read',
      'hr.employee.read',
      'hr.employee.manage',
      'hr.sensitive.read',
      'hr.leave.approve',
      'hr.attendance.manage',
    ],
  },
  TECHNICAL_HEAD: {
    name: 'Technical Department Head',
    description: 'Runs technical department: defines automation projects, checklists and oversight.',
    permissions: [
      'pm.project.read',
      'pm.project.create',
      'pm.project.update',
      'pm.project.member.manage',
      'pm.task.read',
      'pm.task.create',
      'pm.task.update',
      'pm.task.cancel',
      'pm.task.assign',
      'pm.task.adhoc.create',
      'pm.progress.review',
      'pm.template.read',
      'pm.template.manage',
      'pm.commissioning.read',
      'pm.commissioning.manage',
      'pm.commissioning.approve',
      'pm.oversight',
      'pm.handover.request',
      'pm.handover.decide',
      'pm.resource.read',
      'pm.report.read',
      'hr.employee.read',
      'hr.leave.approve',
    ],
  },
  SERVICE_HEAD: {
    name: 'Head of Service',
    description: 'Runs service department: defines automation projects, checklists, commissioning and service delivery.',
    permissions: [
      'pm.project.read',
      'pm.project.create',
      'pm.project.update',
      'pm.project.member.manage',
      'pm.task.read',
      'pm.task.create',
      'pm.task.update',
      'pm.task.cancel',
      'pm.task.assign',
      'pm.task.adhoc.create',
      'pm.progress.review',
      'pm.template.read',
      'pm.template.manage',
      'pm.commissioning.read',
      'pm.commissioning.manage',
      'pm.commissioning.approve',
      'pm.oversight',
      'pm.handover.request',
      'pm.handover.decide',
      'pm.resource.read',
      'pm.report.read',
      'hr.employee.read',
      'hr.leave.approve',
    ],
  },
  DEPARTMENT_HEAD: {
    name: 'Department Head',
    description: 'Runs a non-technical department: its people and accounts.',
    permissions: [
      'admin.user.read',
      'hr.employee.read',
      'hr.leave.approve',
    ],
  },
  PROJECT_MANAGER: {
    name: 'Project Manager',
    description: 'Owns delivery of the projects this role is granted on.',
    permissions: [
      'pm.project.read',
      'pm.project.update',
      'pm.project.member.manage',
      'pm.task.read',
      'pm.task.update',
      'pm.task.assign',
      'pm.progress.review',
      'pm.handover.request',
      'pm.handover.decide',
      'pm.resource.read',
      'pm.report.read',
    ],
  },
  ASST_MANAGER: {
    name: 'Assistant Manager',
    description: 'Assists in running and delivering automation projects.',
    permissions: [
      'pm.project.read',
      'pm.project.update',
      'pm.project.member.manage',
      'pm.task.read',
      'pm.task.update',
      'pm.task.assign',
      'pm.progress.review',
      'pm.handover.request',
      'pm.handover.decide',
      'pm.resource.read',
      'pm.report.read',
    ],
  },
  PM_BASE: {
    name: 'Eligible Project Manager',
    description: 'Base role for employees eligible to be assigned projects.',
    permissions: [
      'pm.resource.read',
      'pm.report.read',
      'pm.handover.decide',
    ],
  },
  SENIOR_ENGINEER: {
    name: 'Senior Engineer',
    description: 'Executes work, splits it across peers and mentors juniors.',
    permissions: [
      'pm.handover.request',
      'pm.handover.decide',
      'pm.commissioning.log',
    ],
  },
  JUNIOR_ENGINEER: {
    name: 'Junior Engineer',
    description: 'Works an assigned queue and reports progress.',
    permissions: [
      'pm.handover.request',
      'pm.handover.decide',
      'pm.commissioning.log',
    ],
  },
  VIEWER: {
    name: 'Viewer',
    description: 'Read-only access, for auditors and cross-functional observers.',
    permissions: ['pm.project.read', 'pm.task.read', 'pm.report.read'],
  },
  SALES_EXECUTIVE: {
    name: 'Sales Executive',
    description: 'Runs their own deals and quotes in Sales.',
    permissions: ['sales.deal.read', 'sales.deal.manage'],
  },
  RECEPTIONIST: {
    name: 'Receptionist',
    description: 'Runs the front desk: visitor check-in and check-out, walk-ins and the visitor register.',
    permissions: ['gate.desk', 'gate.register.read'],
  },
  HR_MANAGER: {
    name: 'HR Manager',
    description: 'Runs HR: every employee record, documents and policies; adds and deactivates accounts.',
    permissions: ['admin.user.read', 'admin.user.manage', 'hr.employee.read', 'hr.employee.manage', 'hr.sensitive.read', 'hr.leave.approve', 'hr.attendance.manage'],
  },
  SALES_HEAD: {
    name: 'Sales Head',
    description: 'Runs Sales; read-only across all company projects, tasks, resources and reports.',
    permissions: [
      'pm.project.read',
      'pm.project.read.all',
      'pm.task.read',
      'pm.resource.read',
      'pm.report.read',
      'pm.commissioning.read',
      'pm.template.read',
      'erp.access',
      'erp.selling.read',
      'erp.selling.manage',
      'erp.stock.read',
      'sales.deal.read',
      'sales.deal.read.all',
      'sales.deal.manage',
      'sales.account.manage',
      'sales.catalog.manage',
    ],
  },
  PURCHASE_MANAGER: {
    name: 'Purchase Manager',
    description: 'Runs buying: suppliers, material requests, quotations, purchase orders and receipts.',
    permissions: ['erp.access', 'erp.buying.read', 'erp.buying.manage', 'erp.stock.read', 'erp.quality.read'],
  },
  STORE_KEEPER: {
    name: 'Store Keeper',
    description: 'Runs the stores: items, receipts, issues, transfers and stock counts.',
    permissions: ['erp.access', 'erp.stock.read', 'erp.stock.manage', 'erp.buying.read', 'erp.quality.read'],
  },
  ACCOUNTS_MANAGER: {
    name: 'Accounts Manager',
    description: 'Runs the books: invoices, payments, journals, bank reconciliation and financial reports.',
    permissions: ['erp.access', 'erp.accounts.read', 'erp.accounts.manage', 'erp.buying.read', 'erp.selling.read', 'erp.stock.read', 'erp.assets.read'],
  },
  PRODUCTION_MANAGER: {
    name: 'Production Manager',
    description: 'Runs production: BOMs, work orders, job cards and production plans.',
    permissions: ['erp.access', 'erp.manufacturing.read', 'erp.manufacturing.manage', 'erp.stock.read', 'erp.buying.read', 'erp.quality.read'],
  },
  QUALITY_MANAGER: {
    name: 'Quality Manager',
    description: 'Runs quality: inspections, non-conformances and controlled documents.',
    permissions: ['erp.access', 'erp.quality.read', 'erp.quality.manage', 'erp.stock.read', 'erp.manufacturing.read', 'erp.buying.read'],
  },
  MAINTENANCE_MANAGER: {
    name: 'Maintenance Manager',
    description: 'Runs plant maintenance: the asset register, preventive schedules and breakdowns.',
    permissions: ['erp.access', 'erp.assets.read', 'erp.assets.manage', 'erp.stock.read'],
  },
};
