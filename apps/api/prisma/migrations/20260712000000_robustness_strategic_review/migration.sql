-- Maff robustness and strategic-review layer. Additive migration: no historical review is upgraded.
CREATE TYPE "ManuscriptVerificationState" AS ENUM ('unverified_candidate','ledger_complete','mathematically_reviewed');
CREATE TYPE "ManuscriptFreezeLevel" AS ENUM ('none','lexical','interface','mathematical');
CREATE TYPE "ExternalReviewProvenance" AS ENUM ('human','journal_referee','fresh_external_ai_chat','internal_maff_agent','unknown');
CREATE TYPE "StrategicReviewVerdict" AS ENUM ('continue','continue_with_rebase','split','pivot','pause','terminate');
CREATE TYPE "BranchState" AS ENUM ('mainline','exploratory','paused','killed','spinout_candidate');

ALTER TABLE "Project"
  ADD COLUMN "strategicReviewInterval" INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN "strategicReviewHardLimit" INTEGER NOT NULL DEFAULT 15;

ALTER TABLE "ManuscriptVersion"
  ADD COLUMN "verificationState" "ManuscriptVerificationState" NOT NULL DEFAULT 'unverified_candidate',
  ADD COLUMN "freezeLevel" "ManuscriptFreezeLevel" NOT NULL DEFAULT 'none',
  ADD COLUMN "lexicalFrozenAt" TIMESTAMP(3),
  ADD COLUMN "interfaceFrozenAt" TIMESTAMP(3),
  ADD COLUMN "mathematicalFrozenAt" TIMESTAMP(3);

ALTER TABLE "ProofObligation"
  ADD COLUMN "dependencies" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "proofLocation" TEXT,
  ADD COLUMN "externalTheorems" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "externalAssumptionsMatched" BOOLEAN,
  ADD COLUMN "exactManuscriptProofPresent" BOOLEAN;

CREATE TABLE "ExternalReviewImport" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "manuscriptVersionId" UUID,
  "theoremOrArtifactRef" TEXT NOT NULL,
  "originalReviewText" TEXT NOT NULL,
  "originalReviewUri" TEXT,
  "provenance" "ExternalReviewProvenance" NOT NULL,
  "reviewerIdentity" TEXT,
  "independenceStatement" TEXT NOT NULL,
  "reviewScope" TEXT NOT NULL,
  "verdict" "ReviewVerdict" NOT NULL,
  "issues" JSONB NOT NULL DEFAULT '[]',
  "requiredChanges" JSONB NOT NULL DEFAULT '[]',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExternalReviewImport_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ExternalReviewImport_workspaceId_projectId_createdAt_idx" ON "ExternalReviewImport"("workspaceId", "projectId", "createdAt");
CREATE INDEX "ExternalReviewImport_workspaceId_manuscriptVersionId_idx" ON "ExternalReviewImport"("workspaceId", "manuscriptVersionId");
ALTER TABLE "ExternalReviewImport" ADD CONSTRAINT "ExternalReviewImport_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE;
ALTER TABLE "ExternalReviewImport" ADD CONSTRAINT "ExternalReviewImport_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE;
ALTER TABLE "ExternalReviewImport" ADD CONSTRAINT "ExternalReviewImport_manuscriptVersionId_fkey" FOREIGN KEY ("manuscriptVersionId") REFERENCES "ManuscriptVersion"("id") ON DELETE SET NULL;

CREATE TABLE "ProjectEpoch" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "number" INTEGER NOT NULL,
  "substantiveActionCount" INTEGER NOT NULL DEFAULT 0,
  "strategicReviewQueuedAt" TIMESTAMP(3),
  "strategicReviewCompletedAt" TIMESTAMP(3),
  "downstreamPausedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectEpoch_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProjectEpoch_projectId_number_key" ON "ProjectEpoch"("projectId", "number");
CREATE INDEX "ProjectEpoch_workspaceId_projectId_createdAt_idx" ON "ProjectEpoch"("workspaceId", "projectId", "createdAt");
ALTER TABLE "ProjectEpoch" ADD CONSTRAINT "ProjectEpoch_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE;
ALTER TABLE "ProjectEpoch" ADD CONSTRAINT "ProjectEpoch_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE;

CREATE TABLE "ProjectSubstantiveAction" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "projectEpochId" UUID NOT NULL,
  "actionType" TEXT NOT NULL,
  "targetType" TEXT,
  "targetId" TEXT,
  "meaningfulDelta" BOOLEAN NOT NULL DEFAULT false,
  "summary" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectSubstantiveAction_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProjectSubstantiveAction_workspaceId_projectEpochId_createdAt_idx" ON "ProjectSubstantiveAction"("workspaceId", "projectEpochId", "createdAt");
ALTER TABLE "ProjectSubstantiveAction" ADD CONSTRAINT "ProjectSubstantiveAction_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE;
ALTER TABLE "ProjectSubstantiveAction" ADD CONSTRAINT "ProjectSubstantiveAction_projectEpochId_fkey" FOREIGN KEY ("projectEpochId") REFERENCES "ProjectEpoch"("id") ON DELETE CASCADE;

CREATE TABLE "StrategicReviewRound" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "projectEpochId" UUID,
  "verdict" "StrategicReviewVerdict" NOT NULL,
  "reviewerIndependence" TEXT NOT NULL,
  "whatChangedMarkdown" TEXT NOT NULL,
  "loopDiagnosisMarkdown" TEXT NOT NULL,
  "blockerStructureMarkdown" TEXT NOT NULL,
  "alternativesMarkdown" TEXT NOT NULL,
  "branchAllocation" JSONB NOT NULL DEFAULT '[]',
  "nextMoves" JSONB NOT NULL DEFAULT '[]',
  "probabilityEstimates" JSONB NOT NULL DEFAULT '[]',
  "metrics" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StrategicReviewRound_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "StrategicReviewRound_workspaceId_projectId_createdAt_idx" ON "StrategicReviewRound"("workspaceId", "projectId", "createdAt");
ALTER TABLE "StrategicReviewRound" ADD CONSTRAINT "StrategicReviewRound_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE;
ALTER TABLE "StrategicReviewRound" ADD CONSTRAINT "StrategicReviewRound_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE;
ALTER TABLE "StrategicReviewRound" ADD CONSTRAINT "StrategicReviewRound_projectEpochId_fkey" FOREIGN KEY ("projectEpochId") REFERENCES "ProjectEpoch"("id") ON DELETE SET NULL;

CREATE TABLE "ProjectBranch" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "title" TEXT NOT NULL,
  "state" "BranchState" NOT NULL DEFAULT 'exploratory',
  "rationaleMarkdown" TEXT,
  "targetObjectType" TEXT,
  "targetObjectId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectBranch_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProjectBranch_workspaceId_projectId_state_idx" ON "ProjectBranch"("workspaceId", "projectId", "state");
ALTER TABLE "ProjectBranch" ADD CONSTRAINT "ProjectBranch_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE;
ALTER TABLE "ProjectBranch" ADD CONSTRAINT "ProjectBranch_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE;
