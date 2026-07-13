import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { createWriteStream } from "node:fs"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { pipeline } from "node:stream/promises"
import yazl from "yazl"
import { prisma } from "./db/prisma.js"
import { requireWorkspaceRole } from "./auth/permissions.js"
import * as runtime from "./research/runtime.js"
import { callTool } from "./mcp/server.js"
import { storagePath } from "./artifacts/storage.js"

if (!process.env.DATABASE_URL) {
  console.log("Skipping Maff v2 database smoke checks: DATABASE_URL is not set.")
  process.exit(0)
}

const suffix = randomUUID().slice(0, 8)
const user = await prisma.user.create({ data: { auth0Sub: `smoke|${suffix}`, email: `smoke-${suffix}@maff.local` } })
const stableUserId = user.id
const keycloakIssuer = "https://auth.lachlanbridges.com/realms/bridges"
const keycloakIdentity = await prisma.userIdentity.create({ data: { userId: user.id, issuer: keycloakIssuer, subject: `keycloak-${suffix}` } })
await prisma.userIdentity.create({ data: { userId: user.id, issuer: "https://synthetic-legacy.example/", subject: `legacy-${suffix}` } })
assert.equal((await prisma.userIdentity.findMany({ where: { userId: user.id } })).length, 2, "one stable user may retain multiple exact external identities")
const duplicateTarget = await prisma.user.create({ data: { auth0Sub: `smoke-duplicate|${suffix}`, email: `duplicate-${suffix}@maff.local` } })
await assert.rejects(() => prisma.userIdentity.create({ data: { userId: duplicateTarget.id, issuer: keycloakIdentity.issuer, subject: keycloakIdentity.subject } }), /Unique constraint/)
assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: stableUserId } })).id, stableUserId)
const identitiesBeforeRollback = await prisma.userIdentity.count()
const auditsBeforeRollback = await prisma.auditLog.count()
await assert.rejects(() => prisma.$transaction(async (tx) => {
  const provisional = await tx.userIdentity.create({ data: { userId: duplicateTarget.id, issuer: keycloakIssuer, subject: `rollback-${suffix}` } })
  await tx.auditLog.create({ data: { userId: user.id, action: "identity.oidc.link", targetType: "UserIdentity", targetId: provisional.id, details: { synthetic: true } } })
  await tx.userIdentity.create({ data: { userId: duplicateTarget.id, issuer: keycloakIdentity.issuer, subject: keycloakIdentity.subject } })
}), /Unique constraint/)
assert.equal(await prisma.userIdentity.count(), identitiesBeforeRollback)
assert.equal(await prisma.auditLog.count(), auditsBeforeRollback)
const workspace = await prisma.workspace.create({ data: { slug: `smoke-v2-${suffix}`, name: `Smoke v2 ${suffix}`, type: "private", ownerUserId: user.id } })
await prisma.workspaceMember.create({ data: { workspaceId: workspace.id, userId: user.id, role: "owner" } })

const project = await runtime.createProject({ workspaceId: workspace.id, title: "Maff v2 vertical slice", area: "smoke", statement: "Check project-goal-workstream-agent-report-review gates.", userId: user.id })
const proposedGoal = await runtime.proposeProjectGoal({ workspaceId: workspace.id, projectId: project.id, title: "Find proof routes", statement: "Produce multiple candidate routes.", successCriteria: ["Two routes", "Review passed"] })
const goal = await runtime.approveProjectGoal({ workspaceId: workspace.id, goalId: proposedGoal.id, userId: user.id })
assert.equal(goal.status, "approved")

