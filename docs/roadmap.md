# Roadmap

Every module below already has its place in the platform: shared identity, scoped
permissions, one database, and an event bus with a published catalogue. Shipping one is
adding its tables, its permission keys and its screens — not re-architecting.

Until a module ships, its route renders a *Coming soon* page listing its scope and how
it will connect. Nothing half-built is exposed.

## Phase 1 — Project Management ✅ shipped

Projects, WBS, four dependency types with cycle detection and critical path, capacity
and availability, ad-hoc assignment with ranked candidates, peer handover, progress
ledger with blockers, scoped RBAC, audit trail, event bus.

## Phase 2 — HRMS and Gate Entry

**HRMS** takes ownership of the employee master; Project Management keeps using the same
`core_users` row rather than a copy.

- Attendance and shift rosters replace the flat `dailyCapacityHours`, feeding real
  capacity into the resource board.
- Leave approval publishes `hrms.leave.approved`; the availability engine already
  subtracts approved leave from capacity, so the wiring is a subscription.
- The skill matrix replaces free-text skill tags in assignment ranking.
- Payroll inputs draw on the hours already accumulating in the progress ledger.

**Gate Entry** is the plant's front door.

- Inward material entry raises the ERP goods-receipt note.
- Outward dispatch gate pass is linked to the production panel record.
- Visitor and contractor check-in references the HRMS employee being met.
- Live on-premise headcount for security.

## Phase 3 — ERP and Production

**ERP / Finance**

- A sales order creates the project shell automatically (consumes nothing new: it will
  call the same `createProject` service).
- BOM and material readiness gate engineering tasks — a material shortage becomes a real
  blocker on the task that needs it, using the dependency machinery that already exists.
- `actualHours` from the progress ledger posts to job costing.
- `Project.orderValue` and `poNumber` move out of `pm_projects` into ERP; Project
  Management reads them through the ERP service.

**Production Management**

- Engineering release (`pm.task.completed` on the release task) opens the job card.
- Stage-wise panel tracking: fabrication, busbar, wiring, testing, dispatch.
- Machine and workstation capacity planning, reusing the capacity engine.
- Quality checkpoints and non-conformance reports.

## Phase 4 — Quality & Documents, Maintenance

- Drawing revisions attached to the engineering task that produced them.
- Customer approval cycles that gate downstream production tasks.
- Routine test reports per panel serial number.
- Preventive maintenance jobs raised on the shared task engine; machine downtime feeds
  back into production capacity.

## Cross-cutting, as scale demands

- Email and WhatsApp delivery for notifications (the channel column already exists).
- File attachments on tasks and drawings (object storage).
- Mobile-first shop-floor view for progress punch-in.
- Outbox drain moved to a worker container; Redis for caching and rate limiting.
- Read replica for dashboards.
