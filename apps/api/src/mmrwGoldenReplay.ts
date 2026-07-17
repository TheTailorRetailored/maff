import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { prisma } from "./db/prisma.js"
import * as runtime from "./research/runtime.js"

if (!process.env.DATABASE_URL) {
  console.log("Skipping MMRW golden lifecycle replay: DATABASE_URL is not set.")
  process.exit(0)
}

const suffix = randomUUID().slice(0, 8)
const workspace = await prisma.workspace.create({ data: { slug: `mmrw-golden-${suffix}`, name: "MMRW golden lifecycle", type: "private" } })

async function approveNextGate(input: { userId: string; projectId: string; manuscriptVersionId: string; claimId: string; obligationId: string; gate: string; ordinal: number }) {
  const claimed: any = await runtime.claimNextReview({
    userId: input.userId,
    workspaceRef: workspace.id,
    project: input.projectId,
    sessionId: `mmrw-golden-review-${input.ordinal}-${suffix}`,
    model: "mmrw-golden-replay"
  })
  assert.equal(claimed.review_assignment?.assignment.reviewType, input.gate, `expected ${input.gate} reviewer assignment`)
  assert.equal(claimed.review_assignment.assignment.targetObjectId, input.manuscriptVersionId)
  const permittedArtifactIds = claimed.review_assignment.assignment.permittedArtifactIds as string[]
  assert.ok(permittedArtifactIds.length > 0, `${input.gate} must lock exact physical artifacts`)
  for (const artifactId of permittedArtifactIds) {
    const artifact = await prisma.artifact.findUniqueOrThrow({ where: { id: artifactId } })
    await runtime.recordObjectAccess({
      workspaceId: workspace.id,
      projectId: input.projectId,
      agentRunId: claimed.agent_run.id,
      objectType: "Artifact",
      objectId: artifact.id,
      artifactId: artifact.id,
      operation: "golden_replay_exact_inspection",
      contentHash: artifact.sha256 ?? undefined,
      coverage: { exact_manuscript_version_id: input.manuscriptVersionId, complete: true }
    })
  }

  const evidence = `Golden replay inspected the complete exact candidate and its managed source/PDF artifacts for the ${input.gate} gate. The conclusion is tied only to ManuscriptVersion ${input.manuscriptVersionId}.`
  const evidenceSection: Record<string, unknown> = { sectionType: input.gate, conclusion: "approved", evidenceMarkdown: evidence, checkedRefs: permittedArtifactIds }
  const scope: Record<string, unknown> = {}
  const obligationChecks: Array<{ proofObligationId: string; status: string; evidenceMarkdown?: string; expositionStatus?: string; completenessEvidence?: unknown }> = []
  if (input.gate === "proof_integration") obligationChecks.push({
    proofObligationId: input.obligationId,
    status: "preserved",
    evidenceMarkdown: "The identity proof, its universal quantifier, and its vacuous empty-domain boundary case occur in the exact manuscript source.",
    expositionStatus: "journal_verifiable",
    completenessEvidence: {
      intermediate_arguments: "The proof has no suppressed intermediate step.",
      uniformity_or_domination: "Not applicable; the identity is pointwise and no limit is taken.",
      endpoints_and_exceptional_cases: "The empty-domain case is explicitly vacuous.",
      normalizers_and_denominators: "Not applicable; no normalizer or denominator occurs.",
      notation_and_quantifiers: "The universal quantifier and ambient set are explicit.",
      external_theorem_applicability: "No external theorem is used."
    }
  })
  if (input.gate === "novelty") {
    scope.claim_ids = [input.claimId]
    evidenceSection.externalSources = [{ title: "MMRW golden comparison corpus", locator: "fixture:mmrw-golden", conclusion: "No stronger conflicting claim found." }]
  }
  if (input.gate === "end_to_end_mathematical") evidenceSection.attackCategories = ["quantifier scope", "empty-domain boundary", "proof-to-statement consistency"]

  const review = await runtime.recordReviewRound({
    workspaceId: workspace.id,
    workstreamId: claimed.assignment.id,
    targetObjectType: "ManuscriptVersion",
    targetObjectId: input.manuscriptVersionId,
    verdict: "approved",
    reviewType: input.gate,
    targetVersion: input.manuscriptVersionId,
    scope,
    inspectedArtifactIds: permittedArtifactIds,
    obligationChecks,
    evidenceSections: [evidenceSection],
    issues: [],
    requiredChanges: [],
    checkedRefs: permittedArtifactIds,
    bodyMarkdown: evidence,
    createdByAgentRunId: claimed.agent_run.id,
    reviewAssignmentId: claimed.review_assignment.assignment.id,
    submissionToken: claimed.review_assignment.submission_token
  })
  assert.equal(review.evidenceStatus, "assigned_valid")
  await runtime.submitRunOutcome({
    workspaceId: workspace.id,
    agentRunId: claimed.agent_run.id,
    completedWork: [`Approved exact ${input.gate} gate in the golden replay.`],
    changedObjects: [`ReviewRound:${review.id}`],
    evidenceGenerated: permittedArtifactIds.map((id) => `Artifact:${id}`),
    checksPerformed: [input.gate],
    problemsEncountered: [],
    unresolvedUncertainty: [],
    gapsCreated: [],
    gapsResolved: [],
    nextAction: { kind: "review", role: "HostileReviewer" }
  })
  return review
}

