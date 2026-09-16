# Local Development Guide — Engineering OS

This guide outlines how to run, develop, and test the **Engineering OS** project locally on your machine.

---

## 1. Architecture & Local Setup Strategy

To maintain maximum developer velocity and sub-second hot-reloading, the application runs natively using Next.js while PostgreSQL runs in a lightweight background Docker container.

```
┌──────────────────────────────────────────────┐
│  Next.js 16 (App Router + React 19)          │
│  http://localhost:3000                       │
│  npm run dev (Native Node.js / Turbopack)     │
└───────────────────────┬──────────────────────┘
                        │
                        ▼ (Port 5432)
┌──────────────────────────────────────────────┐
│  PostgreSQL 16 Container                     │
│  Container name: engos_local_db              │
│  docker compose -f docker-compose.local.yml  │
└──────────────────────────────────────────────┘
```

---

## 2. Prerequisites

- **Node.js**: v20.x or v22.x LTS
- **Docker Desktop**: Installed and running (for the local PostgreSQL container)
- **Git**: Installed

---

## 3. Quickstart (Step-by-Step)

### Step 1: Install Dependencies
```bash
npm install
```

### Step 2: Start the Background PostgreSQL Database
Start only the PostgreSQL service in detached mode:
```bash
docker compose -f docker-compose.local.yml up -d db
```
*The database container `engos_local_db` will start on port `5432` with user `engos` and database `engineering_os`.*

### Step 3: Configure Environment Variables
Ensure you have a `.env` file in the project root:
```env
DATABASE_URL="postgresql://engos:engos_local_password@localhost:5432/engineering_os?schema=public"
DIRECT_URL="postgresql://engos:engos_local_password@localhost:5432/engineering_os?schema=public"
AUTH_SECRET="acs-engitech-super-secret-key-32chars-min"
APP_URL="http://localhost:3000"
SESSION_TTL_SECONDS=43200
```

### Step 4: Synchronize Database Schema & Seed Data
Push the Prisma schema to your local database:
```bash
npx prisma db push
```

Seed the database with all employees, departments, and default projects:
```bash
npm run db:seed
```

Seed the automation checklist templates (PLC, SCADA, HMI):
```bash
npx tsx prisma/seed-automation-templates.ts
```

### Step 5: Start the Development Server
Start the Next.js development server with hot-reload:
```bash
npm run dev
```
Open **[http://localhost:3000](http://localhost:3000)** in your browser.

---

## 4. Test Accounts & Instant Persona Login

The login page (`http://localhost:3000/login`) provides **1-click passwordless test login buttons** for various roles:

| Persona | Role / Grade | Typical Use Case |
|---|---|---|
| **Pravin Patel** | Managing Director (`DIRECTOR`) | Executive dashboard, creating projects, full visibility |
| **Parth Nagar** | Tech Lead (`HEAD`) | Managing Team 1, assigning tasks, resolving roadblocks |
| **Paras Prajapati** | Tech Lead (`HEAD`) | Managing Team 2, approving handovers |
| **Senior Automation Eng.** | Engineer (`SENIOR`) | Executing tasks, raising blockers, logging progress |

---

## 5. Verification & Quality Commands

Always verify changes using the repository quality gates:

```bash
# Type check with strict TypeScript (zero unused locals allowed)
npm run typecheck

# Run domain and RBAC unit test suite
npm test

# Test production compilation (Turbopack)
npm run build
```

---

## 6. Common Database Operations

```bash
# Open Prisma Studio web GUI on port 5555
npx prisma studio

# Reset local database (wipes data, pushes schema, requires re-seeding)
npx prisma db push --force-reset
npm run db:seed
npx tsx prisma/seed-automation-templates.ts

# Stop the background database container
docker compose -f docker-compose.local.yml stop db
```
