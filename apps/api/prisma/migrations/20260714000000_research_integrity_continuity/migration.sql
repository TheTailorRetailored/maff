-- Research integrity, continuity, import, audit, and publication lifecycle.
ALTER TYPE "ProjectStatus" ADD VALUE IF NOT EXISTS 'waiting';
ALTER TYPE "ProjectStatus" ADD VALUE IF NOT EXISTS 'terminated';
ALTER TYPE "AgentRunStatus" ADD VALUE IF NOT EXISTS 'completed';
ALTER TYPE "AgentRole" ADD VALUE IF NOT EXISTS 'ImportAgent';
ALTER TYPE "AgentRole" ADD VALUE IF NOT EXISTS 'GraphAuditor';

CREATE TYPE "ComputedIndependence" AS ENUM ('self_check','fresh_context_same_project','author_disjoint','fully_disjoint_internal_referee','external_referee');
CREATE TYPE "ReviewAssignmentStatus" AS ENUM ('claimed','submitted','expired','cancelled');
CREATE TYPE "ReviewEvidenceStatus" AS ENUM ('unverified_legacy','assigned_valid','external_evidence','quarantined');
CREATE TYPE "ContributionType" AS ENUM ('created','authored','edited','integrated','repaired','computed','compiled','read','reviewed','triaged','approved_for_stage');
CREATE TYPE "ContinuationMode" AS ENUM ('same_chat','fresh_chat_recommended','fresh_chat_required','waiting_for_user','waiting_for_external_condition','terminal');
CREATE TYPE "ProjectImportStatus" AS ENUM ('staging','analyzed','committed','cancelled');
CREATE TYPE "ProjectAuditMode" AS ENUM ('invariant_check','release_audit','migration_audit','forensic_audit');
CREATE TYPE "ProjectAuditStatus" AS ENUM ('running','completed','failed');
CREATE TYPE "AuditFindingStatus" AS ENUM ('proposed','accepted','dismissed','repaired');
CREATE TYPE "RepairCampaignStatus" AS ENUM ('planned','active','awaiting_reaudit','completed','cancelled');
CREATE TYPE "RepairTaskStatus" AS ENUM ('planned','active','completed','blocked','cancelled');
CREATE TYPE "ArtifactVisibility" AS ENUM ('internal','reviewer','user_requested','published');
CREATE TYPE "PublicationPackageStatus" AS ENUM ('preparing','released','withdrawn');

ALTER TABLE "Artifact" ADD COLUMN "visibility" "ArtifactVisibility" NOT NULL DEFAULT 'internal';
ALTER TABLE "ReviewRound"
  ADD COLUMN "reviewAssignmentId" UUID,
  ADD COLUMN "evidenceStatus" "ReviewEvidenceStatus" NOT NULL DEFAULT 'unverified_legacy';
CREATE UNIQUE INDEX "ReviewRound_reviewAssignmentId_key" ON "ReviewRound"("reviewAssignmentId");

ALTER TABLE "ProofObligation"
  ADD COLUMN "assumptions" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "excludedRegimes" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "boundaryCases" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "semanticConsequences" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "authorAssertion" TEXT;

ALTER TABLE "ExternalReviewImport" ADD COLUMN "challengedAt" TIMESTAMP(3), ADD COLUMN "triagedAt" TIMESTAMP(3);
ALTER TABLE "Gap"
  ADD COLUMN "targetObjectType" TEXT,
  ADD COLUMN "targetObjectId" TEXT,
  ADD COLUMN "externalReviewId" UUID,
  ADD COLUMN "auditFindingId" UUID;

