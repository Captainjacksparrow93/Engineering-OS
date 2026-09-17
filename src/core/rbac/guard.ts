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

