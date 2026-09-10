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

/** Permissions this principal holds anywhere - used to decide what to render in the nav. */
export function permissionsAnywhere(principal: Principal): Set<PermissionKey> {
  return new Set(principal.grants.map((g) => g.permission));
}

export function hasPermissionAnywhere(principal: Principal, permission: PermissionKey): boolean {
  return principal.grants.some((g) => g.permission === permission);
}