try {
  const user = await prisma.user.create({ data: { auth0Sub: `mmrw-golden|${suffix}`, displayName: "MMRW Golden Replay" } })
  await prisma.workspaceMember.create({ data: { workspaceId: workspace.id, userId: user.id, role: "owner" } })
  const project = await runtime.createProject({ workspaceId: workspace.id, title: "MMRW golden theorem package", slug: `mmrw-golden-${suffix}`, statement: "Exercise the complete mature-proof-to-publication lifecycle.", userId: user.id })
  const claim = await runtime.createClaim({ workspaceId: workspace.id, projectId: project.id, title: "Identity theorem", statementMarkdown: "For every element $x$ of a set, $x=x$.", kind: "theorem", status: "reviewed_informal_proof" })
  await runtime.createProofAttempt({ workspaceId: workspace.id, projectId: project.id, claimId: claim.id, bodyMarkdown: "Reflexivity proves the identity immediately.", status: "reviewed" })

  const initialAlignment: any = await runtime.assessProjectReleaseAlignment(workspace.id, project.id)
  assert.equal(initialAlignment.classification, "proof_graph_ready_for_synthesis")
  const aligned: any = await runtime.alignProjectReleaseState(workspace.id, project.id)
  const alignedAgain: any = await runtime.alignProjectReleaseState(workspace.id, project.id)
  assert.equal(aligned.idempotent, false)
  assert.equal(alignedAgain.idempotent, true)
  assert.equal(alignedAgain.workstream.id, aligned.workstream.id)
  assert.equal(await prisma.workstream.count({ where: { workspaceId: workspace.id, projectId: project.id, kind: "paper_synthesis" } }), 1)

  const releaseBeforeBuild: any = await runtime.getProjectReleaseContract(workspace.id, project.id)
  assert.deepEqual(releaseBeforeBuild.permitted_mutation_tools, ["align_project_release_state"])

  const assignment = await runtime.claimAgentAssignment({ workspaceId: workspace.id, projectId: project.id, workstreamId: aligned.workstream.id, sessionId: `mmrw-golden-author-${suffix}`, userId: user.id })
  const authorRun = await runtime.startAgentRun({ workspaceId: workspace.id, workstreamId: assignment.assignment.id, sessionId: `mmrw-golden-author-${suffix}`, model: "mmrw-golden-replay" })
  await runtime.updateStructuredManuscript({
    workspaceId: workspace.id,
    projectId: project.id,
    agentRunId: authorRun.agentRun.id,
    metadata: { title: "MMRW golden theorem package", authors: ["MMRW Golden Replay"], abstract_markdown: "A deterministic lifecycle regression fixture." },
    sections: [{ stableKey: "identity", ordinal: 1, kind: "proof", title: "Identity theorem", sourceFormat: "latex", contentMarkdown: "\\begin{theorem}For every element $x$ of a set, $x=x$.\\end{theorem}\n\\begin{proof}This is reflexivity.\\end{proof}", claimIds: [claim.id] }],
    obligationDrafts: [{ title: "Identity proof", statement_markdown: "Prove $x=x$ for every element of a set.", claim_id: claim.id, assumptions: ["x is an element of the stated set"], boundary_cases: ["the empty set is vacuous"], exact_manuscript_proof_present: true, required: true }]
  })
  assert.equal((await runtime.assessProjectReleaseAlignment(workspace.id, project.id)).classification, "native_aligned", "an in-progress structured manuscript must remain authorable before its first successful build")
  const built: any = await runtime.buildStructuredManuscript({ workspaceId: workspace.id, projectId: project.id, agentRunId: authorRun.agentRun.id })
  assert.equal(built.paper_build.status, "succeeded")
  const versionId = built.manuscript_version.id
  const obligation = await prisma.proofObligation.findFirstOrThrow({ where: { workspaceId: workspace.id, manuscriptVersionId: versionId, required: true } })
  assert.equal((await runtime.assessProjectReleaseAlignment(workspace.id, project.id)).classification, "native_aligned")
  const developmentContract: any = await runtime.getProjectReleaseContract(workspace.id, project.id)
  assert.deepEqual(developmentContract.permitted_mutation_tools, ["promote_manuscript_to_submission_candidate"])
  assert.equal(developmentContract.next_action.requires_user_decision, true)

  await runtime.promoteManuscriptToSubmissionCandidate({ workspaceId: workspace.id, manuscriptVersionId: versionId, loadBearingObligationIds: [obligation.id] })
  const gates = ["proof_integration", "novelty", "bibliography", "end_to_end_mathematical", "editorial"]
  for (const [ordinal, gate] of gates.entries()) {
    const readiness: any = await runtime.computeProjectSubmissionReadiness(workspace.id, project.id)
    assert.equal(readiness.next_required_action?.gate, gate)
    await approveNextGate({ userId: user.id, projectId: project.id, manuscriptVersionId: versionId, claimId: claim.id, obligationId: obligation.id, gate, ordinal })
  }

  const ready: any = await runtime.computeProjectSubmissionReadiness(workspace.id, project.id)
  assert.equal(ready.submission_ready, true)
  const handoffContract: any = await runtime.getProjectReleaseContract(workspace.id, project.id)
  assert.deepEqual(handoffContract.permitted_mutation_tools, ["prepare_external_review_package"])
  await assert.rejects(
    () => runtime.publishStructuredManuscript({ workspaceId: workspace.id, projectId: project.id, manuscriptVersionId: versionId }),
    /prepare_external_review_package first/
  )
  const statusBeforeReviewPackage = (await prisma.project.findUniqueOrThrow({ where: { id: project.id } })).status
  const reviewPackage: any = await runtime.prepareExternalReviewPackage({ workspaceId: workspace.id, projectId: project.id, manuscriptVersionId: versionId })
  const reviewPackageAgain: any = await runtime.prepareExternalReviewPackage({ workspaceId: workspace.id, projectId: project.id, manuscriptVersionId: versionId })
  assert.equal(reviewPackage.project_completed, false)
  assert.equal(reviewPackage.external_review_package.status, "preparing")
  assert.equal(reviewPackageAgain.package_id, reviewPackage.package_id)
  assert.equal((await prisma.project.findUniqueOrThrow({ where: { id: project.id } })).status, statusBeforeReviewPackage, "external-review packaging must not change project lifecycle status")

  const externalReview = await runtime.importExternalReview({
    workspaceId: workspace.id,
    projectId: project.id,
    manuscriptVersionId: versionId,
    theoremOrArtifactRef: `PublicationPackage:${reviewPackage.package_id}`,
    originalReviewText: "The exact review package was checked and is suitable for release.",
    provenance: "fresh_external_ai_chat",
    reviewerIdentity: "MMRW golden third-party fixture",
    independenceStatement: "This fixture represents a fresh external reviewer context.",
    reviewScope: `Exact ManuscriptVersion ${versionId} and its immutable PDF/source package.`,
    verdict: "approved",
    issues: [],
    requiredChanges: []
  })
  assert.equal(externalReview.verdict, "approved")
  const publishContract: any = await runtime.getProjectReleaseContract(workspace.id, project.id)
  assert.deepEqual(publishContract.permitted_mutation_tools, ["publish_manuscript"])
  assert.equal(publishContract.next_action.requires_user_decision, true)

  const publication: any = await runtime.publishStructuredManuscript({ workspaceId: workspace.id, projectId: project.id, manuscriptVersionId: versionId })
  const publicationAgain: any = await runtime.publishStructuredManuscript({ workspaceId: workspace.id, projectId: project.id, manuscriptVersionId: versionId })
  assert.equal(publication.package_id, reviewPackage.package_id)
  assert.equal(publicationAgain.package_id, publication.package_id)
  assert.equal((await prisma.project.findUniqueOrThrow({ where: { id: project.id } })).status, "completed")
  const finalContract: any = await runtime.getProjectReleaseContract(workspace.id, project.id)
  assert.equal(finalContract.state, "publication_released")
  assert.deepEqual(finalContract.permitted_mutation_tools, [])
  await assert.rejects(
    () => runtime.prepareExternalReviewPackage({ workspaceId: workspace.id, projectId: project.id, manuscriptVersionId: versionId }),
    /no longer an active external-review handoff/
  )
  console.log("MMRW golden lifecycle replay passed")
} finally {
  await prisma.workspace.delete({ where: { id: workspace.id } }).catch(() => undefined)
  await prisma.$disconnect()
}
