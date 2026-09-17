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

Seed employees, departments, roles, checklist templates (PLC, SCADA, HMI) and the standard projects, then the demo projects:
```bash
npm run db:seed
npm run db:seed:demo
```

Both seeds are **create-only**: they add what is missing and never overwrite or delete data changed in the app (checklists, roles, users, passwords, projects). They also run on every container start.

### Step 5: Start the Development Server
Start the Next.js development server with hot-reload:
```bash
npm run dev
```
Open **[http://localhost:3000](http://localhost:3000)** in your browser.

---

## 4. Test Accounts

Sign in at `http://localhost:3000/login` with email and password. Every seeded account starts with the password from `SEED_PASSWORD` (default `ACSengi@2026`). The seed sets it only when it creates the account, so passwords changed later are kept.

| Role | Name | Email |
|---|---|---|
| Director | Shaktikumar Vasava | `shaktikumar.vasava@acsengitech.com` |
| Head of Technical | Dilip Asediya | `dilipkumar.asediya@acsengitech.com` |
| Project Manager (Team 1) | Parth Nagar | `parth.nagar@acsengitech.com` |
| Project Manager (Team 2) | Paras Prajapati | `paras.prajapati@acsengitech.com` |
| Senior Engineer (Team 1) | Shivam Prajapati | `shivam.prajapati@acsengitech.com` |
| Platform admin | Satish Nagar | `admin@acsengitech.com` |

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

# Reset LOCAL database only: wipes ALL data, pushes schema, re-runs both seeds.
# Never run this against the live server.
npm run db:reset:dev

# Stop the background database container
docker compose -f docker-compose.local.yml stop db
```