const workstream = await runtime.createWorkstream({ workspaceId: workspace.id, projectId: project.id, goalId: goal.id, title: "Proof route generation", kind: "proof_route_generation", instructions: "Create claims and routes." })
const context = await runtime.getMyMaffContext({ userId: user.id, project: "vertical slice" })
assert.equal(context.active_project?.id, project.id)
const ergonomicClaim = await runtime.claimNextAssignment({ userId: user.id, project: "vertical slice", role: "ProofRouteAgent", sessionId: `session-${suffix}`, model: "smoke" })
assert.equal(ergonomicClaim.assignment?.id, workstream.id)
assert.equal(ergonomicClaim.agent_run?.role, "ProofRouteAgent")
const assignment = await runtime.claimAgentAssignment({ workspaceId: workspace.id, projectId: project.id, workstreamId: workstream.id, sessionId: `session-${suffix}-direct`, userId: user.id })
assert.equal(assignment.briefing.role, "ProofRouteAgent")
const run = await runtime.startAgentRun({ workspaceId: workspace.id, workstreamId: workstream.id, sessionId: `session-${suffix}-direct`, model: "smoke" })
assert.equal(run.agentRun.role, "ProofRouteAgent")

const claim = await runtime.createClaim({ workspaceId: workspace.id, projectId: project.id, title: "Smoke claim", statementMarkdown: "Every smoke test has a review gate.", kind: "conjecture", actorRole: "ProofRouteAgent" })
const routeA = await runtime.createProofRoute({ workspaceId: workspace.id, projectId: project.id, claimId: claim.id, title: "Direct route", strategyMarkdown: "Prove by inspecting the runtime.", requiredLemmas: ["Gate lemma"], firstTestableStep: "Create report", killCondition: "Review rejects", createdByWorkstreamId: workstream.id })
const routeB = await runtime.createProofRoute({ workspaceId: workspace.id, projectId: project.id, claimId: claim.id, title: "Counterexample route", strategyMarkdown: "Try to complete before review.", requiredLemmas: [], firstTestableStep: "Call complete early", killCondition: "Completion succeeds incorrectly", createdByWorkstreamId: workstream.id })
assert.ok(routeA.id && routeB.id)

const report = await runtime.submitWorkstreamReport({ workspaceId: workspace.id, workstreamId: workstream.id, title: "Route report", bodyMarkdown: "## Research process\nCreated two routes, including a disproof route.", linkedObjectRefs: [`Claim:${claim.id}`, `ProofRoute:${routeA.id}`, `ProofRoute:${routeB.id}`], uncertaintyNotes: ["Smoke uncertainty"], artifactRefs: [] })
assert.equal(report.report_status, "submitted")
assert.equal(report.workstream_status, "needs_review")

const rejection = await runtime.recordReviewRound({ workspaceId: workspace.id, workstreamId: workstream.id, reportId: report.report_id, verdict: "revision_required", bodyMarkdown: "Needs a sharper first testable step.", issues: ["First test unclear"], requiredChanges: ["Clarify step"], checkedRefs: [] })
assert.equal(rejection.verdict, "needs_revision")
await assert.rejects(() => runtime.completeWorkstream({ workspaceId: workspace.id, workstreamId: workstream.id }), /approved ReviewRound/)

const approval = await runtime.recordReviewRound({ workspaceId: workspace.id, workstreamId: workstream.id, reportId: report.report_id, verdict: "approved", bodyMarkdown: "Approved after revision.", issues: [], requiredChanges: [], checkedRefs: [`WorkstreamReport:${report.report_id}`] })
assert.equal(approval.verdict, "approved")
const completed = await runtime.completeWorkstream({ workspaceId: workspace.id, workstreamId: workstream.id })
assert.equal(completed.status, "completed")

await assert.rejects(() => runtime.updateClaimStatus({ workspaceId: workspace.id, claimId: claim.id, status: "lean_verified", actorRole: "ProofAttemptAgent" }), /ProofAttemptAgent/)

