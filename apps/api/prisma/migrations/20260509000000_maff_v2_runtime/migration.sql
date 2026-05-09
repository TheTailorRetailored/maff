-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('seed', 'active', 'paused', 'completed', 'archived');

-- CreateEnum
CREATE TYPE "ProjectGoalStatus" AS ENUM ('proposed', 'approved', 'active', 'blocked', 'completed', 'abandoned');

-- CreateEnum
CREATE TYPE "WorkstreamKind" AS ENUM ('project_coordination', 'literature_review', 'proof_route_generation', 'proof_attempt', 'counterexample_search', 'experiment_design', 'computation', 'hostile_review', 'gap_analysis', 'formalization', 'lean_check', 'paper_synthesis', 'triage');

-- CreateEnum
CREATE TYPE "WorkstreamStatus" AS ENUM ('planned', 'ready', 'claimed', 'running', 'blocked', 'needs_review', 'revision_required', 'approved', 'completed', 'abandoned', 'escalated');

-- CreateEnum
CREATE TYPE "AgentRole" AS ENUM ('ProjectCoordinator', 'WorkstreamCoordinator', 'LiteratureAgent', 'ProofRouteAgent', 'ProofAttemptAgent', 'CounterexampleAgent', 'ExperimentAgent', 'CodingAgent', 'GapAnalyst', 'HostileReviewer', 'FormalizationAgent', 'LeanChecker', 'PaperWriter', 'TriageAgent');

-- CreateEnum
CREATE TYPE "AgentRunStatus" AS ENUM ('started', 'running', 'submitted', 'failed', 'escalated', 'cancelled');

-- CreateEnum
CREATE TYPE "AgentMessageKind" AS ENUM ('instruction', 'update', 'blocker', 'handoff', 'user_steering', 'escalation', 'review_request');

-- CreateEnum
CREATE TYPE "WorkstreamReportStatus" AS ENUM ('draft', 'submitted', 'reviewed_needs_revision', 'reviewed_approved', 'superseded');

-- CreateEnum
CREATE TYPE "ReviewVerdict" AS ENUM ('approved', 'needs_revision', 'rejected', 'blocked', 'escalate');

-- CreateEnum
CREATE TYPE "ArtifactKind" AS ENUM ('markdown', 'latex', 'code', 'computation_output', 'lean_file', 'pdf', 'external_reference', 'dataset', 'image', 'other');

-- CreateEnum
CREATE TYPE "MathObjectType" AS ENUM ('definition', 'object', 'construction', 'notation');

-- CreateEnum
CREATE TYPE "ClaimKind" AS ENUM ('conjecture', 'theorem', 'lemma', 'proposition', 'corollary', 'reduction', 'equivalence', 'bound', 'counterexample_claim');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('unexamined', 'conjectured', 'under_attack', 'has_routes', 'proof_attempted', 'gap_found', 'informal_proof_candidate', 'reviewed_informal_proof', 'formalization_target', 'lean_checked', 'lean_verified', 'refuted', 'archived');

-- CreateEnum
CREATE TYPE "ProofRouteStatus" AS ENUM ('proposed', 'active', 'blocked', 'failed', 'promoted', 'abandoned');

-- CreateEnum
CREATE TYPE "ProofAttemptStatus" AS ENUM ('draft', 'failed', 'gap_found', 'candidate', 'reviewed', 'rejected');

-- CreateEnum
CREATE TYPE "GapSeverity" AS ENUM ('cosmetic', 'minor', 'major', 'fatal', 'unknown');

-- CreateEnum
CREATE TYPE "GapStatus" AS ENUM ('open', 'assigned', 'resolved', 'abandoned');

-- CreateEnum
CREATE TYPE "CounterexampleStatus" AS ENUM ('candidate', 'verified', 'refuted', 'inconclusive');

-- CreateEnum
CREATE TYPE "ExperimentStatus" AS ENUM ('planned', 'running', 'completed', 'inconclusive', 'failed');

-- CreateEnum
CREATE TYPE "KnownResultStatus" AS ENUM ('suspected', 'cited', 'checked', 'disputed');

-- CreateEnum
CREATE TYPE "AssumptionStatus" AS ENUM ('hypothesis', 'unproved_dependency', 'temporary_axiom', 'known_mathlib_result', 'proved_locally', 'discharged');

