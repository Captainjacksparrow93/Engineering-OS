-- Plan 020 phase 1: HRMS permissions and the HR Manager role. Additive and idempotent.
-- Self-service (your own profile and documents, company policies) needs no key.

INSERT INTO "core_permissions" ("id", "key", "module", "description") VALUES
  (gen_random_uuid()::text, 'hr.employee.read', 'hr', 'See employee records in scope (a department-scoped grant sees that department)'),
  (gen_random_uuid()::text, 'hr.employee.manage', 'hr', 'Edit employee HR records, upload employee documents and company policies'),
  (gen_random_uuid()::text, 'hr.sensitive.read', 'hr', 'See bank account and ID numbers (PAN, Aadhaar, UAN, ESIC)')
ON CONFLICT ("key") DO NOTHING;

-- Already present on a live database; inserted here too so a fresh database (migrations run
-- before the seed creates the catalogue) gives HR Manager its People access.
INSERT INTO "core_permissions" ("id", "key", "module", "description") VALUES
  (gen_random_uuid()::text, 'admin.user.read', 'admin', 'View employee accounts'),
  (gen_random_uuid()::text, 'admin.user.manage', 'admin', 'Create, edit and deactivate employee accounts')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "core_roles" ("id", "key", "name", "description", "isSystem", "createdAt", "updatedAt")
VALUES (gen_random_uuid()::text, 'HR_MANAGER', 'HR Manager',
        'Runs HR: every employee record, documents and policies; adds and deactivates accounts.', true, now(), now())
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "core_role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "core_roles" r
JOIN "core_permissions" p ON
     (r."key" IN ('SUPER_ADMIN', 'HR_MANAGER', 'DIRECTOR') AND p."module" = 'hr')
  OR (r."key" = 'HR_MANAGER' AND p."key" IN ('admin.user.read', 'admin.user.manage'))
  OR (r."key" IN ('DEPARTMENT_HEAD', 'TECHNICAL_HEAD', 'SERVICE_HEAD') AND p."key" = 'hr.employee.read')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
