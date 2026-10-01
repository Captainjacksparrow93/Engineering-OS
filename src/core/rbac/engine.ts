import type { AccessScope, Grant, Principal } from './types';
import type { PermissionKey } from './permissions';

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

/** True when every grant is a pure read, e.g. the Sales Head. Such users cannot post or change anything. */
export function isReadOnly(principal: Principal): boolean {
  return principal.grants.every((g) => READ_ONLY_PERMISSIONS.has(g.permission));
}