const theorem = await runtime.createLeanTheorem({ workspaceId: workspace.id, projectId: project.id, leanName: "smoke_theorem", proofFile: "Smoke.lean", statementMarkdown: "theorem smoke : True := by trivial", hasSorry: true, hasAxiom: false })
const checked = await runtime.markLeanVerified({ workspaceId: workspace.id, leanTheoremId: theorem.id })
assert.notEqual(checked.status, "lean_verified")

const longContent = "# Complete body\n\n" + "x".repeat(600)
const artifact = await runtime.createResearchArtifact({ workspaceId: workspace.id, projectId: project.id, title: "Long artifact", kind: "survey_memo", status: "active", contentMarkdown: longContent })
const fetchedArtifact = await runtime.getResearchArtifact(workspace.id, artifact.id)
assert.equal(fetchedArtifact.contentMarkdown, longContent)
assert.ok((fetchedArtifact.contentMarkdown?.length ?? 0) > 280)
const artifactBundle = await runtime.getResearchArtifactBundle(workspace.id, [artifact.id])
assert.deepEqual(artifactBundle.map((item) => item.id), [artifact.id])
await assert.rejects(() => runtime.getResearchArtifact(randomUUID(), artifact.id), /Research artifact not found/)
await assert.rejects(() => runtime.getResearchArtifact(workspace.id, randomUUID()), /Research artifact not found/)

// Atomicity regression: malformed optional review data must not leave a provisional approval behind.
const reviewsBeforeMalformedInput = await prisma.reviewRound.count({ where: { workspaceId: workspace.id, workstreamId: workstream.id } })
await assert.rejects(
  () => runtime.recordReviewRound({ workspaceId: workspace.id, workstreamId: workstream.id, verdict: "approved", bodyMarkdown: "This must roll back.", issues: [], requiredChanges: [], checkedRefs: [], obligationChecks: [{} as any] }),
  /obligationChecks\[0\]\.proofObligationId/
)
assert.equal(await prisma.reviewRound.count({ where: { workspaceId: workspace.id, workstreamId: workstream.id } }), reviewsBeforeMalformedInput)
const outsider = await prisma.user.create({ data: { auth0Sub: `smoke-outsider|${suffix}`, email: `smoke-outsider-${suffix}@maff.local` } })
await assert.rejects(() => requireWorkspaceRole(outsider.id, workspace.id, "viewer"), /Workspace permission denied/)
await assert.rejects(
  () => callTool("get_project", { workspace_id: workspace.id, project_id: project.id }, { userId: outsider.id, claimsScope: "maff:read", resourceAccess: { maff: { roles: ["reader"] } } }),
  /Workspace permission denied/
)

const controlRoom = await runtime.getProjectControlRoom(workspace.id, project.id)
assert.ok(controlRoom.workstreams_by_status.completed?.some((item) => item.id === workstream.id))

