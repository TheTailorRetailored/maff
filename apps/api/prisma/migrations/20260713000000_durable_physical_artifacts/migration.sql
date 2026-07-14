CREATE TYPE "ArtifactStorageStatus" AS ENUM ('available', 'missing', 'corrupt');
CREATE TYPE "ResearchArtifactFileStatus" AS ENUM ('not_applicable', 'provenance_only', 'requires_regeneration', 'durable');

ALTER TABLE "Artifact"
  ADD COLUMN "originalFilename" TEXT,
  ADD COLUMN "mimeType" TEXT,
  ADD COLUMN "byteSize" BIGINT,
  ADD COLUMN "sha256" TEXT,
  ADD COLUMN "storageKey" TEXT,
  ADD COLUMN "storageStatus" "ArtifactStorageStatus" NOT NULL DEFAULT 'available',
  ADD COLUMN "researchArtifactId" UUID;

ALTER TABLE "ResearchArtifact"
  ADD COLUMN "fileStatus" "ResearchArtifactFileStatus" NOT NULL DEFAULT 'not_applicable',
  ADD COLUMN "fileDiagnostic" TEXT;

UPDATE "ResearchArtifact"
SET
  "fileStatus" = CASE
    WHEN "filePath" ~ '^(\/mnt\/data|\/tmp|\/var\/tmp)(\/|$)' THEN 'requires_regeneration'::"ResearchArtifactFileStatus"
    WHEN "filePath" IS NOT NULL THEN 'provenance_only'::"ResearchArtifactFileStatus"
    ELSE 'not_applicable'::"ResearchArtifactFileStatus"
  END,
  "fileDiagnostic" = CASE
    WHEN "filePath" ~ '^(\/mnt\/data|\/tmp|\/var\/tmp)(\/|$)' THEN 'Ephemeral local path was never ingested; bytes are unavailable and must be regenerated.'
    WHEN "filePath" IS NOT NULL THEN 'Local path is provenance only; no durable bytes are registered.'
    ELSE NULL
  END;

-- Exact versions backed by unrecoverable path-only ResearchArtifacts must not retain
-- canonical/verified standing. Reviews remain historical evidence; regeneration creates
-- a new Artifact and ManuscriptVersion rather than rewriting this identity.
UPDATE "ManuscriptVersion" AS mv
SET
  "verificationState" = 'unverified_candidate',
  "isCanonical" = FALSE
FROM "ResearchArtifact" AS ra
WHERE mv."artifactId" = ra."id"
  AND ra."fileStatus" = 'requires_regeneration';

CREATE TABLE "ArtifactManuscriptVersion" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "artifactId" UUID NOT NULL,
  "manuscriptVersionId" UUID NOT NULL,
  "role" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ArtifactManuscriptVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ArtifactManuscriptVersion_artifactId_manuscriptVersionId_role_key" ON "ArtifactManuscriptVersion"("artifactId", "manuscriptVersionId", "role");
CREATE INDEX "ArtifactManuscriptVersion_workspaceId_manuscriptVersionId_idx" ON "ArtifactManuscriptVersion"("workspaceId", "manuscriptVersionId");
CREATE INDEX "Artifact_workspaceId_workstreamId_idx" ON "Artifact"("workspaceId", "workstreamId");
CREATE INDEX "Artifact_workspaceId_researchArtifactId_idx" ON "Artifact"("workspaceId", "researchArtifactId");
CREATE INDEX "Artifact_workspaceId_sha256_idx" ON "Artifact"("workspaceId", "sha256");

ALTER TABLE "Artifact" ADD CONSTRAINT "Artifact_researchArtifactId_fkey" FOREIGN KEY ("researchArtifactId") REFERENCES "ResearchArtifact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ArtifactManuscriptVersion" ADD CONSTRAINT "ArtifactManuscriptVersion_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ArtifactManuscriptVersion" ADD CONSTRAINT "ArtifactManuscriptVersion_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "Artifact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ArtifactManuscriptVersion" ADD CONSTRAINT "ArtifactManuscriptVersion_manuscriptVersionId_fkey" FOREIGN KEY ("manuscriptVersionId") REFERENCES "ManuscriptVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
