# Access control

Everyone in the company uses this platform — directors, department heads, project
managers, senior and junior engineers, QA, production supervisors, security. They must
see very different things, and the model has to survive the org chart changing.

## The model

**Permission** — a capability, `<module>.<resource>.<action>`, e.g. `pm.task.assign`.
The full catalogue lives in `src/core/rbac/permissions.ts`.

**Role** — a named bundle of permissions. Roles exist for administrative convenience;
no code ever checks a role name.

**Grant (RoleAssignment)** — a role given to a person **at a scope**:

| Scope        | Means                                             | Typical holder            |
|--------------|---------------------------------------------------|---------------------------|
| `GLOBAL`     | The whole company                                  | Director, platform admin  |
| `DEPARTMENT` | That department **and everything beneath it**      | Department head           |
| `PROJECT`    | Exactly one project                                | Project manager, engineer |

The same role means different things at different scopes. "Project Manager" granted on
`PRJ-2026-001` confers nothing on `PRJ-2026-002`. This is what lets one platform serve
multiple hierarchies and multiple managers without branching on job titles.

## How a decision is made

```ts
can(principal, 'pm.task.assign', { projectId, departmentId })
```

A grant matches when the permission matches **and** its scope contains the scope of the
attempted action. `GLOBAL` matches everything; `DEPARTMENT` matches when the action's
department is in the principal's covered set (subtree already expanded at login);
`PROJECT` matches that exact project. Anything else is denied. There is no bypass.

Two deliberate additions to pure RBAC, because pure RBAC gets the real world wrong:

- **Manager-implied rights.** The manager of a project holds that project's permissions
  by virtue of being its manager — otherwise handing someone a project would require a
  separate grant every time (`MANAGER_IMPLIED` in `services/access.ts`).
- **Holder-implied rights.** Whoever currently holds a task can always read it, log
  progress on it, and hand it on, even with no project grant — otherwise an ad-hoc task
  given to an engineer outside the project team would be invisible to them
  (`HOLDER_IMPLIED`).

Both are narrow, explicit lists, not escape hatches.

## Visibility vs. mutation

Answered separately, on purpose:

- *What may I see?* — `projectVisibilityWhere()` builds a query filter: everything, if
  you hold `pm.project.read.all`; otherwise projects you manage, sponsor, are a member
  of, hold a task on, or that sit in a department you cover.
- *What may I do?* — `assertProjectPermission()` / `assertTaskPermission()`, which throw.

Visibility is generous, mutation is strict. Filtering in the query rather than in the
page also means a scoped user's list simply does not contain other people's projects —
there is nothing to leak.

## Shipped roles

| Role | For | Notably can |
|------|-----|-------------|
| `SUPER_ADMIN` | Platform administration | Everything, including editing roles |
| `DIRECTOR` | Board / owners | See every project, define projects, reassign anyone, override handovers |
| `DEPARTMENT_HEAD` | Engineering / PMO heads | Everything within their department subtree |
| `PROJECT_MANAGER` | Per project | Full control of that project only |
| `SENIOR_ENGINEER` | Seniors and leads | Execute, create tasks, pull peers in, see team load |
| `JUNIOR_ENGINEER` | Juniors and trainees | Their own queue, progress, handovers |
| `VIEWER` | Auditors, observers | Read-only |

Roles are editable at **Administration → Roles & permissions**; changes are audited and
take effect for everyone holding the role.

## Sessions

A signed JWT cookie whose `jti` must match a live row in `core_sessions`. Suspending or
exiting an employee revokes every session immediately — the reason session state is in
the database rather than only in the token.

## Extending it

A new module adds its keys to `PERMISSIONS`, and the seed syncs them into
`core_permissions`. They are immediately grantable through the admin UI at any scope.
No change to the engine, no change to existing roles.
