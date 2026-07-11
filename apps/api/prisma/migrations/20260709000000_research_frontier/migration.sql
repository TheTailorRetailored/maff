-- CreateEnum
CREATE TYPE "ResearchConfidence" AS ENUM ('low', 'medium', 'high');

-- CreateEnum
CREATE TYPE "MechanismStatus" AS ENUM ('seed', 'explored', 'active', 'reusable', 'killed', 'archived');

-- CreateEnum
CREATE TYPE "MechanismMaturity" AS ENUM ('seed', 'sketched', 'tested', 'sharpened', 'usable', 'paper_ready');

-- CreateEnum
CREATE TYPE "SpinoutStatus" AS ENUM ('seed', 'plausible', 'active', 'promoted', 'killed', 'archived');

-- CreateEnum
CREATE TYPE "AssumptionRegimeStatus" AS ENUM ('seed', 'active', 'deprecated', 'impossible', 'archived');

-- CreateEnum
CREATE TYPE "TheoremContractStatus" AS ENUM ('draft', 'active', 'narrowed', 'proved_informally', 'refuted', 'paused', 'archived');

-- CreateEnum
CREATE TYPE "ResearchArtifactKind" AS ENUM ('paper_draft', 'proof_skeleton', 'survey_memo', 'verification_script', 'experiment_notebook', 'counterexample_catalogue', 'formalization_stub', 'lean_stub', 'theorem_map', 'exposition_note', 'migration_report', 'other');

-- CreateEnum
CREATE TYPE "ResearchArtifactStatus" AS ENUM ('draft', 'active', 'reviewed', 'archived');

-- CreateTable
CREATE TABLE "ResearchDelta" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "title" TEXT NOT NULL,
    "summaryMarkdown" TEXT NOT NULL,
    "whatChangedMarkdown" TEXT NOT NULL,
    "mainlineEffectMarkdown" TEXT,
    "reusableIdeasMarkdown" TEXT,
    "blockersMarkdown" TEXT,
    "nextMoveMarkdown" TEXT,
    "confidence" "ResearchConfidence",
    "createdByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ResearchDelta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mechanism" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "MechanismStatus" NOT NULL DEFAULT 'seed',
    "maturity" "MechanismMaturity" NOT NULL DEFAULT 'seed',
    "centralityScore" INTEGER,
    "portabilityScore" INTEGER,
    "tractabilityScore" INTEGER,
    "noveltyScore" INTEGER,
    "loadBearingScore" INTEGER,
    "descriptionMarkdown" TEXT NOT NULL,
    "coreIdeaMarkdown" TEXT,
    "whereItWorkedMarkdown" TEXT,
    "whereItFailedMarkdown" TEXT,
    "possibleTransfersMarkdown" TEXT,
    "killConditionsMarkdown" TEXT,
    "createdByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Mechanism_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpinoutCandidate" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "originProjectId" UUID,
    "promotedProjectId" UUID,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "SpinoutStatus" NOT NULL DEFAULT 'seed',
    "statementSketchMarkdown" TEXT NOT NULL,
    "whyInterestingMarkdown" TEXT,
    "relationToOriginMarkdown" TEXT,
    "cheapestNextTestMarkdown" TEXT,
    "possiblePayoffMarkdown" TEXT,
    "riskMarkdown" TEXT,
    "createdByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SpinoutCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssumptionRegime" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "AssumptionRegimeStatus" NOT NULL DEFAULT 'seed',
    "descriptionMarkdown" TEXT NOT NULL,
    "formalStatementMarkdown" TEXT,
    "includesMarkdown" TEXT,
    "excludesMarkdown" TEXT,
    "motivationMarkdown" TEXT,
    "createdByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AssumptionRegime_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TheoremContract" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "TheoremContractStatus" NOT NULL DEFAULT 'draft',
    "theoremStatementMarkdown" TEXT NOT NULL,
    "assumptionsMarkdown" TEXT,
    "conclusionMarkdown" TEXT,
    "knownDependenciesMarkdown" TEXT,
    "knownBlockersMarkdown" TEXT,
    "proofStrategyMarkdown" TEXT,
    "currentBestVersionMarkdown" TEXT,
    "confidence" "ResearchConfidence",
    "createdByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TheoremContract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchFrontierSnapshot" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID,
    "title" TEXT NOT NULL,
    "snapshotMarkdown" TEXT NOT NULL,
    "strongestCurrentTheoremMarkdown" TEXT,
    "strongestConditionalTheoremMarkdown" TEXT,
    "activeBlockersMarkdown" TEXT,
    "activeMechanismsMarkdown" TEXT,
    "spinoutsMarkdown" TEXT,
    "deadOrPausedBranchesMarkdown" TEXT,
    "recommendedNextMovesMarkdown" TEXT,
    "source" TEXT,
    "createdByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResearchFrontierSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchArtifact" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "kind" "ResearchArtifactKind" NOT NULL DEFAULT 'other',
    "status" "ResearchArtifactStatus" NOT NULL DEFAULT 'draft',
    "descriptionMarkdown" TEXT,
    "contentMarkdown" TEXT,
    "filePath" TEXT,
    "url" TEXT,
    "createdByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ResearchArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchLink" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "relationType" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "noteMarkdown" TEXT,
    "confidence" "ResearchConfidence",
    "createdByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResearchLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ResearchDelta_workspaceId_idx" ON "ResearchDelta"("workspaceId");