// Regression: approved ingredients and a compile-clean PDF never transitively approve a manuscript.
const sourceA = await runtime.createResearchArtifact({ workspaceId: workspace.id, projectId: project.id, title: "Detailed uniform majorant", kind: "proof_skeleton", contentMarkdown: "Full uniform moving-start majorant proof." })
const manuscript = await runtime.createResearchArtifact({ workspaceId: workspace.id, projectId: project.id, title: "Integrated manuscript", kind: "paper_draft", contentMarkdown: "The bound is standard." })
const manuscriptVersion = await runtime.createManuscriptVersion({ workspaceId: workspace.id, projectId: project.id, artifactId: manuscript.id, parentArtifactIds: [sourceA.id], claimIds: [claim.id] })
const obligation = await runtime.createProofObligation({ workspaceId: workspace.id, projectId: project.id, manuscriptVersionId: manuscriptVersion.id, claimId: claim.id, sourceArtifactId: sourceA.id, title: "Uniform moving-start majorant", statementMarkdown: "Uniform majorant on the stated domain.", manuscriptLocation: "Lemma 4.1" })
const canonicalManuscript = await runtime.promoteManuscriptVersion({ workspaceId: workspace.id, manuscriptVersionId: manuscriptVersion.id })
assert.equal(canonicalManuscript.isCanonical, true)
assert.equal(canonicalManuscript.verificationState, "ledger_complete")
await runtime.recordReviewRound({ workspaceId: workspace.id, workstreamId: workstream.id, verdict: "approved", reviewType: "ingredient_correctness", targetVersion: sourceA.id, bodyMarkdown: "Source proof correct.", issues: [], requiredChanges: [], checkedRefs: [sourceA.id] })
await runtime.recordReviewRound({ workspaceId: workspace.id, workstreamId: workstream.id, verdict: "approved", reviewType: "compile", targetVersion: manuscriptVersion.id, bodyMarkdown: "PDF compiled.", issues: [], requiredChanges: [], checkedRefs: [manuscript.id] })
let readiness = await runtime.computeProjectSubmissionReadiness(workspace.id, project.id)
assert.equal(readiness.submission_ready, false)
assert.equal((readiness.gates as any).proof_integration.satisfied, false)
const preservationGap = await runtime.createGap({ workspaceId: workspace.id, projectId: project.id, claimId: claim.id, title: "Uniform majorant omitted during integration", descriptionMarkdown: "Vague assertion replaced detailed proof.", severity: "major" })
readiness = await runtime.computeProjectSubmissionReadiness(workspace.id, project.id)
assert.ok(readiness.reasons.some((reason) => reason.includes(preservationGap.id)))
await runtime.resolveGap({ workspaceId: workspace.id, gapId: preservationGap.id, suggestedResolution: "Restore the argument." })
await runtime.recordReviewRound({ workspaceId: workspace.id, workstreamId: workstream.id, verdict: "approved", reviewType: "proof_integration", targetVersion: manuscriptVersion.id, bodyMarkdown: "Obligation restored and checked.", issues: [], requiredChanges: [], checkedRefs: [sourceA.id, manuscript.id], obligationChecks: [{ proofObligationId: obligation.id, status: "preserved", evidenceMarkdown: "Lemma 4.1 gives the required bound." }] })
await runtime.recordReviewRound({ workspaceId: workspace.id, workstreamId: workstream.id, verdict: "approved", reviewType: "novelty", targetVersion: manuscriptVersion.id, scope: { claim_ids: [claim.id] }, bodyMarkdown: "No exact counterpart found; terminology limitations recorded.", issues: [], requiredChanges: [], checkedRefs: [] })
await runtime.recordReviewRound({ workspaceId: workspace.id, workstreamId: workstream.id, verdict: "approved", reviewType: "bibliography", targetVersion: manuscriptVersion.id, bodyMarkdown: "References audited.", issues: [], requiredChanges: [], checkedRefs: [] })
readiness = await runtime.computeProjectSubmissionReadiness(workspace.id, project.id)
assert.equal(readiness.submission_ready, false)
assert.equal((readiness.gates as any).end_to_end_mathematical.satisfied, false)
await runtime.recordReviewRound({ workspaceId: workspace.id, workstreamId: workstream.id, verdict: "approved", reviewType: "end_to_end_mathematical", targetVersion: manuscriptVersion.id, independence: "independent_reviewer", bodyMarkdown: "Independent complete manuscript and source proof check.", issues: [], requiredChanges: [], checkedRefs: [sourceA.id, manuscript.id] })
readiness = await runtime.computeProjectSubmissionReadiness(workspace.id, project.id)
assert.equal(readiness.submission_ready, true)
await runtime.updateResearchArtifact({ workspaceId: workspace.id, id: manuscript.id, patch: { contentMarkdown: "A substantively changed manuscript." } })
readiness = await runtime.computeProjectSubmissionReadiness(workspace.id, project.id)
assert.equal(readiness.submission_ready, false)

