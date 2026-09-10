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
  'pm.task.delete': 'Delete a task',
  'pm.task.assign': 'Assign or reassign a task to someone',
  'pm.task.adhoc.create': 'Raise an ad-hoc task outside the planned WBS',
  'pm.task.dependency.manage': 'Add or remove task dependencies',

  'pm.progress.log': 'Punch in progress on a task you hold',
  'pm.progress.review': 'Review, approve or reject reported progress',

  'pm.handover.request': 'Hand remaining work to a peer',
  'pm.handover.decide': 'Accept or reject a handover addressed to you',
  'pm.handover.override': 'Force a handover through on behalf of others',

  'pm.resource.read': 'See who is available and how loaded they are',
  'pm.report.read': 'Open portfolio dashboards and reports',
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as PermissionKey[];

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
      'pm.task.delete',
      'pm.task.assign',
      'pm.task.adhoc.create',
      'pm.task.dependency.manage',
      'pm.progress.review',
      'pm.handover.override',
      'pm.handover.decide',
      'pm.resource.read',
      'pm.report.read',
    ],
  },
  DEPARTMENT_HEAD: {
    name: 'Department Head',
    description: 'Runs a department: its projects, its people and its ad-hoc load.',
    permissions: [
      'admin.user.read',
      'pm.project.read',
      'pm.project.create',
      'pm.project.update',
      'pm.project.member.manage',
      'pm.task.read',
      'pm.task.create',
      'pm.task.update',
      'pm.task.assign',
      'pm.task.adhoc.create',
      'pm.task.dependency.manage',
      'pm.progress.review',
      'pm.handover.override',
      'pm.handover.decide',
      'pm.resource.read',
      'pm.report.read',
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
      'pm.task.create',
      'pm.task.update',
      'pm.task.delete',
      'pm.task.assign',
      'pm.task.adhoc.create',
      'pm.task.dependency.manage',
      'pm.progress.log',
      'pm.progress.review',
      'pm.handover.request',
      'pm.handover.decide',
      'pm.handover.override',
      'pm.resource.read',
      'pm.report.read',
    ],
  },
  SENIOR_ENGINEER: {
    name: 'Senior Engineer',
    description: 'Executes work, splits it across peers and mentors juniors.',
    permissions: [
      'pm.project.read',
      'pm.task.read',
      'pm.task.create',
      'pm.task.update',
      'pm.task.assign',
      'pm.task.dependency.manage',
      'pm.progress.log',
      'pm.handover.request',
      'pm.handover.decide',
      'pm.resource.read',
    ],
  },
  JUNIOR_ENGINEER: {
    name: 'Junior Engineer',
    description: 'Works an assigned queue and reports progress.',
    permissions: [
      'pm.project.read',
      'pm.task.read',
      'pm.progress.log',
      'pm.handover.request',
      'pm.handover.decide',
    ],
  },
  VIEWER: {
    name: 'Viewer',
    description: 'Read-only access, for auditors and cross-functional observers.',
    permissions: ['pm.project.read', 'pm.task.read', 'pm.report.read'],
  },
};