CREATE INDEX "ResearchDelta_workspaceId_projectId_idx" ON "ResearchDelta"("workspaceId", "projectId");
CREATE INDEX "ResearchDelta_workspaceId_sourceType_sourceId_idx" ON "ResearchDelta"("workspaceId", "sourceType", "sourceId");
CREATE INDEX "ResearchDelta_workspaceId_createdAt_idx" ON "ResearchDelta"("workspaceId", "createdAt");
CREATE UNIQUE INDEX "Mechanism_workspaceId_slug_key" ON "Mechanism"("workspaceId", "slug");
CREATE INDEX "Mechanism_workspaceId_idx" ON "Mechanism"("workspaceId");
CREATE INDEX "Mechanism_workspaceId_projectId_idx" ON "Mechanism"("workspaceId", "projectId");
CREATE INDEX "Mechanism_workspaceId_status_idx" ON "Mechanism"("workspaceId", "status");
CREATE INDEX "Mechanism_workspaceId_maturity_idx" ON "Mechanism"("workspaceId", "maturity");
CREATE UNIQUE INDEX "SpinoutCandidate_workspaceId_slug_key" ON "SpinoutCandidate"("workspaceId", "slug");
CREATE INDEX "SpinoutCandidate_workspaceId_idx" ON "SpinoutCandidate"("workspaceId");
CREATE INDEX "SpinoutCandidate_workspaceId_originProjectId_idx" ON "SpinoutCandidate"("workspaceId", "originProjectId");
CREATE INDEX "SpinoutCandidate_workspaceId_status_idx" ON "SpinoutCandidate"("workspaceId", "status");
CREATE UNIQUE INDEX "AssumptionRegime_workspaceId_slug_key" ON "AssumptionRegime"("workspaceId", "slug");
CREATE INDEX "AssumptionRegime_workspaceId_idx" ON "AssumptionRegime"("workspaceId");
CREATE INDEX "AssumptionRegime_workspaceId_projectId_idx" ON "AssumptionRegime"("workspaceId", "projectId");
CREATE INDEX "AssumptionRegime_workspaceId_status_idx" ON "AssumptionRegime"("workspaceId", "status");
CREATE UNIQUE INDEX "TheoremContract_workspaceId_slug_key" ON "TheoremContract"("workspaceId", "slug");
CREATE INDEX "TheoremContract_workspaceId_idx" ON "TheoremContract"("workspaceId");
CREATE INDEX "TheoremContract_workspaceId_projectId_idx" ON "TheoremContract"("workspaceId", "projectId");
CREATE INDEX "TheoremContract_workspaceId_status_idx" ON "TheoremContract"("workspaceId", "status");
CREATE INDEX "ResearchFrontierSnapshot_workspaceId_idx" ON "ResearchFrontierSnapshot"("workspaceId");
CREATE INDEX "ResearchFrontierSnapshot_workspaceId_projectId_idx" ON "ResearchFrontierSnapshot"("workspaceId", "projectId");
CREATE INDEX "ResearchFrontierSnapshot_workspaceId_source_idx" ON "ResearchFrontierSnapshot"("workspaceId", "source");
CREATE INDEX "ResearchFrontierSnapshot_workspaceId_createdAt_idx" ON "ResearchFrontierSnapshot"("workspaceId", "createdAt");
CREATE UNIQUE INDEX "ResearchArtifact_workspaceId_slug_key" ON "ResearchArtifact"("workspaceId", "slug");
CREATE INDEX "ResearchArtifact_workspaceId_idx" ON "ResearchArtifact"("workspaceId");
CREATE INDEX "ResearchArtifact_workspaceId_projectId_idx" ON "ResearchArtifact"("workspaceId", "projectId");
CREATE INDEX "ResearchArtifact_workspaceId_kind_idx" ON "ResearchArtifact"("workspaceId", "kind");
CREATE INDEX "ResearchArtifact_workspaceId_status_idx" ON "ResearchArtifact"("workspaceId", "status");
CREATE INDEX "ResearchLink_workspaceId_idx" ON "ResearchLink"("workspaceId");
CREATE INDEX "ResearchLink_workspaceId_projectId_idx" ON "ResearchLink"("workspaceId", "projectId");
CREATE INDEX "ResearchLink_workspaceId_sourceType_sourceId_idx" ON "ResearchLink"("workspaceId", "sourceType", "sourceId");
CREATE INDEX "ResearchLink_workspaceId_targetType_targetId_idx" ON "ResearchLink"("workspaceId", "targetType", "targetId");
CREATE INDEX "ResearchLink_workspaceId_sourceType_sourceId_targetType_targetId_idx" ON "ResearchLink"("workspaceId", "sourceType", "sourceId", "targetType", "targetId");
CREATE INDEX "ResearchLink_workspaceId_relationType_idx" ON "ResearchLink"("workspaceId", "relationType");