// Robustness regression: a substantial manuscript without an exact proof-obligation ledger
// remains an unverified candidate; it cannot become canonical or receive manuscript gates.
const ledgerless = await runtime.createResearchArtifact({ workspaceId: workspace.id, projectId: project.id, title: "Ledgerless theorem manuscript", kind: "paper_draft", contentMarkdown: "# Theorem\nA nontrivial statement with proof." })
const ledgerlessVersion = await runtime.createManuscriptVersion({ workspaceId: workspace.id, projectId: project.id, artifactId: ledgerless.id, claimIds: [claim.id] })
assert.equal(ledgerlessVersion.isCanonical, false)
assert.equal(ledgerlessVersion.verificationState, "unverified_candidate")
await assert.rejects(
  () => runtime.promoteManuscriptVersion({ workspaceId: workspace.id, manuscriptVersionId: ledgerlessVersion.id }),
  /proof obligation/i
)
await assert.rejects(
  () => runtime.recordReviewRound({ workspaceId: workspace.id, workstreamId: workstream.id, verdict: "approved", reviewType: "compile", targetVersion: ledgerlessVersion.id, targetObjectType: "ResearchArtifact", targetObjectId: ledgerless.id, bodyMarkdown: "Compile clean.", issues: [], requiredChanges: [], checkedRefs: [] }),
  /targetObject/i
)

// MMRW replay-shaped safety case: an external referee is immutable evidence, not a Maff
// AgentRun; strategic debt queues a review and an independent strategic verdict clears it.
const externalReferee = await runtime.importExternalReview({ workspaceId: workspace.id, projectId: project.id, manuscriptVersionId: manuscriptVersion.id, theoremOrArtifactRef: `ManuscriptVersion:${manuscriptVersion.id}`, originalReviewText: "The bilateral Green residue theorem is not established; the governance gap remains load-bearing.", provenance: "journal_referee", independenceStatement: "Independent journal referee report supplied outside Maff.", reviewScope: "Exact manuscript version and bilateral Green residue obligation.", verdict: "needs_revision", issues: ["bilateral Green residue theorem absent", "governance gap propagates"], requiredChanges: ["Repair both mathematical streams before regeneration"] })
assert.equal((externalReferee as any).createdByAgentRunId, undefined)
const healthBeforeStrategic = await runtime.getProjectHealth(workspace.id, project.id)
assert.equal(healthBeforeStrategic.circuit_breakers.strategic_review_queued, true)
const strategic = await runtime.createStrategicReviewRound({ workspaceId: workspace.id, projectId: project.id, verdict: "continue_with_rebase", reviewerIndependence: "independent StrategicReviewer with no current proof assignment", whatChangedMarkdown: "The replay isolated the missing bilateral residue obligation and governance dependency.", loopDiagnosisMarkdown: "Repeated manuscript repair without an exact ledger would loop.", blockerStructureMarkdown: "The bilateral residue and governance gaps are structural but separately repairable.", alternativesMarkdown: "Considered immediate submission, weaker theorem, and two-stream repair; selected two-stream repair.", branchAllocation: [{ branch: "main", state: "mainline" }, { branch: "weaker-result", state: "exploratory" }], nextMoves: [{ test: "Check bilateral residue", information_gain: "high", prerequisites: [], success_condition: "proof closes", kill_condition: "counterexample", decision: "promote or weaken" }, { test: "Repair governance gap", information_gain: "high", prerequisites: [], success_condition: "dependency graph closes", kill_condition: "dependency fails", decision: "rebase" }, { test: "End-to-end re-review", information_gain: "medium", prerequisites: ["two repairs"], success_condition: "independent approval", kill_condition: "major revision", decision: "submit or pivot" }], probabilityEstimates: [{ dimension: "truth", range: "60-80%" }, { dimension: "provable", range: "40-60%" }, { dimension: "methods", range: "35-55%" }, { dimension: "publishable_fallback", range: "70-85%" }, { dimension: "next_epoch_progress", range: "60-75%" }] })
assert.equal(strategic.verdict, "continue_with_rebase")
const healthAfterStrategic = await runtime.getProjectHealth(workspace.id, project.id)
assert.equal(healthAfterStrategic.circuit_breakers.downstream_paused, false)

