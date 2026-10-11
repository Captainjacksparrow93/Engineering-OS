import type { AccessScope, Grant, Principal } from './types';
import { permissionModule, type PermissionKey } from './permissions';

/**
 * The authorisation decision.
 *
 * A grant matches when the permission matches AND the grant's scope contains the scope
 * of the attempted action:
 *
 *   GLOBAL      -> matches everything.
 *   DEPARTMENT  -> matches when the action happens in a department the principal covers
 *                  (subtree already expanded onto the principal).
 *   PROJECT     -> matches only that exact project.
 *
 * Deny is the default; there is no "admin bypass" branch anywhere else in the codebase.
 */
export function can(principal: Principal, permission: PermissionKey, scope: AccessScope = {}): boolean {
  return principal.grants.some((grant) => grant.permission === permission && scopeMatches(principal, grant, scope));
}

export function canAny(principal: Principal, permissions: PermissionKey[], scope: AccessScope = {}): boolean {
  return permissions.some((p) => can(principal, p, scope));
}

export function canAll(principal: Principal, permissions: PermissionKey[], scope: AccessScope = {}): boolean {
  return permissions.every((p) => can(principal, p, scope));
}

function scopeMatches(principal: Principal, grant: Grant, scope: AccessScope): boolean {
  switch (grant.scopeType) {
    case 'GLOBAL':
      return true;
    case 'DEPARTMENT': {
      const target = scope.departmentId;
      if (!target) return false;
      return principal.coveredDepartmentIds.includes(target);
    }
    case 'PROJECT': {
      const target = scope.projectId;
      if (!target) return false;
      return grant.scopeId === target;
    }
    default:
      return false;
  }
}

export function hasPermissionAnywhere(principal: Principal, permission: PermissionKey): boolean {
  return principal.grants.some((g) => g.permission === permission);
}

/** Where a person lands after sign-in: the dashboard, Sales for salespeople, the front desk for reception, else their own work. */
export function homePath(principal: Pick<Principal, 'grants'>): string {
  if (hasPermissionAnywhere(principal as Principal, 'pm.report.read')) return '/dashboard';
  if (hasPermissionAnywhere(principal as Principal, 'sales.deal.read')) return '/sales';
  if (hasPermissionAnywhere(principal as Principal, 'gate.desk')) return '/gate';
  return '/pm/my-work';
}

/** Permissions that only let someone look. A principal holding nothing else is read-only. */
const READ_ONLY_PERMISSIONS: ReadonlySet<PermissionKey> = new Set<PermissionKey>([
  'admin.user.read',
  'admin.role.read',
  'admin.audit.read',
  'pm.project.read',
  'pm.project.read.all',
  'pm.task.read',
  'pm.resource.read',
  'pm.report.read',
  'pm.commissioning.read',
  'pm.template.read',
  'erp.access',
]);

/** Modules whose grants do not count against read-only in Project Management. */
const NON_PM_MODULES: ReadonlySet<string> = new Set(['sales', 'gate']);

/**
 * True when every grant outside Sales and Gate is a pure read, e.g. the Sales Head: they run
 * Sales but cannot post or change anything in Project Management. Likewise the Receptionist.
 */
export function isReadOnly(principal: Principal): boolean {
  return principal.grants.every((g) => READ_ONLY_PERMISSIONS.has(g.permission) || NON_PM_MODULES.has(permissionModule(g.permission)));
}