CREATE TABLE "ObjectContribution" (
  "id" UUID NOT NULL, "workspaceId" UUID NOT NULL, "projectId" UUID NOT NULL, "agentRunId" UUID NOT NULL,
  "objectType" TEXT NOT NULL, "objectId" TEXT NOT NULL, "versionHash" TEXT, "type" "ContributionType" NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ObjectContribution_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ObjectContribution_workspaceId_projectId_objectType_objectId_idx" ON "ObjectContribution"("workspaceId","projectId","objectType","objectId");
CREATE INDEX "ObjectContribution_agentRunId_type_idx" ON "ObjectContribution"("agentRunId","type");

CREATE TABLE "ObjectAccessEvidence" (
  "id" UUID NOT NULL, "workspaceId" UUID NOT NULL, "projectId" UUID NOT NULL, "agentRunId" UUID NOT NULL,
  "artifactId" UUID, "objectType" TEXT NOT NULL, "objectId" TEXT NOT NULL, "operation" TEXT NOT NULL,
  "contentHash" TEXT, "coverage" JSONB NOT NULL DEFAULT '{}', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ObjectAccessEvidence_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ObjectAccessEvidence_workspaceId_projectId_objectType_objectId_idx" ON "ObjectAccessEvidence"("workspaceId","projectId","objectType","objectId");
CREATE INDEX "ObjectAccessEvidence_agentRunId_createdAt_idx" ON "ObjectAccessEvidence"("agentRunId","createdAt");

CREATE TABLE "ReviewAssignment" (
  "id" UUID NOT NULL, "workspaceId" UUID NOT NULL, "projectId" UUID NOT NULL, "workstreamId" UUID NOT NULL,
  "manuscriptVersionId" UUID, "reviewType" "ReviewType" NOT NULL, "targetObjectType" TEXT NOT NULL,
  "targetObjectId" TEXT NOT NULL, "targetHash" TEXT, "reviewerRunId" UUID NOT NULL,
  "independence" "ComputedIndependence" NOT NULL, "eligibilitySnapshot" JSONB NOT NULL DEFAULT '{}',
  "sealedBriefingHash" TEXT NOT NULL, "permittedArtifactIds" JSONB NOT NULL DEFAULT '[]', "tokenHash" TEXT NOT NULL,
  "status" "ReviewAssignmentStatus" NOT NULL DEFAULT 'claimed', "leaseExpiresAt" TIMESTAMP(3) NOT NULL,
  "submittedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReviewAssignment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ReviewAssignment_tokenHash_key" ON "ReviewAssignment"("tokenHash");
CREATE INDEX "ReviewAssignment_workspaceId_projectId_status_reviewType_idx" ON "ReviewAssignment"("workspaceId","projectId","status","reviewType");
CREATE INDEX "ReviewAssignment_reviewerRunId_status_idx" ON "ReviewAssignment"("reviewerRunId","status");

CREATE TABLE "ReviewEvidenceSection" (
  "id" UUID NOT NULL, "workspaceId" UUID NOT NULL, "projectId" UUID NOT NULL, "reviewRoundId" UUID NOT NULL,
  "sectionType" TEXT NOT NULL, "conclusion" TEXT NOT NULL, "evidenceMarkdown" TEXT NOT NULL,
  "checkedRefs" JSONB NOT NULL DEFAULT '[]', "externalSources" JSONB NOT NULL DEFAULT '[]',
  "attackCategories" JSONB NOT NULL DEFAULT '[]', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReviewEvidenceSection_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ReviewEvidenceSection_workspaceId_reviewRoundId_sectionType_idx" ON "ReviewEvidenceSection"("workspaceId","reviewRoundId","sectionType");

CREATE TABLE "RunOutcome" (
  "id" UUID NOT NULL, "workspaceId" UUID NOT NULL, "projectId" UUID NOT NULL, "agentRunId" UUID NOT NULL,
  "completedWork" JSONB NOT NULL, "changedObjects" JSONB NOT NULL, "evidenceGenerated" JSONB NOT NULL,
  "checksPerformed" JSONB NOT NULL, "problemsEncountered" JSONB NOT NULL, "unresolvedUncertainty" JSONB NOT NULL,
  "gapsCreated" JSONB NOT NULL, "gapsResolved" JSONB NOT NULL, "nextAction" JSONB NOT NULL,
  "continuationMode" "ContinuationMode" NOT NULL, "continuationReason" TEXT NOT NULL, "userPrompt" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "RunOutcome_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RunOutcome_agentRunId_key" ON "RunOutcome"("agentRunId");
CREATE INDEX "RunOutcome_workspaceId_projectId_createdAt_idx" ON "RunOutcome"("workspaceId","projectId","createdAt");

CREATE TABLE "ProjectWaitingState" (
  "id" UUID NOT NULL, "workspaceId" UUID NOT NULL, "projectId" UUID NOT NULL, "reason" TEXT NOT NULL,
  "unblockCondition" TEXT NOT NULL, "ownerRole" "AgentRole", "active" BOOLEAN NOT NULL DEFAULT true,
  "resolvedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectWaitingState_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProjectWaitingState_workspaceId_projectId_active_idx" ON "ProjectWaitingState"("workspaceId","projectId","active");

CREATE TABLE "ProjectImport" (
  "id" UUID NOT NULL, "workspaceId" UUID NOT NULL, "projectId" UUID, "title" TEXT NOT NULL,
  "provenance" JSONB NOT NULL, "artifactIds" JSONB NOT NULL DEFAULT '[]', "proposedMap" JSONB NOT NULL DEFAULT '{}',
  "userCorrections" JSONB NOT NULL DEFAULT '{}', "status" "ProjectImportStatus" NOT NULL DEFAULT 'staging',
  "committedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "ProjectImport_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProjectImport_workspaceId_status_createdAt_idx" ON "ProjectImport"("workspaceId","status","createdAt");

CREATE TABLE "ProjectAudit" (
  "id" UUID NOT NULL, "workspaceId" UUID NOT NULL, "projectId" UUID NOT NULL, "mode" "ProjectAuditMode" NOT NULL,
  "status" "ProjectAuditStatus" NOT NULL DEFAULT 'running', "auditorRunId" UUID, "graphSnapshotHash" TEXT NOT NULL,
  "policyVersion" TEXT NOT NULL, "storedReadiness" JSONB NOT NULL, "reconstructedReadiness" JSONB NOT NULL,
  "summaryMarkdown" TEXT NOT NULL, "noProjectMutation" BOOLEAN NOT NULL DEFAULT true, "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "ProjectAudit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProjectAudit_workspaceId_projectId_mode_createdAt_idx" ON "ProjectAudit"("workspaceId","projectId","mode","createdAt");

CREATE TABLE "AuditFinding" (
  "id" UUID NOT NULL, "workspaceId" UUID NOT NULL, "projectId" UUID NOT NULL, "auditId" UUID NOT NULL,
  "severity" TEXT NOT NULL, "category" TEXT NOT NULL, "title" TEXT NOT NULL, "descriptionMarkdown" TEXT NOT NULL,
  "targetObjectType" TEXT, "targetObjectId" TEXT, "evidence" JSONB NOT NULL DEFAULT '[]', "proposedRepair" TEXT,
  "status" "AuditFindingStatus" NOT NULL DEFAULT 'proposed', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "AuditFinding_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AuditFinding_workspaceId_projectId_status_severity_idx" ON "AuditFinding"("workspaceId","projectId","status","severity");

CREATE TABLE "RepairCampaign" (
  "id" UUID NOT NULL, "workspaceId" UUID NOT NULL, "projectId" UUID NOT NULL, "auditId" UUID, "title" TEXT NOT NULL,
  "status" "RepairCampaignStatus" NOT NULL DEFAULT 'planned', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "RepairCampaign_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RepairCampaign_workspaceId_projectId_status_idx" ON "RepairCampaign"("workspaceId","projectId","status");

CREATE TABLE "RepairTask" (
  "id" UUID NOT NULL, "workspaceId" UUID NOT NULL, "projectId" UUID NOT NULL, "campaignId" UUID NOT NULL,
  "auditFindingId" UUID, "gapId" UUID, "workstreamId" UUID, "title" TEXT NOT NULL, "instructions" TEXT NOT NULL,
  "priority" INTEGER NOT NULL DEFAULT 0, "status" "RepairTaskStatus" NOT NULL DEFAULT 'planned',
  "successCondition" TEXT NOT NULL, "killCondition" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "RepairTask_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RepairTask_workspaceId_projectId_status_priority_idx" ON "RepairTask"("workspaceId","projectId","status","priority");

CREATE TABLE "PublicationPackage" (
  "id" UUID NOT NULL, "workspaceId" UUID NOT NULL, "projectId" UUID NOT NULL, "manuscriptVersionId" UUID NOT NULL,
  "sourceArtifactId" UUID NOT NULL, "pdfArtifactId" UUID NOT NULL, "supplementaryArtifactIds" JSONB NOT NULL DEFAULT '[]',
  "buildManifest" JSONB NOT NULL, "packageHash" TEXT NOT NULL, "status" "PublicationPackageStatus" NOT NULL DEFAULT 'preparing',
  "releasedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PublicationPackage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PublicationPackage_projectId_packageHash_key" ON "PublicationPackage"("projectId","packageHash");
CREATE INDEX "PublicationPackage_workspaceId_projectId_status_idx" ON "PublicationPackage"("workspaceId","projectId","status");

CREATE TABLE "ReadinessSnapshot" (
  "id" UUID NOT NULL, "workspaceId" UUID NOT NULL, "projectId" UUID NOT NULL, "manuscriptVersionId" UUID,
  "policyVersion" TEXT NOT NULL, "assessment" JSONB NOT NULL, "assessmentHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "ReadinessSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ReadinessSnapshot_workspaceId_projectId_createdAt_idx" ON "ReadinessSnapshot"("workspaceId","projectId","createdAt");

ALTER TABLE "ObjectContribution" ADD CONSTRAINT "ObjectContribution_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE;
ALTER TABLE "ObjectContribution" ADD CONSTRAINT "ObjectContribution_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE;
ALTER TABLE "ObjectContribution" ADD CONSTRAINT "ObjectContribution_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE CASCADE;
ALTER TABLE "ObjectAccessEvidence" ADD CONSTRAINT "ObjectAccessEvidence_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE;
ALTER TABLE "ObjectAccessEvidence" ADD CONSTRAINT "ObjectAccessEvidence_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE;
ALTER TABLE "ObjectAccessEvidence" ADD CONSTRAINT "ObjectAccessEvidence_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE CASCADE;
ALTER TABLE "ObjectAccessEvidence" ADD CONSTRAINT "ObjectAccessEvidence_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "Artifact"("id") ON DELETE SET NULL;
ALTER TABLE "ReviewAssignment" ADD CONSTRAINT "ReviewAssignment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE;
ALTER TABLE "ReviewAssignment" ADD CONSTRAINT "ReviewAssignment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE;
ALTER TABLE "ReviewAssignment" ADD CONSTRAINT "ReviewAssignment_reviewerRunId_fkey" FOREIGN KEY ("reviewerRunId") REFERENCES "AgentRun"("id") ON DELETE CASCADE;
ALTER TABLE "ReviewAssignment" ADD CONSTRAINT "ReviewAssignment_workstreamId_fkey" FOREIGN KEY ("workstreamId") REFERENCES "Workstream"("id") ON DELETE CASCADE;
ALTER TABLE "ReviewAssignment" ADD CONSTRAINT "ReviewAssignment_manuscriptVersionId_fkey" FOREIGN KEY ("manuscriptVersionId") REFERENCES "ManuscriptVersion"("id") ON DELETE SET NULL;
ALTER TABLE "ReviewRound" ADD CONSTRAINT "ReviewRound_reviewAssignmentId_fkey" FOREIGN KEY ("reviewAssignmentId") REFERENCES "ReviewAssignment"("id") ON DELETE SET NULL;
ALTER TABLE "ReviewEvidenceSection" ADD CONSTRAINT "ReviewEvidenceSection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE;
ALTER TABLE "ReviewEvidenceSection" ADD CONSTRAINT "ReviewEvidenceSection_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE;
ALTER TABLE "ReviewEvidenceSection" ADD CONSTRAINT "ReviewEvidenceSection_reviewRoundId_fkey" FOREIGN KEY ("reviewRoundId") REFERENCES "ReviewRound"("id") ON DELETE CASCADE;
ALTER TABLE "RunOutcome" ADD CONSTRAINT "RunOutcome_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE;
ALTER TABLE "RunOutcome" ADD CONSTRAINT "RunOutcome_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE;
ALTER TABLE "RunOutcome" ADD CONSTRAINT "RunOutcome_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE CASCADE;
ALTER TABLE "ProjectWaitingState" ADD CONSTRAINT "ProjectWaitingState_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE;
ALTER TABLE "ProjectWaitingState" ADD CONSTRAINT "ProjectWaitingState_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE;
ALTER TABLE "ProjectImport" ADD CONSTRAINT "ProjectImport_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE;
ALTER TABLE "ProjectImport" ADD CONSTRAINT "ProjectImport_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL;
ALTER TABLE "ProjectAudit" ADD CONSTRAINT "ProjectAudit_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE;
ALTER TABLE "ProjectAudit" ADD CONSTRAINT "ProjectAudit_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE;
ALTER TABLE "ProjectAudit" ADD CONSTRAINT "ProjectAudit_auditorRunId_fkey" FOREIGN KEY ("auditorRunId") REFERENCES "AgentRun"("id") ON DELETE SET NULL;
ALTER TABLE "AuditFinding" ADD CONSTRAINT "AuditFinding_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE;
ALTER TABLE "AuditFinding" ADD CONSTRAINT "AuditFinding_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE;
ALTER TABLE "AuditFinding" ADD CONSTRAINT "AuditFinding_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "ProjectAudit"("id") ON DELETE CASCADE;
ALTER TABLE "Gap" ADD CONSTRAINT "Gap_externalReviewId_fkey" FOREIGN KEY ("externalReviewId") REFERENCES "ExternalReviewImport"("id") ON DELETE SET NULL;
ALTER TABLE "Gap" ADD CONSTRAINT "Gap_auditFindingId_fkey" FOREIGN KEY ("auditFindingId") REFERENCES "AuditFinding"("id") ON DELETE SET NULL;
ALTER TABLE "RepairCampaign" ADD CONSTRAINT "RepairCampaign_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE;
ALTER TABLE "RepairCampaign" ADD CONSTRAINT "RepairCampaign_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE;
ALTER TABLE "RepairCampaign" ADD CONSTRAINT "RepairCampaign_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "ProjectAudit"("id") ON DELETE SET NULL;
ALTER TABLE "RepairTask" ADD CONSTRAINT "RepairTask_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE;
ALTER TABLE "RepairTask" ADD CONSTRAINT "RepairTask_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE;
ALTER TABLE "RepairTask" ADD CONSTRAINT "RepairTask_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "RepairCampaign"("id") ON DELETE CASCADE;
ALTER TABLE "RepairTask" ADD CONSTRAINT "RepairTask_auditFindingId_fkey" FOREIGN KEY ("auditFindingId") REFERENCES "AuditFinding"("id") ON DELETE SET NULL;
ALTER TABLE "RepairTask" ADD CONSTRAINT "RepairTask_gapId_fkey" FOREIGN KEY ("gapId") REFERENCES "Gap"("id") ON DELETE SET NULL;
ALTER TABLE "RepairTask" ADD CONSTRAINT "RepairTask_workstreamId_fkey" FOREIGN KEY ("workstreamId") REFERENCES "Workstream"("id") ON DELETE SET NULL;
ALTER TABLE "PublicationPackage" ADD CONSTRAINT "PublicationPackage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE;
ALTER TABLE "PublicationPackage" ADD CONSTRAINT "PublicationPackage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE;
ALTER TABLE "PublicationPackage" ADD CONSTRAINT "PublicationPackage_manuscriptVersionId_fkey" FOREIGN KEY ("manuscriptVersionId") REFERENCES "ManuscriptVersion"("id") ON DELETE CASCADE;
ALTER TABLE "PublicationPackage" ADD CONSTRAINT "PublicationPackage_sourceArtifactId_fkey" FOREIGN KEY ("sourceArtifactId") REFERENCES "Artifact"("id") ON DELETE RESTRICT;
ALTER TABLE "PublicationPackage" ADD CONSTRAINT "PublicationPackage_pdfArtifactId_fkey" FOREIGN KEY ("pdfArtifactId") REFERENCES "Artifact"("id") ON DELETE RESTRICT;
ALTER TABLE "ReadinessSnapshot" ADD CONSTRAINT "ReadinessSnapshot_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE;
ALTER TABLE "ReadinessSnapshot" ADD CONSTRAINT "ReadinessSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE;
ALTER TABLE "ReadinessSnapshot" ADD CONSTRAINT "ReadinessSnapshot_manuscriptVersionId_fkey" FOREIGN KEY ("manuscriptVersionId") REFERENCES "ManuscriptVersion"("id") ON DELETE SET NULL;

-- Existing internal approvals remain historical and evidence-only until a migration audit can prove provenance.
UPDATE "ReviewRound" SET "evidenceStatus" = 'quarantined' WHERE "createdByAgentRunId" IS NULL AND "reviewType" <> 'legacy_unspecified';