// Durable physical artifact regression: an ephemeral path alone cannot pass, while
// ingested bytes survive source deletion/mutation and remain reviewer-retrievable.
const physicalWorkstream = await runtime.createWorkstream({ workspaceId: workspace.id, projectId: project.id, goalId: goal.id, title: "Generate exact manuscript files", kind: "computation", instructions: "Generate a physical manuscript ZIP and compiled PDF.", reviewPolicy: { min_approved_rounds: 1, requires_physical_artifacts: true }, successCriteria: ["Durable ZIP with main.tex and main.pdf"] })
const physicalReport = await runtime.createResearchArtifact({ workspaceId: workspace.id, projectId: project.id, title: "Physical generation report", kind: "paper_draft", filePath: "/mnt/data/vanished.zip", contentMarkdown: "The physical artifact was registered." })
const draftPhysicalSubmission = await runtime.createOrUpdateWorkstreamReport({ workspaceId: workspace.id, workstreamId: physicalWorkstream.id, title: "Generated manuscript", bodyMarkdown: "Registered the exact physical artifact and generated manuscript ZIP.", artifactRefs: [physicalReport.id, manuscriptVersion.id] })
await assert.rejects(() => runtime.submitReportForReview({ workspaceId: workspace.id, reportId: draftPhysicalSubmission.id }), /no ingested durable Artifact/i)

const tempDir = await mkdtemp(path.join(os.tmpdir(), "maff-artifact-smoke-"))
const zipPath = path.join(tempDir, "exact-bundle.zip")
const zip = new yazl.ZipFile()
zip.addBuffer(Buffer.from("\\documentclass{article}\\begin{document}Exact\\end{document}\n"), "main.tex")
zip.addBuffer(Buffer.from("%PDF-1.4\n% synthetic exact smoke PDF\n"), "main.pdf")
zip.addBuffer(Buffer.from("@article{exact,title={Exact}}\n"), "references.bib")
zip.end()
await pipeline(zip.outputStream, createWriteStream(zipPath))
const originalBytes = await readFile(zipPath)
const originalHash = createHash("sha256").update(originalBytes).digest("hex")
const oldFetch = globalThis.fetch
let durableArtifact: any
try {
  globalThis.fetch = async () => new Response(originalBytes, { status: 200, headers: { "content-type": "application/zip" } })
  durableArtifact = await callTool("create_artifact", {
    workspace_id: workspace.id,
    project_id: project.id,
    workstream_id: physicalWorkstream.id,
    research_artifact_id: physicalReport.id,
    title: "Exact manuscript bundle",
    kind: "other",
    file: { download_url: "https://files.example.test/mmrw/exact-bundle.zip", file_id: `exact-bundle-${suffix}`, mime_type: "application/zip", file_name: "exact-bundle.zip" },
    expected_sha256: originalHash,
    metadata: { required_files: ["main.tex", "main.pdf", "references.bib"] }
  }, { userId: user.id, claimsScope: "maff:write", resourceAccess: { maff: { roles: ["editor"] } }, sub: `upload-agent-${suffix}` }) as any
  const beforeMismatchCount = await prisma.artifact.count({ where: { workspaceId: workspace.id } })
  await assert.rejects(() => callTool("create_artifact", {
    workspace_id: workspace.id,
    project_id: project.id,
    workstream_id: physicalWorkstream.id,
    title: "Bad expected hash bundle",
    file: { download_url: "https://files.example.test/mmrw/exact-bundle.zip", file_id: `bad-hash-${suffix}`, mime_type: "application/zip", file_name: "exact-bundle.zip" },
    expected_sha256: "0".repeat(64)
  }, { userId: user.id, claimsScope: "maff:write", resourceAccess: { maff: { roles: ["editor"] } }, sub: `upload-agent-${suffix}` }), /hash mismatch/i)
  assert.equal(await prisma.artifact.count({ where: { workspaceId: workspace.id } }), beforeMismatchCount)
} finally {
  globalThis.fetch = oldFetch
}
assert.equal(durableArtifact.sha256, originalHash)
assert.equal(durableArtifact.byteSize, originalBytes.length)
await runtime.attachArtifactToManuscriptVersion({ workspaceId: workspace.id, artifactId: durableArtifact.id, manuscriptVersionId: manuscriptVersion.id, role: "source_bundle" })
await writeFile(zipPath, "mutated after ingestion")
const replacement = await runtime.createArtifactFromPath({ workspaceId: workspace.id, projectId: project.id, workstreamId: physicalWorkstream.id, path: zipPath, title: "Mutated replacement candidate", kind: "other" })
assert.notEqual(replacement.id, durableArtifact.id)
assert.notEqual(replacement.sha256, durableArtifact.sha256)
await rm(tempDir, { recursive: true, force: true })

