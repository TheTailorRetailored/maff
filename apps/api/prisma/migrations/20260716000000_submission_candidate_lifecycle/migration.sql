CREATE TYPE "ManuscriptLifecycleStage" AS ENUM ('draft', 'integrated', 'submission_candidate', 'released');

ALTER TABLE "ManuscriptVersion"
ADD COLUMN "lifecycleStage" "ManuscriptLifecycleStage" NOT NULL DEFAULT 'draft';

ALTER TABLE "ProofObligation"
ADD COLUMN "loadBearing" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "ReviewObligationCheck"
ADD COLUMN "expositionStatus" TEXT NOT NULL DEFAULT 'unassessed',
ADD COLUMN "completenessEvidence" JSONB NOT NULL DEFAULT '{}';

CREATE INDEX "ProofObligation_workspaceId_manuscriptVersionId_loadBearing_idx"
ON "ProofObligation"("workspaceId", "manuscriptVersionId", "loadBearing");
