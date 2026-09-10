import type { Grade, ScopeType } from '@prisma/client';
import type { PermissionKey } from './permissions';

/** One permission granted at one scope. Flattened from role assignments at login. */
export interface Grant {
  permission: PermissionKey;
  scopeType: ScopeType;
  /** Null for GLOBAL grants. */
  scopeId: string | null;
}

/**
 * Everything an authorisation decision needs, resolved once per request.
 * Deliberately serialisable so it can be cached or moved to a token later.
 */
export interface Principal {
  userId: string;
  companyId: string;
  employeeCode: string;
  fullName: string;
  email: string;
  grade: Grade;
  departmentId: string | null;
  managerId: string | null;
  avatarColor: string;
  grants: Grant[];
  /**
   * Department ids covered by this principal's DEPARTMENT-scoped grants, already
   * expanded down the department tree - a head of "Engineering" also covers
   * "Electrical Design" beneath it.
   */
  coveredDepartmentIds: string[];
  /** Project ids reachable through PROJECT-scoped grants or project membership. */
  memberProjectIds: string[];
  roleKeys: string[];
}

/** Where a permission is being exercised. Omit for company-wide actions. */
export interface AccessScope {
  projectId?: string | null;
  departmentId?: string | null;
}
