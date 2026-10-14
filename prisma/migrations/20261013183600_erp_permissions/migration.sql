-- Plan 022: native ERP permissions and roles. Additive and idempotent.
-- erp.access (plan 013) stays: it opens the ERP home. Each area has read and manage.

INSERT INTO "core_permissions" ("id", "key", "module", "description") VALUES
  (gen_random_uuid()::text, 'erp.stock.read', 'erp', 'See items, warehouses, stock levels, stock entries and stock reports'),
  (gen_random_uuid()::text, 'erp.stock.manage', 'erp', 'Maintain items and warehouses; create and submit stock entries and reconciliations'),
  (gen_random_uuid()::text, 'erp.buying.read', 'erp', 'See suppliers, material requests, purchase orders, receipts and purchase invoices'),
  (gen_random_uuid()::text, 'erp.buying.manage', 'erp', 'Create and submit material requests, supplier quotations, purchase orders, receipts and purchase invoices'),
  (gen_random_uuid()::text, 'erp.selling.read', 'erp', 'See customers, sales orders, delivery notes and sales invoices'),
  (gen_random_uuid()::text, 'erp.selling.manage', 'erp', 'Create and submit sales orders, delivery notes and sales invoices'),
  (gen_random_uuid()::text, 'erp.manufacturing.read', 'erp', 'See BOMs, work orders, job cards and production plans'),
  (gen_random_uuid()::text, 'erp.manufacturing.manage', 'erp', 'Maintain BOMs and workstations; run work orders, job cards and production plans'),
  (gen_random_uuid()::text, 'erp.quality.read', 'erp', 'See quality inspections, non-conformances and controlled documents'),
  (gen_random_uuid()::text, 'erp.quality.manage', 'erp', 'Record inspections, raise and close non-conformances, release document revisions'),
  (gen_random_uuid()::text, 'erp.assets.read', 'erp', 'See the asset register, depreciation and maintenance schedules'),
  (gen_random_uuid()::text, 'erp.assets.manage', 'erp', 'Maintain assets, post depreciation, plan and log maintenance and breakdowns'),
  (gen_random_uuid()::text, 'erp.accounts.read', 'erp', 'See the books: ledgers, invoices, payments and financial reports'),
  (gen_random_uuid()::text, 'erp.accounts.manage', 'erp', 'Post journal entries and payments, reconcile banks, close periods'),
  (gen_random_uuid()::text, 'erp.settings.manage', 'erp', 'Change ERP settings and the chart of accounts')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "core_roles" ("id", "key", "name", "description", "isSystem", "createdAt", "updatedAt") VALUES
  (gen_random_uuid()::text, 'PURCHASE_MANAGER', 'Purchase Manager', 'Runs buying: suppliers, material requests, quotations, purchase orders and receipts.', true, now(), now()),
  (gen_random_uuid()::text, 'STORE_KEEPER', 'Store Keeper', 'Runs the stores: items, receipts, issues, transfers and stock counts.', true, now(), now()),
  (gen_random_uuid()::text, 'ACCOUNTS_MANAGER', 'Accounts Manager', 'Runs the books: invoices, payments, journals, bank reconciliation and financial reports.', true, now(), now()),
  (gen_random_uuid()::text, 'PRODUCTION_MANAGER', 'Production Manager', 'Runs production: BOMs, work orders, job cards and production plans.', true, now(), now()),
  (gen_random_uuid()::text, 'QUALITY_MANAGER', 'Quality Manager', 'Runs quality: inspections, non-conformances and controlled documents.', true, now(), now()),
  (gen_random_uuid()::text, 'MAINTENANCE_MANAGER', 'Maintenance Manager', 'Runs plant maintenance: the asset register, preventive schedules and breakdowns.', true, now(), now())
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "core_role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "core_roles" r
JOIN "core_permissions" p ON
     (r."key" IN ('SUPER_ADMIN', 'DIRECTOR') AND p."module" = 'erp')
  OR (r."key" = 'SALES_HEAD' AND p."key" IN ('erp.access', 'erp.selling.read', 'erp.selling.manage', 'erp.stock.read'))
  OR (r."key" = 'PURCHASE_MANAGER' AND p."key" IN ('erp.access', 'erp.buying.read', 'erp.buying.manage', 'erp.stock.read', 'erp.quality.read'))
  OR (r."key" = 'STORE_KEEPER' AND p."key" IN ('erp.access', 'erp.stock.read', 'erp.stock.manage', 'erp.buying.read', 'erp.quality.read'))
  OR (r."key" = 'ACCOUNTS_MANAGER' AND p."key" IN ('erp.access', 'erp.accounts.read', 'erp.accounts.manage', 'erp.buying.read', 'erp.selling.read', 'erp.stock.read', 'erp.assets.read'))
  OR (r."key" = 'PRODUCTION_MANAGER' AND p."key" IN ('erp.access', 'erp.manufacturing.read', 'erp.manufacturing.manage', 'erp.stock.read', 'erp.buying.read', 'erp.quality.read'))
  OR (r."key" = 'QUALITY_MANAGER' AND p."key" IN ('erp.access', 'erp.quality.read', 'erp.quality.manage', 'erp.stock.read', 'erp.manufacturing.read', 'erp.buying.read'))
  OR (r."key" = 'MAINTENANCE_MANAGER' AND p."key" IN ('erp.access', 'erp.assets.read', 'erp.assets.manage', 'erp.stock.read'))
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
