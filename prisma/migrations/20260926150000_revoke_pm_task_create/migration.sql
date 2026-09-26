-- Revoke task creation permissions from PROJECT_MANAGER and ASST_MANAGER roles
DELETE FROM "core_role_permissions"
WHERE "roleId" IN (
    SELECT id FROM "core_roles" WHERE key IN ('PROJECT_MANAGER', 'ASST_MANAGER')
  )
  AND "permissionId" IN (
    SELECT id FROM "core_permissions" WHERE key IN ('pm.task.create', 'pm.task.adhoc.create')
  );
