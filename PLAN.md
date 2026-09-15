# Project Management Platform (Clean-Room Blueprint & Engineering Plan)

---

## 1. Executive Summary & Vision

This document details the architecture, functional logic, and technical implementation plan for building a **high-performance, modern project management platform from scratch**.

### The Core Objective:
To replicate the powerful functional concepts and sleek user experience of modern project management tools like **Plane, Linear, and Jira** (Cycles/Sprints, Modules/Epics, Kanban boards, Issue state workflows, and atomic sequence IDs) through **100% independent, clean-room custom code**.

---

## 2. Why Clean-Room Custom Code? (Strategic Rationale)

| Aspect | Plane (AGPL-3.0 Fork) | Our Clean-Room Custom Codebase |
| :--- | :--- | :--- |
| **Intellectual Property** | Bound by AGPL-3.0 copyleft terms | **100% Private, Proprietary Ownership** |
| **Source Disclosure** | Mandatory code disclosure if exposed to network users | **Zero Disclosure Obligation** (Fully closed-source SaaS/App) |
| **Architectural Weight** | Heavy legacy Django + Python + Next.js monorepo | **Ultra-Lean TypeScript / Fastify + Next.js + Neon DB** |
| **Customizability** | Upstream merge conflicts when modifying core features | **Tailor-made for our exact client requirements** |
| **Hosting Footprint** | Requires high-RAM servers ($20–$50+/mo) | **Runs smoothly on a low-cost KVM 1 VPS + Neon DB Free Tier** |

---

## 3. Targeted Single-Team Architecture (YAGNI & Simplicity)

To maximize developer velocity, eliminate latency, and reduce memory footprint:
* **No Multi-Tenant Workspace Complexity:** We eliminate tenant switching, complex workspace invitation flows, and multi-tenant database joins.
* **Direct Team Routing:** Routes are clean and intuitive (e.g., `/projects/ENG/board`, `/projects/ENG/cycles`).
* **Direct Role-Based Access Control (RBAC):** Users belong directly to the organization with one of three roles:
  * `Admin`: Full control over settings, users, projects, and custom workflows.
  * `Member`: Can create, edit, assign, and manage issues, cycles, and modules.
  * `Viewer`: Read-only access to boards, roadmaps, and issue timelines.

---

## 4. System Architecture & Tech Stack

```
 ┌─────────────────────────────────────────────────────────────┐
 │                    NEXT.JS 15 (FRONTEND)                    │
 │  - React 19, Tailwind CSS, Lucide Icons                     │
 │  - Pragmatic Drag & Drop (Fast Kanban Engine)               │
 │  - TanStack Query (Optimistic UI & Client Cache)            │
 └──────────────────────────────┬──────────────────────────────┘
                                │ HTTPS / WebSockets
                                ▼
 ┌─────────────────────────────────────────────────────────────┐
 │                     FASTIFY BACKEND API                     │
 │  - TypeScript & Node.js (Ultra-low latency, High RPM)       │
 │  - Secure HTTP-Only JWT Cookie Authentication               │
 │  - Atomic Sequence Number Generator ("ENG-101")             │
 │  - Live WebSocket Sync Gateway                              │
 └──────────────┬───────────────────────────────┬──────────────┘
                │ SQL Connection Pool           │ Pub/Sub & Task State
                ▼                               ▼
 ┌──────────────────────────────┐┌──────────────────────────────┐
 │     NEON POSTGRESQL (DB)     ││        REDIS (CACHE)         │
 │  - Serverless PostgreSQL 16  ││  - WebSocket Room Pub/Sub    │
 │  - Drizzle ORM Type-Safe DDL ││  - Realtime Board Sync       │
 │  - Offloaded Compute & Disk  ││  - Cache & Rate Limiting     │
 └──────────────────────────────┘└──────────────────────────────┘
```

---

## 5. Domain Entities & Database Schema (Neon PostgreSQL)

