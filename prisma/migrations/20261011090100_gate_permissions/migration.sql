-- Plan 019: Gate & Visitors permissions and the Receptionist role. Additive and idempotent.
-- Any employee may schedule visits to themselves and answer arrival alerts; that needs no key.

INSERT INTO "core_permissions" ("id", "key", "module", "description") VALUES
  (gen_random_uuid()::text, 'gate.desk', 'gate', 'Run the front desk: schedule visits for anyone, log walk-ins, check visitors in and out'),
  (gen_random_uuid()::text, 'gate.register.read', 'gate', 'See the full visitor register and history')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "core_roles" ("id", "key", "name", "description", "isSystem", "createdAt", "updatedAt")
VALUES (gen_random_uuid()::text, 'RECEPTIONIST', 'Receptionist',
        'Runs the front desk: visitor check-in and check-out, walk-ins and the visitor register.', true, now(), now())
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "core_role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "core_roles" r
JOIN "core_permissions" p ON
     (r."key" IN ('SUPER_ADMIN', 'RECEPTIONIST') AND p."module" = 'gate')
  OR (r."key" = 'DIRECTOR' AND p."key" = 'gate.register.read')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
