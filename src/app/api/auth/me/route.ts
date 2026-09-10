import { requirePrincipal } from '@/core/auth/session';
import { handler, ok } from '@/core/http/api';

/** The caller's identity and full permission set - handy when debugging access issues. */
export const GET = handler(async () => {
  const principal = await requirePrincipal();
  return ok({
    id: principal.userId,
    fullName: principal.fullName,
    email: principal.email,
    grade: principal.grade,
    departmentId: principal.departmentId,
    roles: principal.roleKeys,
    permissions: principal.grants,
    coveredDepartmentIds: principal.coveredDepartmentIds,
    memberProjectIds: principal.memberProjectIds,
  });
});
