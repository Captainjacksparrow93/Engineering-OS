import type { PermissionKey } from '@/core/rbac/permissions';

/**
 * The module catalogue that drives the launcher and the sidebar.
 *
 * Everything except Project Management is `COMING_SOON`: the tile renders, the route
 * renders a roadmap page with a banner, and no half-built screens leak into production.
 * When a module ships, flip `status` and point `route` at its real entry page.
 */
export interface ModuleDefinition {
  key: string;
  name: string;
  description: string;
  icon: string;
  route: string;
  status: 'LIVE' | 'BETA' | 'COMING_SOON';
  plannedFor?: string;
  /** Rendered on the coming-soon page so stakeholders can see what is in scope. */
  scope: string[];
  /** Permission that must be held anywhere for the tile to appear. */
  requires?: PermissionKey;
  sortOrder: number;
}

export const MODULES: ModuleDefinition[] = [
  {
    key: 'pm',
    name: 'Project Management',
    description: 'Projects, WBS, dependencies, resource availability, handovers and progress.',
    icon: '📐',
    route: '/pm',
    status: 'LIVE',
    scope: [],
    requires: 'pm.project.read',
    sortOrder: 10,
  },
  {
    key: 'hrms',
    name: 'HRMS',
    description: 'Employee records, documents, policies, leave with approvals, holidays and biometric attendance; payslips next.',
    icon: '👥',
    route: '/hrms',
    status: 'LIVE',
    scope: [],
    // No `requires`: every employee opens their own profile here.
    sortOrder: 20,
  },
  {
    key: 'erp',
    name: 'ERP / Finance',
    description: 'Sales orders, purchase, inventory, BOM costing and invoicing.',
    icon: '📊',
    route: '/erp',
    status: 'LIVE',
    scope: [
      'Orders, customers and all ERPNext modules in ERPNext',
      'Projects originate from confirmed sales orders (plan 014)',
    ],
    requires: 'erp.access',
    sortOrder: 30,
  },
  {
    key: 'sales',
    name: 'Sales',
    description: 'Deals, follow-ups, BOMs at the latest price, one-click quotes and pricing advice.',
    icon: '💼',
    route: '/sales',
    status: 'LIVE',
    scope: [],
    requires: 'sales.deal.read',
    sortOrder: 25,
  },
  {
    key: 'production',
    name: 'Production Management',
    description: 'Shop-floor routing, panel assembly, wiring and testing stages.',
    icon: '🏭',
    route: '/production',
    status: 'COMING_SOON',
    plannedFor: 'Phase 3',
    scope: [
      'Engineering release from Project Management opens the production job card',
      'Stage-wise panel tracking: fabrication, busbar, wiring, testing, dispatch',
      'Machine and workstation capacity planning',
      'Quality checkpoints and non-conformance reports',
    ],
    sortOrder: 40,
  },
  {
    key: 'gate',
    name: 'Gate & Visitors',
    description: 'Front-desk visitor check-in and check-out, visits scheduled by staff, and arrival alerts.',
    icon: '🚧',
    route: '/gate',
    status: 'LIVE',
    scope: [],
    // No `requires`: every employee schedules their own visitors here.
    sortOrder: 50,
  },
  {
    key: 'qms',
    name: 'Quality & Documents',
    description: 'Drawing approvals, test reports, ISO documents and revision control.',
    icon: '📋',
    route: '/qms',
    status: 'COMING_SOON',
    plannedFor: 'Phase 4',
    scope: [
      'Drawing revisions attached to the engineering task that produced them',
      'Customer approval cycles that gate downstream production tasks',
      'Routine test reports generated per panel serial number',
    ],
    sortOrder: 60,
  },
  {
    key: 'maintenance',
    name: 'Maintenance',
    description: 'Preventive maintenance schedules for plant machinery and tooling.',
    icon: '🔧',
    route: '/maintenance',
    status: 'COMING_SOON',
    plannedFor: 'Phase 4',
    scope: [
      'Preventive maintenance jobs raised as tasks on the shared task engine',
      'Machine downtime feeds back into production capacity planning',
    ],
    sortOrder: 70,
  },
  {
    key: 'admin',
    name: 'Administration',
    description: 'People, roles, permissions, module control and the audit trail.',
    icon: '🛡️',
    route: '/admin',
    status: 'LIVE',
    scope: [],
    requires: 'admin.user.read',
    sortOrder: 90,
  },
];

export const getModule = (key: string) => MODULES.find((m) => m.key === key);