-- CreateEnum
CREATE TYPE "FormalizationTargetStatus" AS ENUM ('proposed', 'active', 'blocked', 'completed', 'abandoned');

-- CreateEnum
CREATE TYPE "LeanTheoremStatus" AS ENUM ('draft', 'lean_checked', 'lean_verified', 'failed', 'blocked');

-- CreateEnum
CREATE TYPE "GraphEdgeType" AS ENUM ('depends_on', 'supports', 'contradicts', 'refutes', 'formalizes', 'cites', 'produced_by', 'reviewed_by', 'blocks', 'resolves', 'assigned_to', 'reports_on', 'derived_from', 'parent_of');

-- CreateTable
CREATE TABLE "Project" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "area" TEXT,
    "statement" TEXT NOT NULL,
    "status" "ProjectStatus" NOT NULL DEFAULT 'seed',
    "coordinatorSummary" TEXT,
    "currentWorkingPaperId" UUID,
    "createdByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectGoal" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "status" "ProjectGoalStatus" NOT NULL DEFAULT 'proposed',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "successCriteria" JSONB NOT NULL,
    "dependencies" JSONB NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "approvedByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectGoal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workstream" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "goalId" UUID,
    "parentWorkstreamId" UUID,
    "title" TEXT NOT NULL,
    "kind" "WorkstreamKind" NOT NULL,
    "coordinatorRole" "AgentRole" NOT NULL,
    "status" "WorkstreamStatus" NOT NULL DEFAULT 'planned',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "targetObjectType" TEXT,
    "targetObjectId" TEXT,
    "instructions" TEXT NOT NULL,
    "allowedWrites" JSONB NOT NULL,
    "forbiddenActions" JSONB NOT NULL,
    "successCriteria" JSONB NOT NULL,
    "reportId" UUID,
    "reviewPolicy" JSONB NOT NULL,
    "escalationMessage" TEXT,
    "assignedToUserId" UUID,
    "claimedSessionId" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Workstream_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "workstreamId" UUID NOT NULL,
    "role" "AgentRole" NOT NULL,
    "status" "AgentRunStatus" NOT NULL DEFAULT 'started',
    "model" TEXT,
    "sessionId" TEXT NOT NULL,
    "inputBriefing" JSONB NOT NULL,
    "outputSummary" TEXT,
    "toolCalls" JSONB NOT NULL,
    "createdObjectRefs" JSONB NOT NULL,
    "updatedObjectRefs" JSONB NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentMessage" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "workstreamId" UUID,
    "fromRole" "AgentRole" NOT NULL,
    "toRole" "AgentRole" NOT NULL,
    "kind" "AgentMessageKind" NOT NULL,
    "body" TEXT NOT NULL,
    "artifactRefs" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkstreamReport" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "workstreamId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "status" "WorkstreamReportStatus" NOT NULL DEFAULT 'draft',
    "bodyMarkdown" TEXT NOT NULL,
    "uncertaintyNotes" JSONB NOT NULL,
    "linkedObjectRefs" JSONB NOT NULL,
    "artifactRefs" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "submittedAt" TIMESTAMP(3),

    CONSTRAINT "WorkstreamReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewRound" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "workstreamId" UUID NOT NULL,
    "reportId" UUID,
    "targetObjectType" TEXT NOT NULL,
    "targetObjectId" TEXT NOT NULL,
    "reviewerRole" "AgentRole" NOT NULL,
    "verdict" "ReviewVerdict" NOT NULL,
    "issues" JSONB NOT NULL,
    "requiredChanges" JSONB NOT NULL,
    "checkedRefs" JSONB NOT NULL,
    "bodyMarkdown" TEXT NOT NULL,
    "createdByAgentRunId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Artifact" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "workstreamId" UUID,
    "kind" "ArtifactKind" NOT NULL,
    "title" TEXT NOT NULL,
    "uri" TEXT,
    "path" TEXT,
    "contentHash" TEXT,
    "metadata" JSONB NOT NULL,
    "createdByAgentRunId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Artifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MathObject" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "type" "MathObjectType" NOT NULL,
    "title" TEXT NOT NULL,
    "statementMarkdown" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MathObject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Claim" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "statementMarkdown" TEXT NOT NULL,
    "kind" "ClaimKind" NOT NULL,
    "status" "ClaimStatus" NOT NULL DEFAULT 'unexamined',
    "confidence" DOUBLE PRECISION,
    "metadata" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Claim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProofRoute" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "claimId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "strategyMarkdown" TEXT NOT NULL,
    "requiredLemmas" JSONB NOT NULL,
    "firstTestableStep" TEXT NOT NULL,
    "killCondition" TEXT NOT NULL,
    "status" "ProofRouteStatus" NOT NULL DEFAULT 'proposed',
    "createdByWorkstreamId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProofRoute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProofAttempt" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "claimId" UUID NOT NULL,
    "routeId" UUID,
    "workstreamId" UUID,
    "bodyMarkdown" TEXT NOT NULL,
    "status" "ProofAttemptStatus" NOT NULL DEFAULT 'draft',
    "gapSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProofAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Gap" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "claimId" UUID,
    "proofAttemptId" UUID,
    "routeId" UUID,
    "title" TEXT NOT NULL,
    "descriptionMarkdown" TEXT NOT NULL,
    "severity" "GapSeverity" NOT NULL,
    "status" "GapStatus" NOT NULL DEFAULT 'open',
    "suggestedResolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Gap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Counterexample" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "claimId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "constructionMarkdown" TEXT NOT NULL,
    "status" "CounterexampleStatus" NOT NULL DEFAULT 'candidate',
    "verificationArtifactId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Counterexample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Experiment" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "workstreamId" UUID,
    "title" TEXT NOT NULL,
    "hypothesisMarkdown" TEXT NOT NULL,
    "methodMarkdown" TEXT NOT NULL,
    "resultMarkdown" TEXT NOT NULL,
    "reproducibility" JSONB NOT NULL,
    "status" "ExperimentStatus" NOT NULL DEFAULT 'planned',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Experiment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Paper" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID,
    "title" TEXT NOT NULL,
    "authors" JSONB NOT NULL,
    "year" INTEGER,
    "venue" TEXT,
    "url" TEXT,
    "arxivId" TEXT,
    "doi" TEXT,
    "notesMarkdown" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Paper_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnownResult" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID,
    "paperId" UUID,
    "title" TEXT NOT NULL,
    "statementMarkdown" TEXT NOT NULL,
    "applicabilityMarkdown" TEXT NOT NULL,
    "status" "KnownResultStatus" NOT NULL DEFAULT 'suspected',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnownResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assumption" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "statementMarkdown" TEXT NOT NULL,
    "status" "AssumptionStatus" NOT NULL,
    "reason" TEXT NOT NULL,
    "owner" TEXT,
    "dischargePlan" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Assumption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormalizationTarget" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "claimId" UUID,
    "proofAttemptId" UUID,
    "statementMarkdown" TEXT NOT NULL,
    "theoremStub" TEXT,
    "requiredDefinitions" JSONB NOT NULL,
    "feasibility" TEXT NOT NULL,
    "status" "FormalizationTargetStatus" NOT NULL DEFAULT 'proposed',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FormalizationTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeanTheorem" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "formalizationTargetId" UUID,
    "leanName" TEXT NOT NULL,
    "proofFile" TEXT NOT NULL,
    "statementMarkdown" TEXT NOT NULL,
    "latestCheckJobId" UUID,
    "status" "LeanTheoremStatus" NOT NULL DEFAULT 'draft',
    "hasSorry" BOOLEAN NOT NULL DEFAULT false,
    "hasAxiom" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeanTheorem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GraphEdge" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "edgeType" "GraphEdgeType" NOT NULL,
    "metadata" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GraphEdge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Project_workspaceId_status_idx" ON "Project"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Project_workspaceId_slug_key" ON "Project"("workspaceId", "slug");