const freshVerification = await runtime.verifyArtifact(workspace.id, durableArtifact.id)
assert.equal(freshVerification.ok, true)
assert.equal(freshVerification.actualSha256, originalHash)
const archive = await runtime.listArtifactArchive(workspace.id, durableArtifact.id)
assert.ok(archive.entries.some((entry) => entry.path === "main.tex"))
assert.ok(archive.entries.some((entry) => entry.path === "main.pdf"))
const exactStored = await runtime.getArtifactStorageFile(workspace.id, durableArtifact.id)
assert.deepEqual(await readFile(exactStored.file), originalBytes)
const freshReviewerDownload = await callTool("download_artifact", { workspace_id: workspace.id, artifact_id: durableArtifact.id }, { userId: user.id, claimsScope: "maff:read", resourceAccess: { maff: { roles: ["reader"] } }, sub: `fresh-reviewer-${suffix}` }) as any
assert.match(freshReviewerDownload.uri, new RegExp(`/api/artifacts/${durableArtifact.id}/content`))
assert.equal(freshReviewerDownload.sha256, originalHash)
const workstreamWithArtifact = await runtime.getWorkstream(workspace.id, physicalWorkstream.id)
assert.ok(workstreamWithArtifact.artifacts.some((candidate) => candidate.id === durableArtifact.id))
assert.ok((await runtime.listArtifacts({ workspaceId: workspace.id, manuscriptVersionId: manuscriptVersion.id })).some((candidate) => candidate.id === durableArtifact.id))
await assert.rejects(() => runtime.getArtifact(randomUUID(), durableArtifact.id), /not found/i)
await assert.rejects(() => callTool("get_artifact", { workspace_id: workspace.id, artifact_id: durableArtifact.id }, { userId: outsider.id, claimsScope: "maff:read", resourceAccess: { maff: { roles: ["reader"] } } }), /Workspace permission denied/)
const metadataExport = await runtime.getResearchArtifactBundle(workspace.id, [physicalReport.id])
assert.equal(metadataExport[0].physicalArtifacts[0].id, durableArtifact.id)
const submittedPhysical = await runtime.submitReportForReview({ workspaceId: workspace.id, reportId: draftPhysicalSubmission.id })
assert.equal(submittedPhysical.report_status, "submitted")

// Missing managed data is an explicit integrity failure, never metadata-only success.
await rm(storagePath(replacement.storageKey!), { force: true })
const missingVerification = await runtime.verifyArtifact(workspace.id, replacement.id)
assert.equal(missingVerification.ok, false)
assert.equal(missingVerification.status, "missing")
await assert.rejects(() => runtime.downloadArtifactReference(workspace.id, replacement.id), /missing/i)

await prisma.$disconnect()
console.log("Maff v2 database smoke checks passed")
