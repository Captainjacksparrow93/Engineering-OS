-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'EXITED');

-- CreateEnum
CREATE TYPE "Grade" AS ENUM ('TRAINEE', 'JUNIOR_ENGINEER', 'ENGINEER', 'SENIOR_ENGINEER', 'LEAD_ENGINEER', 'MANAGER', 'HEAD', 'DIRECTOR');

-- CreateEnum
CREATE TYPE "ScopeType" AS ENUM ('GLOBAL', 'DEPARTMENT', 'PROJECT');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('PENDING', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'EMAIL', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "ModuleStatus" AS ENUM ('LIVE', 'BETA', 'COMING_SOON');

-- CreateEnum
CREATE TYPE "LeaveStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('DRAFT', 'PLANNING', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProjectPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "ProjectRole" AS ENUM ('MANAGER', 'LEAD', 'ENGINEER', 'REVIEWER', 'OBSERVER');

-- CreateEnum
CREATE TYPE "TaskType" AS ENUM ('PROJECT', 'ADHOC', 'PHASE');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('DRAFT', 'BLOCKED', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "DependencyType" AS ENUM ('FINISH_TO_START', 'START_TO_START', 'FINISH_TO_FINISH', 'START_TO_FINISH');

-- CreateEnum
CREATE TYPE "AssignmentRole" AS ENUM ('OWNER', 'COLLABORATOR', 'REVIEWER');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('ACTIVE', 'HANDED_OVER', 'COMPLETED', 'RELEASED');

-- CreateEnum
CREATE TYPE "HandoverStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "core_companies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "gstin" TEXT,
    "address" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "core_companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core_departments" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "parentId" TEXT,
    "headId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "core_departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core_users" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeCode" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT,
    "designation" TEXT,
    "grade" "Grade" NOT NULL DEFAULT 'JUNIOR_ENGINEER',
    "departmentId" TEXT,
    "managerId" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "dailyCapacityHours" DOUBLE PRECISION NOT NULL DEFAULT 8,
    "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "avatarColor" TEXT NOT NULL DEFAULT '#2f5fd8',
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "core_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "userAgent" TEXT,
    "ip" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "core_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core_roles" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "core_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core_permissions" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "core_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core_role_permissions" (
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,

    CONSTRAINT "core_role_permissions_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "core_role_assignments" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "scopeType" "ScopeType" NOT NULL,
    "scopeId" TEXT,
    "grantedBy" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "core_role_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core_audit_logs" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "module" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "diff" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "core_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core_domain_events" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "actorId" TEXT,
    "status" "EventStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "core_domain_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core_notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL DEFAULT 'IN_APP',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "core_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core_module_registry" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "status" "ModuleStatus" NOT NULL DEFAULT 'COMING_SOON',
    "plannedFor" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "core_module_registry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core_leaves" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "reason" TEXT,
    "status" "LeaveStatus" NOT NULL DEFAULT 'APPROVED',
    "sourceModule" TEXT NOT NULL DEFAULT 'pm',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "core_leaves_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pm_projects" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "clientName" TEXT NOT NULL,
    "poNumber" TEXT,
    "orderValue" DECIMAL(14,2),
    "panelType" TEXT,
    "panelCount" INTEGER NOT NULL DEFAULT 0,
    "status" "ProjectStatus" NOT NULL DEFAULT 'DRAFT',
    "priority" "ProjectPriority" NOT NULL DEFAULT 'MEDIUM',
    "startDate" DATE,
    "targetEndDate" DATE,
    "actualEndDate" DATE,
    "managerId" TEXT NOT NULL,
    "sponsorId" TEXT,
    "departmentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pm_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pm_project_members" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "ProjectRole" NOT NULL DEFAULT 'ENGINEER',
    "allocationPercent" INTEGER NOT NULL DEFAULT 100,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pm_project_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pm_milestones" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dueDate" DATE NOT NULL,
    "reachedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pm_milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pm_tasks" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "parentId" TEXT,
    "milestoneId" TEXT,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" "TaskType" NOT NULL DEFAULT 'PROJECT',
    "status" "TaskStatus" NOT NULL DEFAULT 'TODO',
    "priority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
    "estimatedHours" DOUBLE PRECISION NOT NULL DEFAULT 8,
    "actualHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "percentComplete" INTEGER NOT NULL DEFAULT 0,
    "plannedStart" DATE,
    "plannedEnd" DATE,
    "actualStart" TIMESTAMP(3),
    "actualEnd" TIMESTAMP(3),
    "requiredSkills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pm_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pm_task_dependencies" (
    "id" TEXT NOT NULL,
    "predecessorId" TEXT NOT NULL,
    "successorId" TEXT NOT NULL,
    "type" "DependencyType" NOT NULL DEFAULT 'FINISH_TO_START',
    "lagDays" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pm_task_dependencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pm_task_assignments" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "AssignmentRole" NOT NULL DEFAULT 'OWNER',
    "status" "AssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "allocatedHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "assignedById" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),

    CONSTRAINT "pm_task_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pm_task_handovers" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "remainingPercent" INTEGER NOT NULL,
    "remainingHours" DOUBLE PRECISION NOT NULL,
    "status" "HandoverStatus" NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pm_task_handovers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pm_task_progress_logs" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "percentComplete" INTEGER NOT NULL,
    "hoursSpent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "note" TEXT NOT NULL,
    "blocker" TEXT,
    "loggedFor" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pm_task_progress_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pm_task_comments" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pm_task_comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "core_companies_code_key" ON "core_companies"("code");

-- CreateIndex
CREATE INDEX "core_departments_parentId_idx" ON "core_departments"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "core_departments_companyId_code_key" ON "core_departments"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "core_users_employeeCode_key" ON "core_users"("employeeCode");

-- CreateIndex
CREATE UNIQUE INDEX "core_users_email_key" ON "core_users"("email");

-- CreateIndex
CREATE INDEX "core_users_companyId_idx" ON "core_users"("companyId");

-- CreateIndex
CREATE INDEX "core_users_departmentId_idx" ON "core_users"("departmentId");

-- CreateIndex
CREATE INDEX "core_users_managerId_idx" ON "core_users"("managerId");

-- CreateIndex
CREATE UNIQUE INDEX "core_sessions_tokenId_key" ON "core_sessions"("tokenId");

-- CreateIndex
CREATE INDEX "core_sessions_userId_idx" ON "core_sessions"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "core_roles_key_key" ON "core_roles"("key");

-- CreateIndex
CREATE UNIQUE INDEX "core_permissions_key_key" ON "core_permissions"("key");

-- CreateIndex
CREATE INDEX "core_permissions_module_idx" ON "core_permissions"("module");

-- CreateIndex
CREATE INDEX "core_role_assignments_userId_idx" ON "core_role_assignments"("userId");

-- CreateIndex
CREATE INDEX "core_role_assignments_scopeType_scopeId_idx" ON "core_role_assignments"("scopeType", "scopeId");

-- CreateIndex
CREATE UNIQUE INDEX "core_role_assignments_userId_roleId_scopeType_scopeId_key" ON "core_role_assignments"("userId", "roleId", "scopeType", "scopeId");

-- CreateIndex
CREATE INDEX "core_audit_logs_entityType_entityId_idx" ON "core_audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "core_audit_logs_module_createdAt_idx" ON "core_audit_logs"("module", "createdAt");

-- CreateIndex
CREATE INDEX "core_audit_logs_actorId_idx" ON "core_audit_logs"("actorId");

-- CreateIndex
CREATE INDEX "core_domain_events_status_createdAt_idx" ON "core_domain_events"("status", "createdAt");

-- CreateIndex
CREATE INDEX "core_domain_events_name_idx" ON "core_domain_events"("name");

-- CreateIndex
CREATE INDEX "core_domain_events_entityType_entityId_idx" ON "core_domain_events"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "core_notifications_userId_readAt_idx" ON "core_notifications"("userId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "core_module_registry_key_key" ON "core_module_registry"("key");

-- CreateIndex
CREATE INDEX "core_leaves_userId_startDate_endDate_idx" ON "core_leaves"("userId", "startDate", "endDate");

-- CreateIndex
CREATE UNIQUE INDEX "pm_projects_code_key" ON "pm_projects"("code");

-- CreateIndex
CREATE INDEX "pm_projects_companyId_status_idx" ON "pm_projects"("companyId", "status");

-- CreateIndex
CREATE INDEX "pm_projects_managerId_idx" ON "pm_projects"("managerId");

-- CreateIndex
CREATE INDEX "pm_project_members_userId_idx" ON "pm_project_members"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "pm_project_members_projectId_userId_key" ON "pm_project_members"("projectId", "userId");

-- CreateIndex
CREATE INDEX "pm_milestones_projectId_idx" ON "pm_milestones"("projectId");

-- CreateIndex
CREATE INDEX "pm_tasks_projectId_status_idx" ON "pm_tasks"("projectId", "status");

-- CreateIndex
CREATE INDEX "pm_tasks_parentId_idx" ON "pm_tasks"("parentId");

-- CreateIndex
CREATE INDEX "pm_tasks_status_plannedEnd_idx" ON "pm_tasks"("status", "plannedEnd");

-- CreateIndex
CREATE UNIQUE INDEX "pm_tasks_projectId_code_key" ON "pm_tasks"("projectId", "code");

-- CreateIndex
CREATE INDEX "pm_task_dependencies_successorId_idx" ON "pm_task_dependencies"("successorId");

-- CreateIndex
CREATE UNIQUE INDEX "pm_task_dependencies_predecessorId_successorId_key" ON "pm_task_dependencies"("predecessorId", "successorId");

-- CreateIndex
CREATE INDEX "pm_task_assignments_taskId_status_idx" ON "pm_task_assignments"("taskId", "status");

-- CreateIndex
CREATE INDEX "pm_task_assignments_userId_status_idx" ON "pm_task_assignments"("userId", "status");

-- CreateIndex
CREATE INDEX "pm_task_handovers_taskId_idx" ON "pm_task_handovers"("taskId");

-- CreateIndex
CREATE INDEX "pm_task_handovers_toUserId_status_idx" ON "pm_task_handovers"("toUserId", "status");

-- CreateIndex
CREATE INDEX "pm_task_handovers_fromUserId_status_idx" ON "pm_task_handovers"("fromUserId", "status");

-- CreateIndex
CREATE INDEX "pm_task_progress_logs_taskId_createdAt_idx" ON "pm_task_progress_logs"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "pm_task_progress_logs_userId_loggedFor_idx" ON "pm_task_progress_logs"("userId", "loggedFor");

-- CreateIndex
CREATE INDEX "pm_task_comments_taskId_createdAt_idx" ON "pm_task_comments"("taskId", "createdAt");

-- AddForeignKey
ALTER TABLE "core_departments" ADD CONSTRAINT "core_departments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "core_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core_departments" ADD CONSTRAINT "core_departments_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "core_departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core_departments" ADD CONSTRAINT "core_departments_headId_fkey" FOREIGN KEY ("headId") REFERENCES "core_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core_users" ADD CONSTRAINT "core_users_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "core_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core_users" ADD CONSTRAINT "core_users_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "core_departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core_users" ADD CONSTRAINT "core_users_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "core_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core_sessions" ADD CONSTRAINT "core_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "core_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core_role_permissions" ADD CONSTRAINT "core_role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "core_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core_role_permissions" ADD CONSTRAINT "core_role_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "core_permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core_role_assignments" ADD CONSTRAINT "core_role_assignments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "core_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core_role_assignments" ADD CONSTRAINT "core_role_assignments_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "core_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core_audit_logs" ADD CONSTRAINT "core_audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "core_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core_notifications" ADD CONSTRAINT "core_notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "core_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core_leaves" ADD CONSTRAINT "core_leaves_userId_fkey" FOREIGN KEY ("userId") REFERENCES "core_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pm_projects" ADD CONSTRAINT "pm_projects_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "core_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pm_projects" ADD CONSTRAINT "pm_projects_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "core_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pm_projects" ADD CONSTRAINT "pm_projects_sponsorId_fkey" FOREIGN KEY ("sponsorId") REFERENCES "core_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pm_project_members" ADD CONSTRAINT "pm_project_members_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "pm_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pm_project_members" ADD CONSTRAINT "pm_project_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "core_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pm_milestones" ADD CONSTRAINT "pm_milestones_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "pm_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pm_tasks" ADD CONSTRAINT "pm_tasks_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "pm_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pm_tasks" ADD CONSTRAINT "pm_tasks_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "pm_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pm_tasks" ADD CONSTRAINT "pm_tasks_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "pm_milestones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pm_tasks" ADD CONSTRAINT "pm_tasks_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "core_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pm_task_dependencies" ADD CONSTRAINT "pm_task_dependencies_predecessorId_fkey" FOREIGN KEY ("predecessorId") REFERENCES "pm_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pm_task_dependencies" ADD CONSTRAINT "pm_task_dependencies_successorId_fkey" FOREIGN KEY ("successorId") REFERENCES "pm_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pm_task_assignments" ADD CONSTRAINT "pm_task_assignments_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "pm_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pm_task_assignments" ADD CONSTRAINT "pm_task_assignments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "core_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pm_task_handovers" ADD CONSTRAINT "pm_task_handovers_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "pm_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pm_task_handovers" ADD CONSTRAINT "pm_task_handovers_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "core_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pm_task_handovers" ADD CONSTRAINT "pm_task_handovers_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "core_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pm_task_handovers" ADD CONSTRAINT "pm_task_handovers_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "core_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pm_task_progress_logs" ADD CONSTRAINT "pm_task_progress_logs_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "pm_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pm_task_progress_logs" ADD CONSTRAINT "pm_task_progress_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "core_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pm_task_comments" ADD CONSTRAINT "pm_task_comments_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "pm_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pm_task_comments" ADD CONSTRAINT "pm_task_comments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "core_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
