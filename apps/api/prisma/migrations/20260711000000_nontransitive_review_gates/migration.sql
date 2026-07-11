-- Scoped, non-transitive review approvals. Legacy rows intentionally remain legacy_unspecified.
CREATE TYPE "ReviewType" AS ENUM ('legacy_unspecified','ingredient_correctness','proof_integration','end_to_end_mathematical','novelty','bibliography','editorial','source_fidelity','compile','numerical_verification','formal_verification','other');
CREATE TYPE "ReviewIndependence" AS ENUM ('author_self_check','same_workstream_reviewer','independent_reviewer','external_referee_style');

ALTER TABLE "ReviewRound"
  ADD COLUMN "reviewType" "ReviewType" NOT NULL DEFAULT 'legacy_unspecified',
  ADD COLUMN "targetVersion" TEXT,
  ADD COLUMN "scope" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "inspectedArtifactIds" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "checkedObligationIds" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "parentMathReopenable" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "priorApprovalsEvidenceOnly" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "independence" "ReviewIndependence" NOT NULL DEFAULT 'same_workstream_reviewer';
CREATE INDEX "ReviewRound_workspaceId_projectId_reviewType_targetVersion_verdict_idx" ON "ReviewRound"("workspaceId", "projectId", "reviewType", "targetVersion", "verdict");

CREATE TABLE "ManuscriptVersion" (
  "id" UUID NOT NULL, "workspaceId" UUID NOT NULL, "projectId" UUID NOT NULL, "artifactId" UUID NOT NULL,
  "version" INTEGER NOT NULL, "contentHash" TEXT NOT NULL, "theoremFingerprint" TEXT NOT NULL, "citationFingerprint" TEXT NOT NULL,
  "isCanonical" BOOLEAN NOT NULL DEFAULT false, "supersededAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ManuscriptVersion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ManuscriptVersion_projectId_version_key" ON "ManuscriptVersion"("projectId", "version");
CREATE UNIQUE INDEX "ManuscriptVersion_projectId_contentHash_key" ON "ManuscriptVersion"("projectId", "contentHash");
CREATE INDEX "ManuscriptVersion_workspaceId_projectId_isCanonical_idx" ON "ManuscriptVersion"("workspaceId", "projectId", "isCanonical");
ALTER TABLE "ManuscriptVersion" ADD CONSTRAINT "ManuscriptVersion_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE;
ALTER TABLE "ManuscriptVersion" ADD CONSTRAINT "ManuscriptVersion_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE;
ALTER TABLE "ManuscriptVersion" ADD CONSTRAINT "ManuscriptVersion_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "ResearchArtifact"("id") ON DELETE CASCADE;

CREATE TABLE "ProofObligation" (
  "id" UUID NOT NULL, "workspaceId" UUID NOT NULL, "projectId" UUID NOT NULL, "manuscriptVersionId" UUID NOT NULL, "claimId" UUID,
  "title" TEXT NOT NULL, "statementMarkdown" TEXT NOT NULL, "sourceArtifactId" UUID, "manuscriptLocation" TEXT, "required" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProofObligation_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProofObligation_workspaceId_manuscriptVersionId_idx" ON "ProofObligation"("workspaceId", "manuscriptVersionId");
CREATE INDEX "ProofObligation_workspaceId_claimId_idx" ON "ProofObligation"("workspaceId", "claimId");
ALTER TABLE "ProofObligation" ADD CONSTRAINT "ProofObligation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE;
ALTER TABLE "ProofObligation" ADD CONSTRAINT "ProofObligation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE;
ALTER TABLE "ProofObligation" ADD CONSTRAINT "ProofObligation_manuscriptVersionId_fkey" FOREIGN KEY ("manuscriptVersionId") REFERENCES "ManuscriptVersion"("id") ON DELETE CASCADE;
ALTER TABLE "ProofObligation" ADD CONSTRAINT "ProofObligation_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE SET NULL;
ALTER TABLE "ProofObligation" ADD CONSTRAINT "ProofObligation_sourceArtifactId_fkey" FOREIGN KEY ("sourceArtifactId") REFERENCES "ResearchArtifact"("id") ON DELETE SET NULL;

CREATE TABLE "ReviewObligationCheck" (
  "id" UUID NOT NULL, "workspaceId" UUID NOT NULL, "reviewRoundId" UUID NOT NULL, "proofObligationId" UUID NOT NULL,
  "status" TEXT NOT NULL, "evidenceMarkdown" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReviewObligationCheck_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ReviewObligationCheck_reviewRoundId_proofObligationId_key" ON "ReviewObligationCheck"("reviewRoundId", "proofObligationId");
CREATE INDEX "ReviewObligationCheck_workspaceId_proofObligationId_status_idx" ON "ReviewObligationCheck"("workspaceId", "proofObligationId", "status");
ALTER TABLE "ReviewObligationCheck" ADD CONSTRAINT "ReviewObligationCheck_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE;
ALTER TABLE "ReviewObligationCheck" ADD CONSTRAINT "ReviewObligationCheck_reviewRoundId_fkey" FOREIGN KEY ("reviewRoundId") REFERENCES "ReviewRound"("id") ON DELETE CASCADE;
ALTER TABLE "ReviewObligationCheck" ADD CONSTRAINT "ReviewObligationCheck_proofObligationId_fkey" FOREIGN KEY ("proofObligationId") REFERENCES "ProofObligation"("id") ON DELETE CASCADE;

CREATE TABLE "WorkstreamDependency" (
  "id" UUID NOT NULL, "workspaceId" UUID NOT NULL, "dependentWorkstreamId" UUID NOT NULL, "prerequisiteWorkstreamId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "WorkstreamDependency_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WorkstreamDependency_dependentWorkstreamId_prerequisiteWorkstreamId_key" ON "WorkstreamDependency"("dependentWorkstreamId", "prerequisiteWorkstreamId");
CREATE INDEX "WorkstreamDependency_workspaceId_prerequisiteWorkstreamId_idx" ON "WorkstreamDependency"("workspaceId", "prerequisiteWorkstreamId");
ALTER TABLE "WorkstreamDependency" ADD CONSTRAINT "WorkstreamDependency_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE;
ALTER TABLE "WorkstreamDependency" ADD CONSTRAINT "WorkstreamDependency_dependentWorkstreamId_fkey" FOREIGN KEY ("dependentWorkstreamId") REFERENCES "Workstream"("id") ON DELETE CASCADE;
ALTER TABLE "WorkstreamDependency" ADD CONSTRAINT "WorkstreamDependency_prerequisiteWorkstreamId_fkey" FOREIGN KEY ("prerequisiteWorkstreamId") REFERENCES "Workstream"("id") ON DELETE CASCADE;
