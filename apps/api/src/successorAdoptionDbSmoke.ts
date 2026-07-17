import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { prisma } from "./db/prisma.js"
import * as runtime from "./research/runtime.js"

if (!process.env.DATABASE_URL) {
  console.log("Skipping successor adoption DB smoke: DATABASE_URL is not set.")
  process.exit(0)
}

const suffix = randomUUID().slice(0, 8)
const workspace = await prisma.workspace.create({ data: { slug: `successor-adoption-${suffix}`, name: "Successor adoption smoke", type: "private" } })

try {
  const project = await prisma.project.create({ data: { workspaceId: workspace.id, slug: `successor-adoption-${suffix}`, title: "Reviewed successor adoption", statement: "Prove exact working-successor lifecycle semantics." } })
  const currentArtifact = await prisma.researchArtifact.create({ data: { workspaceId: workspace.id, projectId: project.id, title: "Current paper", slug: `current-${suffix}`, kind: "paper_draft", status: "reviewed", contentMarkdown: "Current exact paper", descriptionMarkdown: "Current working text" } })
  const successorArtifact = await prisma.researchArtifact.create({ data: { workspaceId: workspace.id, projectId: project.id, title: "Reviewed successor", slug: `successor-${suffix}`, kind: "paper_draft", status: "reviewed", contentMarkdown: "Reviewed successor exact paper", descriptionMarkdown: "Reviewed successor text" } })
  const current = await prisma.manuscriptVersion.create({ data: { workspaceId: workspace.id, projectId: project.id, artifactId: currentArtifact.id, version: 1, contentHash: "1".repeat(64), theoremFingerprint: "2".repeat(64), citationFingerprint: "3".repeat(64), isCanonical: true, verificationState: "mathematically_reviewed", lifecycleStage: "draft" } })
  const successor = await prisma.manuscriptVersion.create({ data: { workspaceId: workspace.id, projectId: project.id, artifactId: successorArtifact.id, version: 2, contentHash: "4".repeat(64), theoremFingerprint: "2".repeat(64), citationFingerprint: "5".repeat(64), isCanonical: false, verificationState: "unverified_candidate", lifecycleStage: "draft" } })
  await prisma.project.update({ where: { id: project.id }, data: { currentWorkingPaperId: current.id } })
  const currentObligation = await prisma.proofObligation.create({ data: { workspaceId: workspace.id, projectId: project.id, manuscriptVersionId: current.id, title: "Current theorem", statementMarkdown: "Current theorem proof", assumptions: ["A"], boundaryCases: ["B"] } })
  const successorObligation = await prisma.proofObligation.create({ data: { workspaceId: workspace.id, projectId: project.id, manuscriptVersionId: successor.id, title: "Successor theorem", statementMarkdown: "Successor theorem proof", assumptions: ["A"], boundaryCases: ["B"] } })
  await prisma.researchLink.create({ data: { workspaceId: workspace.id, projectId: project.id, sourceType: "ManuscriptVersion", sourceId: successor.id, relationType: "derived_from", targetType: "ResearchArtifact", targetId: current.artifactId } })

  const source = await prisma.artifact.create({ data: { workspaceId: workspace.id, projectId: project.id, kind: "other", title: "Exact source", originalFilename: "source.zip", mimeType: "application/zip", byteSize: 10, sha256: "6".repeat(64), storageKey: `smoke/${suffix}/source.zip`, storageStatus: "available", metadata: {} } })
  const pdf = await prisma.artifact.create({ data: { workspaceId: workspace.id, projectId: project.id, kind: "pdf", title: "Exact PDF", originalFilename: "paper.pdf", mimeType: "application/pdf", byteSize: 10, sha256: "7".repeat(64), storageKey: `smoke/${suffix}/paper.pdf`, storageStatus: "available", metadata: {} } })
  const build = await prisma.paperBuild.create({ data: { workspaceId: workspace.id, projectId: project.id, manuscriptVersionId: successor.id, status: "succeeded", builderVersion: "successor-adoption-smoke", sourceHash: "8".repeat(64), sourceArtifactId: source.id, pdfArtifactId: pdf.id, buildManifest: { manuscript_version_id: successor.id, manuscript_content_hash: successor.contentHash }, completedAt: new Date() } })

  const workstream = await prisma.workstream.create({ data: { workspaceId: workspace.id, projectId: project.id, title: "Independent successor review", kind: "hostile_review", coordinatorRole: "HostileReviewer", status: "approved", targetObjectType: "ManuscriptVersion", targetObjectId: successor.id, instructions: "Inspect the exact successor and build.", allowedWrites: ["ReviewRound"], forbiddenActions: ["Do not edit manuscript."], successCriteria: ["Exact successor approved."], reviewPolicy: { review_type: "other" } } })
  const reviewerRun = await prisma.agentRun.create({ data: { workspaceId: workspace.id, projectId: project.id, workstreamId: workstream.id, role: "HostileReviewer", status: "completed", model: "smoke", sessionId: `successor-review-${suffix}`, inputBriefing: {}, toolCalls: [], createdObjectRefs: [], updatedObjectRefs: [], finishedAt: new Date() } })
  const assignment = await prisma.reviewAssignment.create({ data: { workspaceId: workspace.id, projectId: project.id, workstreamId: workstream.id, manuscriptVersionId: null, reviewType: "other", targetObjectType: "ManuscriptVersion", targetObjectId: successor.id, targetHash: successor.contentHash, reviewerRunId: reviewerRun.id, independence: "author_disjoint", eligibilitySnapshot: {}, sealedBriefingHash: "9".repeat(64), permittedArtifactIds: [source.id, pdf.id], tokenHash: randomUUID(), status: "submitted", leaseExpiresAt: new Date(Date.now() + 60_000), submittedAt: new Date() } })
  const review = await prisma.reviewRound.create({ data: { workspaceId: workspace.id, projectId: project.id, workstreamId: workstream.id, targetObjectType: "Gap", targetObjectId: randomUUID(), reviewerRole: "HostileReviewer", verdict: "approved", issues: [], requiredChanges: [], checkedRefs: [`ManuscriptVersion:${successor.id}`, `PaperBuild:${build.id}`, `Artifact:${source.id}`, `Artifact:${pdf.id}`], bodyMarkdown: "Exact independently reviewed successor and clean build approved for working-text adoption only.", createdByAgentRunId: reviewerRun.id, reviewAssignmentId: assignment.id, evidenceStatus: "assigned_valid", reviewType: "other", targetVersion: successor.id, scope: { paper_build: build.id, canonicality_reviewed: false, publication_readiness_reviewed: false }, inspectedArtifactIds: [source.id, pdf.id], checkedObligationIds: [successorObligation.id], parentMathReopenable: true, priorApprovalsEvidenceOnly: true, independence: "independent_reviewer" } })

  const beforeContract: any = await runtime.getProjectReleaseContract(workspace.id, project.id)
  assert.deepEqual(beforeContract.permitted_mutation_tools, ["adopt_reviewed_manuscript_successor"])
  assert.equal(beforeContract.next_action.exact_target_id, successor.id)
  assert.equal(beforeContract.authoritative_ids.current_working_manuscript_version_id, current.id)

  const beforeState = await prisma.manuscriptVersion.findUniqueOrThrow({ where: { id: successor.id } })
  const beforeObligationCount = await prisma.proofObligation.count({ where: { workspaceId: workspace.id, projectId: project.id } })
  const adopted: any = await runtime.adoptReviewedManuscriptSuccessor({ workspaceId: workspace.id, projectId: project.id, expectedCurrentManuscriptVersionId: current.id, successorManuscriptVersionId: successor.id, supportingReviewRoundId: review.id, paperBuildId: build.id })
  assert.equal(adopted.idempotent, false)
  assert.equal(adopted.mathematical_or_proof_state_changed, false)
  assert.equal(adopted.release_assessment_activated, false)
  assert.equal(adopted.published, false)
  assert.equal((await prisma.project.findUniqueOrThrow({ where: { id: project.id } })).currentWorkingPaperId, successor.id)
  const historical = await prisma.manuscriptVersion.findUniqueOrThrow({ where: { id: current.id } })
  const currentSuccessor = await prisma.manuscriptVersion.findUniqueOrThrow({ where: { id: successor.id } })
  assert.equal(historical.isCanonical, false)
  assert.ok(historical.supersededAt)
  assert.equal(currentSuccessor.isCanonical, true)
  assert.equal(currentSuccessor.verificationState, beforeState.verificationState)
  assert.equal(currentSuccessor.lifecycleStage, beforeState.lifecycleStage)
  assert.equal(currentSuccessor.freezeLevel, beforeState.freezeLevel)
  assert.equal(await prisma.proofObligation.count({ where: { workspaceId: workspace.id, projectId: project.id } }), beforeObligationCount)
  assert.ok(await prisma.proofObligation.findUnique({ where: { id: currentObligation.id } }))
  assert.deepEqual(adopted.release_contract.permitted_mutation_tools, ["promote_manuscript_to_submission_candidate"])
  assert.equal(adopted.release_contract.next_action.exact_target_id, successor.id)

  const repeated: any = await runtime.adoptReviewedManuscriptSuccessor({ workspaceId: workspace.id, projectId: project.id, expectedCurrentManuscriptVersionId: current.id, successorManuscriptVersionId: successor.id, supportingReviewRoundId: review.id, paperBuildId: build.id })
  assert.equal(repeated.idempotent, true)
  assert.equal(await prisma.researchLink.count({ where: { workspaceId: workspace.id, projectId: project.id, sourceType: "ManuscriptVersion", sourceId: successor.id, relationType: "adopted_working_successor_of", targetType: "ManuscriptVersion", targetId: current.id } }), 1)
  console.log("Reviewed successor adoption DB smoke passed")
} finally {
  await prisma.workspace.delete({ where: { id: workspace.id } }).catch(() => undefined)
  await prisma.$disconnect()
}
