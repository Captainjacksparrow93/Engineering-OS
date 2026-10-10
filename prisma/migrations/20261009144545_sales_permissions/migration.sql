-- Plan 018: Sales module permissions and the Sales Executive role. Additive and idempotent.

INSERT INTO "core_permissions" ("id", "key", "module", "description") VALUES
  (gen_random_uuid()::text, 'sales.deal.read', 'sales', 'Open Sales; see your own deals, accounts and the price catalogue'),
  (gen_random_uuid()::text, 'sales.deal.read.all', 'sales', 'See every salesperson''s deals and quotes'),
  (gen_random_uuid()::text, 'sales.deal.manage', 'sales', 'Create and edit deals, contacts, BOMs and quotes'),
  (gen_random_uuid()::text, 'sales.account.manage', 'sales', 'Edit client relationship factors (strategic, payment delay, customer since)'),
  (gen_random_uuid()::text, 'sales.catalog.manage', 'sales', 'Maintain items and prices; import price lists and past quotes'),
  (gen_random_uuid()::text, 'sales.quote.approve', 'sales', 'Approve quotes below the minimum margin'),
  (gen_random_uuid()::text, 'sales.settings.manage', 'sales', 'Set margins, GST, quote terms and price priority')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "core_roles" ("id", "key", "name", "description", "isSystem", "createdAt", "updatedAt")
VALUES (gen_random_uuid()::text, 'SALES_EXECUTIVE', 'Sales Executive',
        'Runs their own deals and quotes in Sales.', true, now(), now())
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "core_role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "core_roles" r
JOIN "core_permissions" p ON
     (r."key" IN ('DIRECTOR', 'SUPER_ADMIN') AND p."module" = 'sales')
  OR (r."key" = 'SALES_HEAD' AND p."key" IN ('sales.deal.read', 'sales.deal.read.all', 'sales.deal.manage', 'sales.account.manage', 'sales.catalog.manage'))
  OR (r."key" = 'SALES_EXECUTIVE' AND p."key" IN ('sales.deal.read', 'sales.deal.manage'))
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
