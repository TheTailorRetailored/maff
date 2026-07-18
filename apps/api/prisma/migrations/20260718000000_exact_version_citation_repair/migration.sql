ALTER TABLE "ManuscriptVersion"
  ADD COLUMN "citationPayload" JSONB,
  ADD COLUMN "citationMetadataRevision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "citationMetadataUpdatedAt" TIMESTAMP(3);

CREATE TABLE "CitationRepairCertificate" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "manuscriptVersionId" UUID NOT NULL,
  "actorAgentRunId" UUID NOT NULL,
  "schemaVersion" TEXT NOT NULL,
  "requestDigest" TEXT NOT NULL,
  "idempotencyKey" TEXT,
  "expectedContentHash" TEXT NOT NULL,
  "observedContentHash" TEXT NOT NULL,
  "expectedOldCitationFingerprint" TEXT NOT NULL,
  "oldCitationFingerprint" TEXT NOT NULL,
  "newCitationFingerprint" TEXT NOT NULL,
  "citationPayloadDigest" TEXT NOT NULL,
  "citationKeys" JSONB NOT NULL,
  "sourceArtifactId" UUID NOT NULL,
  "sourceArtifactSha256" TEXT NOT NULL,
  "pdfArtifactId" UUID NOT NULL,
  "pdfArtifactSha256" TEXT NOT NULL,
  "theoremFingerprint" TEXT NOT NULL,
  "proofLedgerDigest" TEXT NOT NULL,
  "protectedStateDigestBefore" TEXT NOT NULL,
  "protectedStateDigestAfter" TEXT NOT NULL,
  "currentWorkingPointerBefore" UUID,
  "currentWorkingPointerAfter" UUID,
  "allowedStateDiff" JSONB NOT NULL,
  "protectedStateDiff" JSONB NOT NULL,
  "applicationOutcome" TEXT NOT NULL,
  "certificatePayload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CitationRepairCertificate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CitationRepairCertificate_manuscriptVersionId_requestDigest_key"
  ON "CitationRepairCertificate"("manuscriptVersionId", "requestDigest");
CREATE UNIQUE INDEX "CitationRepairCertificate_idempotencyKey_key"
  ON "CitationRepairCertificate"("idempotencyKey");
CREATE INDEX "CitationRepairCertificate_workspaceId_projectId_createdAt_idx"
  ON "CitationRepairCertificate"("workspaceId", "projectId", "createdAt");
CREATE INDEX "CitationRepairCertificate_sourceArtifactId_pdfArtifactId_idx"
  ON "CitationRepairCertificate"("sourceArtifactId", "pdfArtifactId");

ALTER TABLE "CitationRepairCertificate"
  ADD CONSTRAINT "CitationRepairCertificate_manuscriptVersionId_fkey"
  FOREIGN KEY ("manuscriptVersionId") REFERENCES "ManuscriptVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CitationRepairCertificate"
  ADD CONSTRAINT "CitationRepairCertificate_actorAgentRunId_fkey"
  FOREIGN KEY ("actorAgentRunId") REFERENCES "AgentRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION maff_reject_citation_repair_certificate_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'CitationRepairCertificate is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CitationRepairCertificate_immutable_update"
BEFORE UPDATE ON "CitationRepairCertificate"
FOR EACH ROW EXECUTE FUNCTION maff_reject_citation_repair_certificate_mutation();

CREATE TRIGGER "CitationRepairCertificate_immutable_delete"
BEFORE DELETE ON "CitationRepairCertificate"
FOR EACH ROW EXECUTE FUNCTION maff_reject_citation_repair_certificate_mutation();
