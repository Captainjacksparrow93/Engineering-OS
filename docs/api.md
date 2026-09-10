# REST API

The web UI uses server actions; this API exists so the same rules serve a future mobile
or shop-floor client, and so integration tests can drive real workflows. Both paths call
the same services, so authorisation and business rules are identical.

Authentication is the session cookie set by `POST /api/auth/login`.

## Auth

| Method | Path | Notes |
|--------|------|-------|
| POST | `/api/auth/login` | `{ email, password }` → sets the session cookie |
| POST | `/api/auth/logout` | Revokes the session row |
| GET | `/api/auth/me` | Identity plus the caller's full grant list — the first thing to check when access looks wrong |

## Projects

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/pm/projects` | `?status=&q=&mine=1`. Returns only what the caller may see |
| POST | `/api/pm/projects` | Requires `pm.project.create` |
| GET | `/api/pm/projects/:id` | Workspace: tasks, dependencies, CPM schedule, critical path, summary |
| PATCH | `/api/pm/projects/:id` | Requires `pm.project.update` on that project |

## Tasks

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/pm/tasks` | The caller's own queue. `?status=&all=1` |
| POST | `/api/pm/tasks` | Create; accepts `dependsOn[]` and `assigneeId` |
| GET | `/api/pm/tasks/:id` | Detail, current blockers, and what the caller may do |
| PATCH | `/api/pm/tasks/:id` | `{ status }` for a transition, otherwise a field update |
| DELETE | `/api/pm/tasks/:id` | Refused once progress exists — cancel instead |
| POST | `/api/pm/tasks/:id/assign` | Top-down assignment |
| POST | `/api/pm/tasks/:id/progress` | Punch in progress |

## Handovers

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/pm/tasks/:id/handover` | Ranked `candidates` plus a plain `peers` fallback |
| POST | `/api/pm/tasks/:id/handover` | Raise one: `{ toUserId, reason }` |
| GET | `/api/pm/handovers` | `incoming`, `outgoing`, `oversight` |
| POST | `/api/pm/handovers/:id` | `{ decision: 'ACCEPTED' \| 'REJECTED', note? }` |
| DELETE | `/api/pm/handovers/:id` | Withdraw your own pending request |

## Dependencies & capacity

| Method | Path | Notes |
|--------|------|-------|
| POST | `/api/pm/dependencies` | Rejects cycles with the offending path |
| DELETE | `/api/pm/dependencies?id=` | |
| GET | `/api/pm/availability` | Workloads. `?from=&to=&departmentId=&projectId=&skills=` |
| GET | `/api/pm/availability?suggest=1` | Ranked candidates. Add `requiredHours`, `priority` |
| GET | `/api/health` | Liveness plus a database check |

## Errors

One contract, mapped centrally in `src/core/http/api.ts`:

| Status | Meaning |
|--------|---------|
| 400 | Malformed input — body carries `issues` per field |
| 401 | No valid session |
| 403 | Authenticated but not permitted |
| 404 | Absent, or outside the caller's scope (the two are indistinguishable on purpose) |
| 422 | Understood but violates a domain rule (cycle, illegal transition, progress going backwards) |

## Example

```bash
# Sign in
curl -c jar -H 'content-type: application/json' \
  -d '{"email":"priya.nair@vidyutswitchgear.com","password":"…"}' \
  http://localhost:3000/api/auth/login

# Who can take 8 hours of schematic work right now?
curl -b jar 'http://localhost:3000/api/pm/availability?suggest=1&requiredHours=8&skills=schematics&priority=CRITICAL'

# Punch in progress and raise a blocker
curl -b jar -H 'content-type: application/json' \
  -d '{"percentComplete":80,"hoursSpent":6,"note":"Cable schedule done to feeder 9.","blocker":"Client tray drawing awaited."}' \
  http://localhost:3000/api/pm/tasks/<taskId>/progress
```
