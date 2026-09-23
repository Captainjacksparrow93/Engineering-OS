# Engineering OS — RBAC & Role Hierarchy Audit Report
**Date:** September 2026  
**Auditor:** Engineering OS Core Architecture Team  
**Status:** DRAFT FOR REVIEW — No RBAC permissions have been modified on existing production user grants.

---

## Executive Summary

This audit examines the Role-Based Access Control (RBAC) architecture, role definitions, scope assignments, and structural hierarchies across the Engineering OS platform for **ACS Engitech Pvt Ltd**.

While the granular capability engine (`src/core/rbac/engine.ts`) is cleanly implemented using capability strings (e.g. `pm.project.update`, `pm.task.assign`), the current seed and operational data contain significant scoping contradictions, permission collapses, and dual-hierarchy divergence.

---

## 1. Role Catalogue & Permission Matrix

| Role Key | Role Name | System Scope Design | Current Seeded Scope | Permission Count | Key Capabilities |
|---|---|---|---|---|---|
| `SUPER_ADMIN` | Platform Administrator | `GLOBAL` | `GLOBAL` | ALL (27) | Full platform administration, roles, users, audit logs |
| `DIRECTOR` | Director | `GLOBAL` | `GLOBAL` | 27 | Project oversight, creation, deletion, assignments, reports |
| `TECHNICAL_HEAD` | Technical Department Head | `DEPARTMENT` | `DEPARTMENT` | 17 | Automation projects, checklist templates, department reviews |
| `DEPARTMENT_HEAD` | Department Head | `DEPARTMENT` | `DEPARTMENT` | 1 | `admin.user.read` |
| `PROJECT_MANAGER` | Project Manager | `PROJECT` | **`GLOBAL`** *(Finding 1)* | 13 | Read, update, member manage, task create/update/assign, review |
| `ASST_MANAGER` | Assistant Manager | `PROJECT` | **`GLOBAL`** *(Finding 1)* | 13 | Same as Project Manager (added September 2026) |
| `PM_BASE` | Eligible Project Manager | `GLOBAL` | `GLOBAL` | 3 | `pm.resource.read`, `pm.report.read`, `pm.handover.decide` |
| `SENIOR_ENGINEER` | Senior Engineer | `GLOBAL` / `PROJECT` | `GLOBAL` | 2 | `pm.handover.request`, `pm.handover.decide` |
| `JUNIOR_ENGINEER` | Junior Engineer | `GLOBAL` / `PROJECT` | `GLOBAL` | 2 | `pm.handover.request`, `pm.handover.decide` *(Finding 2)* |

---

## 2. Key Audit Findings

### Finding 1: `PROJECT_MANAGER` & `ASST_MANAGER` Seeded at `GLOBAL` Scope
- **Current State:** In `prisma/seed.ts:957` and `prisma/seed.ts:1078`, `PROJECT_MANAGER` and `PM_BASE` are assigned with `scopeType: 'GLOBAL'`.
- **Architectural Violation:** `schema.prisma` specifies:
  > *"a Project Manager role granted at scope PROJECT:abc gives nothing on project xyz"*.
- **Impact:** Every Project Manager currently has full manager-level write, task editing, and status approval rights across **all** projects across the entire company, rather than being restricted to projects where they are assigned as Manager or Project Member.
- **Recommendation:**
  1. Transition `PROJECT_MANAGER` and `ASST_MANAGER` grants from `GLOBAL` to `PROJECT` scope, generated automatically upon assignment as project manager or team member.
  2. Maintain `PM_BASE` at `GLOBAL` scope for cross-project portfolio reads and resource availability visibility.

---

### Finding 2: Senior vs. Junior Engineer Permission Collapse
- **Current State:** Both `SENIOR_ENGINEER` and `JUNIOR_ENGINEER` hold identical permissions: `['pm.handover.request', 'pm.handover.decide']`.
- **Impact:** There is zero functional divergence between senior and junior engineers in terms of application security authorization. The distinction only exists as metadata in scheduling algorithms (`recommendedSeniority`).
- **Recommendation:**
  1. Junior engineers should only hold `pm.handover.request` (they can request to pass work to a colleague).
  2. Senior engineers should hold `pm.handover.request`, `pm.handover.decide`, and `pm.task.adhoc.create` (enabling them to raise technical punch-points without waiting for PM intervention).

---

### Finding 3: `DEPARTMENT_HEAD` Severely Under-Permitted
- **Current State:** `DEPARTMENT_HEAD` holds only `admin.user.read`.
- **Impact:** Heads of non-technical departments (e.g., Human Resources, Purchase, Accounts, Stores) cannot manage department members, approve leaves, or access departmental operational logs.
- **Recommendation:**
  1. Grant `DEPARTMENT_HEAD` department-scoped permissions: `admin.user.manage` (department-scoped), `pm.resource.read` (to inspect department workloads), and audit trail viewing for department employees.

---

### Finding 4: Dual Divergent Hierarchies (`User.managerId` vs `Department.headId`)
- **Current State:**
  - `User.managerId` forms an ad-hoc reporting tree utilized by `getDescendantUserIds` to build the "PM Squad" in the wizard.
  - `Department.headId` and `Department.parentId` form the official organizational tree.
- **Risk:** If a team member's line manager (`managerId`) is in Department A, but their `departmentId` is Department B, resource boards and squad assigners produce inconsistent sets.
- **Recommendation:**
  1. Establish `Department.headId` as the single authoritative governance node for approvals.
  2. Maintain `User.managerId` strictly for functional squad assignment, backed by a validation check that `managerId` must belong to the same technical department branch.

---

### Finding 5: Ambiguous Relationship Between `PM_BASE` and `PROJECT_MANAGER`
- **Current State:** `PM_BASE` is granted globally to allow PMs to see dashboards before having active projects. However, when `PROJECT_MANAGER` is also granted globally, `PM_BASE` is rendered redundant.
- **Recommendation:**
  - Formally document the pattern:
    - **`PM_BASE` (Global):** Grants baseline access to `/dashboard`, `/pm/resources`, and `/pm/reports`.
    - **`PROJECT_MANAGER` (Project-scoped):** Granted dynamically per project upon creation or assignment.

---

## 3. Proposed Remediation Plan (Post-Approval)

| Step | Target Role / Table | Proposed Change | Breaking Risk |
|---|---|---|---|
| **Phase A** | `core_role_permissions` | Remove `pm.handover.decide` from `JUNIOR_ENGINEER` | Low (juniors cannot unilaterally accept handovers) |
| **Phase B** | `core_role_permissions` | Add `admin.user.manage` & `pm.resource.read` to `DEPARTMENT_HEAD` (scoped) | Low (enhances non-tech heads) |
| **Phase C** | `core_role_assignments` | Migrate PMs from Global `PROJECT_MANAGER` to Global `PM_BASE` + Project-scoped `PROJECT_MANAGER` | Medium (requires project membership verification) |
| **Phase D** | Validation hooks | Add constraint preventing circular or cross-department `managerId` assignments | Low |

---
*No RBAC changes will be applied to live database records until this document is reviewed and approved by management.*
