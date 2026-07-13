-- Initial schema baseline reconstructed from the schema immediately preceding
-- 20260509000000_maff_v2_runtime so fresh databases can use migrate deploy.
CREATE TYPE "WorkspaceType" AS ENUM ('private', 'shared');
CREATE TYPE "WorkspaceRole" AS ENUM ('owner', 'editor', 'viewer', 'admin');
CREATE TYPE "JobType" AS ENUM ('quartz_build', 'lean_check', 'lean_stub', 'lean_proof_attempt', 'index_rebuild');
CREATE TYPE "JobStatus" AS ENUM ('queued', 'running', 'succeeded', 'failed', 'cancelled');

CREATE TABLE "User" (
  "id" UUID NOT NULL,
  "auth0Sub" TEXT NOT NULL,
  "email" TEXT,
  "displayName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Workspace" (
  "id" UUID NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" "WorkspaceType" NOT NULL,
  "ownerUserId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "WorkspaceMember" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "role" "WorkspaceRole" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkspaceMember_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "NodeIndex" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "nodeId" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "area" TEXT,
  "path" TEXT NOT NULL,
  "metadata" JSONB NOT NULL,
  "bodyPreview" TEXT NOT NULL,
  "createdAtFromFrontmatter" TIMESTAMP(3),
  "updatedAtFromFrontmatter" TIMESTAMP(3),
  "indexedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "stale" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "NodeIndex_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "EdgeIndex" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "sourceNodeId" TEXT NOT NULL,
  "targetNodeRef" TEXT NOT NULL,
  "targetNodeId" TEXT,
  "edgeType" TEXT NOT NULL,
  "sourceField" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EdgeIndex_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "TaskIndex" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "nodeId" TEXT NOT NULL,
  "targetNodeId" TEXT,
  "targetSection" TEXT,
  "workflow" TEXT NOT NULL,
  "title" TEXT NOT NULL DEFAULT '',
  "instructions" TEXT NOT NULL DEFAULT '',
  "priority" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'open',
  "assignedToUserId" UUID,
  "claimedSessionId" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "snoozedUntil" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TaskIndex_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Job" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "type" "JobType" NOT NULL,
  "status" "JobStatus" NOT NULL DEFAULT 'queued',
  "input" JSONB NOT NULL,
  "output" JSONB,
  "error" TEXT,
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "AuditLog" (
  "id" UUID NOT NULL,
  "workspaceId" UUID,
  "userId" UUID,
  "action" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT,
  "details" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "LocalTheorem" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "leanName" TEXT NOT NULL,
  "statement" TEXT NOT NULL,
  "proofFile" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "nodeId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LocalTheorem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_auth0Sub_key" ON "User"("auth0Sub");
CREATE UNIQUE INDEX "Workspace_slug_key" ON "Workspace"("slug");
CREATE UNIQUE INDEX "WorkspaceMember_workspaceId_userId_key" ON "WorkspaceMember"("workspaceId", "userId");
CREATE INDEX "NodeIndex_workspaceId_type_status_idx" ON "NodeIndex"("workspaceId", "type", "status");
CREATE UNIQUE INDEX "NodeIndex_workspaceId_nodeId_key" ON "NodeIndex"("workspaceId", "nodeId");
CREATE INDEX "EdgeIndex_workspaceId_sourceNodeId_idx" ON "EdgeIndex"("workspaceId", "sourceNodeId");
CREATE UNIQUE INDEX "EdgeIndex_workspaceId_sourceNodeId_targetNodeRef_edgeType_key" ON "EdgeIndex"("workspaceId", "sourceNodeId", "targetNodeRef", "edgeType");
CREATE INDEX "TaskIndex_workspaceId_status_priority_idx" ON "TaskIndex"("workspaceId", "status", "priority");
CREATE UNIQUE INDEX "TaskIndex_workspaceId_nodeId_key" ON "TaskIndex"("workspaceId", "nodeId");

ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NodeIndex" ADD CONSTRAINT "NodeIndex_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EdgeIndex" ADD CONSTRAINT "EdgeIndex_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskIndex" ADD CONSTRAINT "TaskIndex_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskIndex" ADD CONSTRAINT "TaskIndex_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Job" ADD CONSTRAINT "Job_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Job" ADD CONSTRAINT "Job_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LocalTheorem" ADD CONSTRAINT "LocalTheorem_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