```sql
-- 1. Users & Authentication
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    avatar_url TEXT,
    role VARCHAR(20) NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member', 'viewer')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Projects & Custom State Workflows
CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    identifier VARCHAR(10) UNIQUE NOT NULL, -- e.g. "ENG", "PROD", "DESIGN"
    description TEXT,
    issue_sequence_counter INT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE project_states (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    color VARCHAR(20) DEFAULT '#6B7280',
    group_type VARCHAR(20) NOT NULL CHECK (group_type IN ('backlog', 'unstarted', 'started', 'completed', 'cancelled')),
    sequence_order INT NOT NULL
);

-- 3. Cycles (Sprints) & Modules (Epics)
CREATE TABLE cycles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    start_date DATE,
    end_date DATE,
    status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'upcoming', 'active', 'completed')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE modules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(20) DEFAULT 'planned' CHECK (status IN ('planned', 'in_progress', 'paused', 'completed', 'cancelled')),
    start_date DATE,
    target_date DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Issues & Sub-Issues
CREATE TABLE issues (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    sequence_id INT NOT NULL, -- "101" forms "ENG-101"
    title VARCHAR(500) NOT NULL,
    description_json JSONB,
    state_id UUID REFERENCES project_states(id) ON DELETE RESTRICT,
    priority VARCHAR(20) DEFAULT 'none' CHECK (priority IN ('urgent', 'high', 'medium', 'low', 'none')),
    estimate_points INT,
    parent_issue_id UUID REFERENCES issues(id) ON DELETE SET NULL,
    cycle_id UUID REFERENCES cycles(id) ON DELETE SET NULL,
    module_id UUID REFERENCES modules(id) ON DELETE SET NULL,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    UNIQUE(project_id, sequence_id)
);

CREATE TABLE issue_assignees (
    issue_id UUID REFERENCES issues(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY(issue_id, user_id)
);

-- 5. Activity Log & Comments
CREATE TABLE activity_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    issue_id UUID REFERENCES issues(id) ON DELETE CASCADE,
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    field_name VARCHAR(100) NOT NULL,
    old_value JSONB,
    new_value JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE issue_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    issue_id UUID REFERENCES issues(id) ON DELETE CASCADE,
    author_id UUID REFERENCES users(id) ON DELETE SET NULL,
    content_json JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

---

## 6. Core Business Logic & State Machines

### 1. Atomic Issue Key Generator
* Uses PostgreSQL atomic transaction updates on the project's sequence counter:
  ```sql
  UPDATE projects 
  SET issue_sequence_counter = issue_sequence_counter + 1 
  WHERE id = $1 
  RETURNING issue_sequence_counter;
  ```
* Guarantees that even under concurrent user requests, issue sequence keys (`ENG-1`, `ENG-2`, `ENG-3`) are strictly monotonic and never duplicated or collided.

### 2. Issue State Grouping Machine
* States can be customized per project, but always belong to one of 5 universal groups:
  `Backlog` $\rightarrow$ `Unstarted` $\rightarrow$ `Started` $\rightarrow$ `Completed` / `Cancelled`.
* Setting state to `Completed` automatically stamps `completed_at = NOW()`.

### 3. Cycle (Sprint) Lifecycle Engine
* **Draft** $\rightarrow$ **Upcoming** $\rightarrow$ **Active** $\rightarrow$ **Completed**.
* Rule: Only **1 active cycle** permitted per project at a time.
* On completion: Incomplete issues trigger an automatic rollover prompt (move to Backlog or carry over to the next Sprint).

### 4. Module (Epic) Progress Engine
* Automatically computes completion progress:
  $$\text{Progress \%} = \left( \frac{\text{Completed Points / Issues}}{\text{Total Points / Issues}} \right) \times 100$$
* Auto-transitions from `Planned` to `In Progress` when the first child issue is started.

---

## 7. Phased Implementation Roadmap

```
Phase 1: Foundation (Scaffolding, Neon PostgreSQL + Drizzle, Auth, Projects)
   │
   ▼
Phase 2: Issue Engine (Atomic Sequence Keys, States, Issue CRUD, Activity Logs)
   │
   ▼
Phase 3: Sprints & Epics (Cycle State Machine, Rollovers, Module Progress Tracking)
   │
   ▼
Phase 4: Frontend UI (Next.js 15, Interactive Drag-and-Drop Kanban, List View, Comments)
   │
   ▼
Phase 5: Live Realtime & Deployment (WebSocket Sync, Docker Compose for KVM 1 VPS)
```

---

## 8. Deployment on KVM 1 VPS + Neon DB

1. **PostgreSQL Database:** Hosted on **Neon DB** (Cloud Serverless PostgreSQL, 0 MB VPS RAM).
2. **VPS Runtime:** Runs Docker Compose containing:
   * Next.js 15 Standalone Web App (~100 MB RAM)
   * Fastify Backend API (~80 MB RAM)
   * Redis Server (~30 MB RAM)
   * Caddy Reverse Proxy with auto-SSL (~20 MB RAM)
3. **Total Server Memory:** ~250 MB RAM, leaving massive headroom on a 1 GB / 2 GB KVM 1 VPS.
