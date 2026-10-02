-- Insert 'erp.access' permission into core_permissions
INSERT INTO "core_permissions" ("id", "key", "module", "description")
VALUES (gen_random_uuid()::text, 'erp.access', 'erp', 'Open ERP with single sign-on')
ON CONFLICT ("key") DO NOTHING;

-- Grant 'erp.access' to DIRECTOR, SALES_HEAD and SUPER_ADMIN
INSERT INTO "core_role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "core_roles" r
CROSS JOIN "core_permissions" p
WHERE r."key" IN ('DIRECTOR', 'SALES_HEAD', 'SUPER_ADMIN')
  AND p."key" = 'erp.access'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;