-- CreateIndex
CREATE INDEX "ProjectGoal_workspaceId_projectId_status_idx" ON "ProjectGoal"("workspaceId", "projectId", "status");

-- CreateIndex
CREATE INDEX "Workstream_workspaceId_projectId_status_priority_idx" ON "Workstream"("workspaceId", "projectId", "status", "priority");

-- CreateIndex
CREATE INDEX "Workstream_workspaceId_goalId_idx" ON "Workstream"("workspaceId", "goalId");

-- CreateIndex
CREATE INDEX "AgentRun_workspaceId_workstreamId_status_idx" ON "AgentRun"("workspaceId", "workstreamId", "status");

-- CreateIndex
CREATE INDEX "AgentRun_workspaceId_projectId_startedAt_idx" ON "AgentRun"("workspaceId", "projectId", "startedAt");

-- CreateIndex
CREATE INDEX "AgentMessage_workspaceId_projectId_createdAt_idx" ON "AgentMessage"("workspaceId", "projectId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkstreamReport_workspaceId_workstreamId_status_idx" ON "WorkstreamReport"("workspaceId", "workstreamId", "status");

-- CreateIndex
CREATE INDEX "ReviewRound_workspaceId_workstreamId_verdict_idx" ON "ReviewRound"("workspaceId", "workstreamId", "verdict");

-- CreateIndex
CREATE INDEX "Artifact_workspaceId_projectId_kind_idx" ON "Artifact"("workspaceId", "projectId", "kind");

-- CreateIndex
CREATE INDEX "MathObject_workspaceId_projectId_type_idx" ON "MathObject"("workspaceId", "projectId", "type");

-- CreateIndex
CREATE INDEX "Claim_workspaceId_projectId_status_idx" ON "Claim"("workspaceId", "projectId", "status");

-- CreateIndex
CREATE INDEX "ProofRoute_workspaceId_claimId_status_idx" ON "ProofRoute"("workspaceId", "claimId", "status");

-- CreateIndex
CREATE INDEX "ProofAttempt_workspaceId_claimId_status_idx" ON "ProofAttempt"("workspaceId", "claimId", "status");

-- CreateIndex
CREATE INDEX "Gap_workspaceId_projectId_status_idx" ON "Gap"("workspaceId", "projectId", "status");

-- CreateIndex
CREATE INDEX "Counterexample_workspaceId_claimId_status_idx" ON "Counterexample"("workspaceId", "claimId", "status");

-- CreateIndex
CREATE INDEX "Experiment_workspaceId_projectId_status_idx" ON "Experiment"("workspaceId", "projectId", "status");

-- CreateIndex
CREATE INDEX "Paper_workspaceId_projectId_idx" ON "Paper"("workspaceId", "projectId");

-- CreateIndex
CREATE INDEX "KnownResult_workspaceId_projectId_status_idx" ON "KnownResult"("workspaceId", "projectId", "status");

-- CreateIndex
CREATE INDEX "Assumption_workspaceId_projectId_status_idx" ON "Assumption"("workspaceId", "projectId", "status");

-- CreateIndex
CREATE INDEX "FormalizationTarget_workspaceId_projectId_status_idx" ON "FormalizationTarget"("workspaceId", "projectId", "status");

-- CreateIndex
CREATE INDEX "LeanTheorem_workspaceId_projectId_status_idx" ON "LeanTheorem"("workspaceId", "projectId", "status");

-- CreateIndex
CREATE INDEX "GraphEdge_workspaceId_projectId_edgeType_idx" ON "GraphEdge"("workspaceId", "projectId", "edgeType");

-- CreateIndex
CREATE INDEX "GraphEdge_workspaceId_sourceType_sourceId_idx" ON "GraphEdge"("workspaceId", "sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "GraphEdge_workspaceId_targetType_targetId_idx" ON "GraphEdge"("workspaceId", "targetType", "targetId");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectGoal" ADD CONSTRAINT "ProjectGoal_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectGoal" ADD CONSTRAINT "ProjectGoal_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectGoal" ADD CONSTRAINT "ProjectGoal_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workstream" ADD CONSTRAINT "Workstream_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workstream" ADD CONSTRAINT "Workstream_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workstream" ADD CONSTRAINT "Workstream_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "ProjectGoal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workstream" ADD CONSTRAINT "Workstream_parentWorkstreamId_fkey" FOREIGN KEY ("parentWorkstreamId") REFERENCES "Workstream"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workstream" ADD CONSTRAINT "Workstream_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_workstreamId_fkey" FOREIGN KEY ("workstreamId") REFERENCES "Workstream"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentMessage" ADD CONSTRAINT "AgentMessage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentMessage" ADD CONSTRAINT "AgentMessage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentMessage" ADD CONSTRAINT "AgentMessage_workstreamId_fkey" FOREIGN KEY ("workstreamId") REFERENCES "Workstream"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkstreamReport" ADD CONSTRAINT "WorkstreamReport_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkstreamReport" ADD CONSTRAINT "WorkstreamReport_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkstreamReport" ADD CONSTRAINT "WorkstreamReport_workstreamId_fkey" FOREIGN KEY ("workstreamId") REFERENCES "Workstream"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewRound" ADD CONSTRAINT "ReviewRound_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewRound" ADD CONSTRAINT "ReviewRound_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewRound" ADD CONSTRAINT "ReviewRound_workstreamId_fkey" FOREIGN KEY ("workstreamId") REFERENCES "Workstream"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewRound" ADD CONSTRAINT "ReviewRound_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "WorkstreamReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewRound" ADD CONSTRAINT "ReviewRound_createdByAgentRunId_fkey" FOREIGN KEY ("createdByAgentRunId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Artifact" ADD CONSTRAINT "Artifact_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Artifact" ADD CONSTRAINT "Artifact_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Artifact" ADD CONSTRAINT "Artifact_workstreamId_fkey" FOREIGN KEY ("workstreamId") REFERENCES "Workstream"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Artifact" ADD CONSTRAINT "Artifact_createdByAgentRunId_fkey" FOREIGN KEY ("createdByAgentRunId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MathObject" ADD CONSTRAINT "MathObject_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MathObject" ADD CONSTRAINT "MathObject_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProofRoute" ADD CONSTRAINT "ProofRoute_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProofRoute" ADD CONSTRAINT "ProofRoute_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProofRoute" ADD CONSTRAINT "ProofRoute_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProofRoute" ADD CONSTRAINT "ProofRoute_createdByWorkstreamId_fkey" FOREIGN KEY ("createdByWorkstreamId") REFERENCES "Workstream"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProofAttempt" ADD CONSTRAINT "ProofAttempt_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProofAttempt" ADD CONSTRAINT "ProofAttempt_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProofAttempt" ADD CONSTRAINT "ProofAttempt_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProofAttempt" ADD CONSTRAINT "ProofAttempt_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "ProofRoute"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProofAttempt" ADD CONSTRAINT "ProofAttempt_workstreamId_fkey" FOREIGN KEY ("workstreamId") REFERENCES "Workstream"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Gap" ADD CONSTRAINT "Gap_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Gap" ADD CONSTRAINT "Gap_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Gap" ADD CONSTRAINT "Gap_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Gap" ADD CONSTRAINT "Gap_proofAttemptId_fkey" FOREIGN KEY ("proofAttemptId") REFERENCES "ProofAttempt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Gap" ADD CONSTRAINT "Gap_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "ProofRoute"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Counterexample" ADD CONSTRAINT "Counterexample_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Counterexample" ADD CONSTRAINT "Counterexample_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Counterexample" ADD CONSTRAINT "Counterexample_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Experiment" ADD CONSTRAINT "Experiment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Experiment" ADD CONSTRAINT "Experiment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Experiment" ADD CONSTRAINT "Experiment_workstreamId_fkey" FOREIGN KEY ("workstreamId") REFERENCES "Workstream"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Paper" ADD CONSTRAINT "Paper_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnownResult" ADD CONSTRAINT "KnownResult_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnownResult" ADD CONSTRAINT "KnownResult_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "Paper"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assumption" ADD CONSTRAINT "Assumption_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormalizationTarget" ADD CONSTRAINT "FormalizationTarget_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormalizationTarget" ADD CONSTRAINT "FormalizationTarget_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormalizationTarget" ADD CONSTRAINT "FormalizationTarget_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormalizationTarget" ADD CONSTRAINT "FormalizationTarget_proofAttemptId_fkey" FOREIGN KEY ("proofAttemptId") REFERENCES "ProofAttempt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeanTheorem" ADD CONSTRAINT "LeanTheorem_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeanTheorem" ADD CONSTRAINT "LeanTheorem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeanTheorem" ADD CONSTRAINT "LeanTheorem_formalizationTargetId_fkey" FOREIGN KEY ("formalizationTargetId") REFERENCES "FormalizationTarget"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GraphEdge" ADD CONSTRAINT "GraphEdge_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GraphEdge" ADD CONSTRAINT "GraphEdge_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

