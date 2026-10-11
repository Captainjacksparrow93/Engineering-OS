-- Plan 020 phase 2: leave and attendance permissions, plus starter leave types. Additive and idempotent.
-- Applying for leave, seeing your own attendance and asking to correct it need no key.
-- The reporting manager's approval step needs no key either: it follows the reporting line.

INSERT INTO "core_permissions" ("id", "key", "module", "description") VALUES
  (gen_random_uuid()::text, 'hr.leave.approve', 'hr', 'Give the department-head approval on leave and attendance corrections (a department-scoped grant covers that department)'),
  (gen_random_uuid()::text, 'hr.attendance.manage', 'hr', 'Import biometric attendance; manage leave types, balances, holidays and shift timings')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "core_role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "core_roles" r
JOIN "core_permissions" p ON
     (r."key" IN ('SUPER_ADMIN', 'HR_MANAGER', 'DIRECTOR') AND p."key" IN ('hr.leave.approve', 'hr.attendance.manage'))
  OR (r."key" IN ('DEPARTMENT_HEAD', 'TECHNICAL_HEAD', 'SERVICE_HEAD') AND p."key" = 'hr.leave.approve')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- Starter leave types for every company; HR changes the days in HR settings.
INSERT INTO "hr_leave_types" ("id", "companyId", "code", "name", "annualDays", "paid", "allowHalfDay", "active", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, c."id", t.code, t.name, t.days, t.paid, true, true, now(), now()
FROM "core_companies" c
CROSS JOIN (VALUES
  ('CL', 'Casual leave', 8.0, true),
  ('SL', 'Sick leave', 7.0, true),
  ('EL', 'Earned leave', 15.0, true),
  ('LWP', 'Leave without pay', NULL, false)
) AS t(code, name, days, paid)
ON CONFLICT ("companyId", "code") DO NOTHING;
