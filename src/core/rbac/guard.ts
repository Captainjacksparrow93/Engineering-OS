import { can } from './engine';
import { ForbiddenError } from './errors';
import type { PermissionKey } from './permissions';
import type { AccessScope, Principal } from './types';

/** Throwing counterpart of `can`. Every mutating service call starts with one of these. */
export function assertCan(
  principal: Principal,
  permission: PermissionKey,
  scope: AccessScope = {},
  message?: string,
): void {
  if (!can(principal, permission, scope)) {
    throw new ForbiddenError(message ?? `Missing permission: ${permission}`);
  }
}

/**
 * Passes when ANY of the permissions is held. Useful where a relationship-based rule
 * ("it is your own task") is an alternative to a broad permission.
 */
export function assertCanAny(
  principal: Principal,
  permissions: PermissionKey[],
  scope: AccessScope = {},
  message?: string,
): void {
  if (!permissions.some((p) => can(principal, p, scope))) {
    throw new ForbiddenError(message ?? `Missing one of: ${permissions.join(', ')}`);
  }
}
