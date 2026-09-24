-- Project Wipe Script (Part 2 of reset-and-pm-team-plan.md)
-- IRREVERSIBLE: Ensure pg_dump backup is taken before executing!

BEGIN;

-- 1. Delete PROJECT-scoped role assignments (no foreign key to pm_projects)
DELETE FROM core_role_assignments WHERE "scopeType" = 'PROJECT';

-- 2. Delete all projects (cascades to tasks, assignments, logs, handovers, members, milestones, commissioning)
DELETE FROM pm_projects;

COMMIT;

-- 3. Verification query
SELECT (SELECT count(*) FROM pm_projects)              AS projects,      -- expected: 0
       (SELECT count(*) FROM pm_tasks)                 AS tasks,         -- expected: 0
       (SELECT count(*) FROM pm_task_assignments)      AS assignments,   -- expected: 0
       (SELECT count(*) FROM pm_task_progress_logs)    AS logs,          -- expected: 0
       (SELECT count(*) FROM pm_commissioning_logs)    AS comm_logs,     -- expected: 0
       (SELECT count(*) FROM core_role_assignments WHERE "scopeType" = 'PROJECT') AS project_roles, -- expected: 0
       (SELECT count(*) FROM core_users)               AS people,        -- unchanged (109)
       (SELECT count(*) FROM pm_clients)               AS clients,       -- unchanged (16)
       (SELECT count(*) FROM pm_checklist_templates)   AS templates;     -- unchanged (3)