-- AddForeignKey
ALTER TABLE "ResearchDelta" ADD CONSTRAINT "ResearchDelta_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ResearchDelta" ADD CONSTRAINT "ResearchDelta_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Mechanism" ADD CONSTRAINT "Mechanism_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Mechanism" ADD CONSTRAINT "Mechanism_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SpinoutCandidate" ADD CONSTRAINT "SpinoutCandidate_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SpinoutCandidate" ADD CONSTRAINT "SpinoutCandidate_originProjectId_fkey" FOREIGN KEY ("originProjectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SpinoutCandidate" ADD CONSTRAINT "SpinoutCandidate_promotedProjectId_fkey" FOREIGN KEY ("promotedProjectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AssumptionRegime" ADD CONSTRAINT "AssumptionRegime_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssumptionRegime" ADD CONSTRAINT "AssumptionRegime_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TheoremContract" ADD CONSTRAINT "TheoremContract_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TheoremContract" ADD CONSTRAINT "TheoremContract_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ResearchFrontierSnapshot" ADD CONSTRAINT "ResearchFrontierSnapshot_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ResearchFrontierSnapshot" ADD CONSTRAINT "ResearchFrontierSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ResearchArtifact" ADD CONSTRAINT "ResearchArtifact_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ResearchArtifact" ADD CONSTRAINT "ResearchArtifact_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ResearchLink" ADD CONSTRAINT "ResearchLink_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
