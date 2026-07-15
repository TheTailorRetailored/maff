CREATE TABLE "ManuscriptDocument" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "title" TEXT NOT NULL,
  "authors" JSONB NOT NULL DEFAULT '[]',
  "abstractMarkdown" TEXT NOT NULL DEFAULT '',
  "keywords" JSONB NOT NULL DEFAULT '[]',
  "template" TEXT NOT NULL DEFAULT 'article',
  "obligationDrafts" JSONB NOT NULL DEFAULT '[]',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ManuscriptDocument_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ManuscriptDocument_projectId_key" ON "ManuscriptDocument"("projectId");
CREATE INDEX "ManuscriptDocument_workspaceId_projectId_idx" ON "ManuscriptDocument"("workspaceId", "projectId");

CREATE TABLE "ManuscriptSection" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "documentId" UUID NOT NULL,
  "stableKey" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "isCurrent" BOOLEAN NOT NULL DEFAULT true,
  "ordinal" INTEGER NOT NULL,
  "kind" TEXT NOT NULL,
  "title" TEXT,
  "contentMarkdown" TEXT NOT NULL,
  "sourceFormat" TEXT NOT NULL DEFAULT 'markdown',
  "claimIds" JSONB NOT NULL DEFAULT '[]',
  "citationKeys" JSONB NOT NULL DEFAULT '[]',
  "createdByAgentRunId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ManuscriptSection_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ManuscriptSection_documentId_stableKey_revision_key" ON "ManuscriptSection"("documentId", "stableKey", "revision");
CREATE INDEX "ManuscriptSection_workspaceId_projectId_isCurrent_ordinal_idx" ON "ManuscriptSection"("workspaceId", "projectId", "isCurrent", "ordinal");

CREATE TABLE "PaperBuild" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "manuscriptVersionId" UUID NOT NULL,
  "status" TEXT NOT NULL,
  "builderVersion" TEXT NOT NULL,
  "sourceHash" TEXT NOT NULL,
  "sourceArtifactId" UUID,
  "pdfArtifactId" UUID,
  "buildManifest" JSONB NOT NULL DEFAULT '{}',
  "logText" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "PaperBuild_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PaperBuild_manuscriptVersionId_builderVersion_sourceHash_key" ON "PaperBuild"("manuscriptVersionId", "builderVersion", "sourceHash");
CREATE INDEX "PaperBuild_workspaceId_projectId_status_idx" ON "PaperBuild"("workspaceId", "projectId", "status");

ALTER TABLE "ManuscriptDocument" ADD CONSTRAINT "ManuscriptDocument_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE;
ALTER TABLE "ManuscriptDocument" ADD CONSTRAINT "ManuscriptDocument_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE;
ALTER TABLE "ManuscriptSection" ADD CONSTRAINT "ManuscriptSection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE;
ALTER TABLE "ManuscriptSection" ADD CONSTRAINT "ManuscriptSection_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE;
ALTER TABLE "ManuscriptSection" ADD CONSTRAINT "ManuscriptSection_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ManuscriptDocument"("id") ON DELETE CASCADE;
ALTER TABLE "PaperBuild" ADD CONSTRAINT "PaperBuild_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE;
ALTER TABLE "PaperBuild" ADD CONSTRAINT "PaperBuild_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE;
ALTER TABLE "PaperBuild" ADD CONSTRAINT "PaperBuild_manuscriptVersionId_fkey" FOREIGN KEY ("manuscriptVersionId") REFERENCES "ManuscriptVersion"("id") ON DELETE CASCADE;
ALTER TABLE "PaperBuild" ADD CONSTRAINT "PaperBuild_sourceArtifactId_fkey" FOREIGN KEY ("sourceArtifactId") REFERENCES "Artifact"("id") ON DELETE SET NULL;
ALTER TABLE "PaperBuild" ADD CONSTRAINT "PaperBuild_pdfArtifactId_fkey" FOREIGN KEY ("pdfArtifactId") REFERENCES "Artifact"("id") ON DELETE SET NULL;
