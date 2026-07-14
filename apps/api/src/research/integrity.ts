import { createHash, randomBytes, randomUUID } from "node:crypto"
import type { AgentRole, ComputedIndependence, ContinuationMode, ProjectAuditMode, ReviewType } from "@prisma/client"
import { prisma } from "../db/prisma.js"
import { verifyStoredFile } from "../artifacts/storage.js"
import { computeSubmissionReadiness, READINESS_POLICY_VERSION } from "./readiness.js"

const constructive = new Set(["created", "authored", "edited", "integrated", "repaired", "computed", "compiled"])
const epistemicReviewTypes = new Set(["proof_integration", "end_to_end_mathematical", "novelty", "bibliography", "editorial", "numerical_verification", "formal_verification"])

const array = (value: unknown): any[] => Array.isArray(value) ? value : []
const object = (value: unknown): Record<string, any> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {}
const hash = (value: unknown) => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex")
const slugify = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || `import-${randomUUID().slice(0, 8)}`

export async function recordObjectContribution(input: { workspaceId: string; projectId: string; agentRunId: string; objectType: string; objectId: string; versionHash?: string; type: string; metadata?: unknown }) {
  if (!constructive.has(input.type) && !["read", "reviewed", "triaged", "approved_for_stage"].includes(input.type)) throw new Error(`Invalid contribution type: ${input.type}`)
  const run = await prisma.agentRun.findFirstOrThrow({ where: { workspaceId: input.workspaceId, projectId: input.projectId, id: input.agentRunId } })
  return prisma.objectContribution.create({ data: { ...input, type: input.type as any, metadata: object(input.metadata) } })
}

export async function recordObjectAccess(input: { workspaceId: string; projectId: string; agentRunId: string; objectType: string; objectId: string; artifactId?: string; operation: string; contentHash?: string; coverage?: unknown }) {
  await prisma.agentRun.findFirstOrThrow({ where: { workspaceId: input.workspaceId, projectId: input.projectId, id: input.agentRunId } })
  if (input.artifactId) {
    const artifact = await prisma.artifact.findFirstOrThrow({ where: { workspaceId: input.workspaceId, projectId: input.projectId, id: input.artifactId } })
    if (artifact.storageKey && artifact.sha256 && artifact.byteSize !== null) {
      const verification = await verifyStoredFile(artifact.storageKey, artifact.sha256, artifact.byteSize)
      if (!verification.ok) throw new Error(`Artifact access evidence rejected: exact bytes are ${verification.status}.`)
    }
  }
  return prisma.objectAccessEvidence.create({ data: { ...input, coverage: object(input.coverage) } })
}

async function targetContributorRuns(workspaceId: string, projectId: string, objectType: string, objectId: string) {
  const keys = new Set([`${objectType}:${objectId}`])
  if (objectType === "ManuscriptVersion") {
    const links = await prisma.researchLink.findMany({ where: { workspaceId, projectId, sourceType: "ManuscriptVersion", sourceId: objectId } })
    for (const link of links) keys.add(`${link.targetType}:${link.targetId}`)
  }
  const clauses = [...keys].map((key) => { const at = key.indexOf(":"); return { objectType: key.slice(0, at), objectId: key.slice(at + 1) } })
  return prisma.objectContribution.findMany({ where: { workspaceId, projectId, type: { in: [...constructive] as any }, OR: clauses }, include: { agentRun: true } })
}

export async function computeReviewEligibility(input: { workspaceId: string; projectId: string; reviewerRunId: string; targetObjectType: string; targetObjectId: string; reviewType: string }) {
  const reviewer = await prisma.agentRun.findFirstOrThrow({ where: { workspaceId: input.workspaceId, projectId: input.projectId, id: input.reviewerRunId } })
  const contributors = await targetContributorRuns(input.workspaceId, input.projectId, input.targetObjectType, input.targetObjectId)
  const sameRun = contributors.some((c) => c.agentRunId === reviewer.id)
  const sameSession = contributors.some((c) => c.agentRun.sessionId === reviewer.sessionId)
  const reviewerConstructiveProjectWork = await prisma.objectContribution.count({ where: { workspaceId: input.workspaceId, projectId: input.projectId, agentRunId: reviewer.id, type: { in: [...constructive] as any } } })
  const independence: ComputedIndependence = sameRun || sameSession ? "self_check" : reviewerConstructiveProjectWork ? "fresh_context_same_project" : contributors.length ? "author_disjoint" : "fully_disjoint_internal_referee"
  const required = input.reviewType === "end_to_end_mathematical" ? ["author_disjoint", "fully_disjoint_internal_referee"] : epistemicReviewTypes.has(input.reviewType) ? ["author_disjoint", "fully_disjoint_internal_referee"] : ["fresh_context_same_project", "author_disjoint", "fully_disjoint_internal_referee"]
  return { eligible: required.includes(independence), independence, required, contributor_run_ids: [...new Set(contributors.map((c) => c.agentRunId))], conflicting_session: sameSession ? reviewer.sessionId : null }
}

export async function createReviewAssignment(input: { workspaceId: string; projectId: string; workstreamId: string; reviewerRunId: string; reviewType: string; targetObjectType: string; targetObjectId: string; targetHash?: string; manuscriptVersionId?: string; permittedArtifactIds?: string[]; briefing: unknown; leaseExpiresAt: Date }) {
  const eligibility = await computeReviewEligibility(input)
  if (!eligibility.eligible) throw new Error(`Reviewer run is ineligible for ${input.reviewType}: computed independence is ${eligibility.independence}. Start a fresh chat.`)
  const token = randomBytes(32).toString("hex")
  const assignment = await prisma.reviewAssignment.create({ data: { workspaceId: input.workspaceId, projectId: input.projectId, workstreamId: input.workstreamId, reviewerRunId: input.reviewerRunId, reviewType: input.reviewType as ReviewType, targetObjectType: input.targetObjectType, targetObjectId: input.targetObjectId, targetHash: input.targetHash, manuscriptVersionId: input.manuscriptVersionId, independence: eligibility.independence, eligibilitySnapshot: eligibility, sealedBriefingHash: hash(input.briefing), permittedArtifactIds: input.permittedArtifactIds ?? [], tokenHash: hash(token), leaseExpiresAt: input.leaseExpiresAt } })
  return { assignment, submission_token: token, eligibility }
}

export async function validateReviewAssignment(input: { workspaceId: string; assignmentId: string; submissionToken: string; reviewerRunId: string; reviewType: string; targetObjectId: string; workstreamId: string }) {
  const assignment = await prisma.reviewAssignment.findFirstOrThrow({ where: { workspaceId: input.workspaceId, id: input.assignmentId }, include: { reviewerRun: true } })
  if (assignment.status !== "claimed" || assignment.leaseExpiresAt <= new Date()) throw new Error("Review assignment is no longer active.")
  if (assignment.tokenHash !== hash(input.submissionToken)) throw new Error("Review assignment token is invalid.")
  if (assignment.reviewerRunId !== input.reviewerRunId || assignment.reviewType !== input.reviewType || assignment.targetObjectId !== input.targetObjectId || assignment.workstreamId !== input.workstreamId) throw new Error("Review submission does not match its locked assignment.")
  if (!["started", "running"].includes(assignment.reviewerRun.status)) throw new Error("Reviewing AgentRun must be active when the review is submitted.")
  return assignment
}

export function validateReviewEvidence(input: { reviewType: string; verdict: string; evidenceSections?: unknown; obligationChecks?: Array<{ status: string; evidenceMarkdown?: string }>; checkedRefs?: unknown; scope?: unknown }) {
  const sections = array(input.evidenceSections).map(object)
  const matching = sections.find((section) => section.sectionType === input.reviewType || section.section_type === input.reviewType)
  if (!matching || String(matching.evidenceMarkdown ?? matching.evidence_markdown ?? "").trim().length < 120) throw new Error(`Assigned ${input.reviewType} reviews require a substantive matching evidence section.`)
  if (input.reviewType === "proof_integration" && input.verdict === "approved" && (input.obligationChecks ?? []).some((check) => check.status === "preserved" && String(check.evidenceMarkdown ?? "").trim().length < 40)) throw new Error("Every preserved obligation requires specific evidence, not a bare checked id.")
  if (input.reviewType === "end_to_end_mathematical" && array(matching.attackCategories ?? matching.attack_categories).length < 4) throw new Error("End-to-end mathematical review requires at least four recorded attack categories.")
  if (input.reviewType === "novelty" && array(matching.externalSources ?? matching.external_sources).length === 0) throw new Error("Novelty review requires stored external theorem-comparison sources.")
  if (["novelty", "bibliography"].includes(input.reviewType) && array(input.checkedRefs).length === 0) throw new Error(`${input.reviewType} review requires checked references.`)
  return sections
}

function recommendedRoleFor(action: Record<string, any>, fallback: AgentRole): AgentRole {
  const role = action.role
  return typeof role === "string" ? role as AgentRole : fallback
}

export async function ensureProjectActionable(workspaceId: string, projectId: string, createIfMissing = true, suggestedAction?: Record<string, any>) {
  const project = await prisma.project.findFirstOrThrow({ where: { workspaceId, id: projectId } })
  if (["completed", "terminated", "archived", "paused"].includes(project.status)) return { state: "terminal_or_paused", actionable: false, project_status: project.status }
  const [runnable, active, review, waiting, openGaps] = await Promise.all([
    prisma.workstream.findFirst({ where: { workspaceId, projectId, status: { in: ["planned", "ready", "revision_required"] } }, orderBy: [{ priority: "desc" }, { updatedAt: "asc" }] }),
    prisma.workstream.findFirst({ where: { workspaceId, projectId, status: { in: ["claimed", "running"] } } }),
    prisma.workstream.findFirst({ where: { workspaceId, projectId, status: "needs_review" } }),
    prisma.projectWaitingState.findFirst({ where: { workspaceId, projectId, active: true } }),
    prisma.gap.findMany({ where: { workspaceId, projectId, status: { in: ["open", "assigned"] }, severity: { in: ["major", "fatal"] } }, orderBy: { updatedAt: "asc" } })
  ])
  if (runnable || active || review || waiting) return { state: runnable ? "runnable" : active ? "active" : review ? "awaiting_review" : "waiting", actionable: Boolean(runnable || active || review), next_workstream: runnable ?? active ?? review, waiting }
  if (!createIfMissing) return { state: "workflow_frontier_empty", actionable: false, open_gap_ids: openGaps.map((gap) => gap.id) }
  const proposed = object(suggestedAction)
  const proposedRole = proposed.role ? recommendedRoleFor(proposed, "ProjectCoordinator") : null
  const title = openGaps.length ? `Repair: ${openGaps[0].title}` : String(proposed.title ?? "Reconcile empty project frontier")
  const isReview = proposedRole === "HostileReviewer"
  const workstream = await prisma.workstream.create({ data: { workspaceId, projectId, title, kind: openGaps.length ? "gap_analysis" : isReview ? "hostile_review" : "project_coordination", coordinatorRole: openGaps.length ? "GapAnalyst" : proposedRole ?? "ProjectCoordinator", status: openGaps.length ? "ready" : isReview ? "needs_review" : "ready", priority: openGaps.length ? 90 : 100, targetObjectType: openGaps.length ? "Gap" : String(proposed.target_object_type ?? "Project"), targetObjectId: openGaps[0]?.id ?? String(proposed.target_object_id ?? projectId), instructions: openGaps.length ? `Resolve or refine blocking gap ${openGaps[0].id}. Preserve evidence and submit a structured handoff.` : String(proposed.instructions ?? proposed.description ?? "Determine why the active project has no actionable frontier. Create only evidence-linked next work, or record an explicit waiting/paused/terminal state."), allowedWrites: array(proposed.allowed_writes).length ? array(proposed.allowed_writes) : ["Gap", "WorkstreamReport", "AgentMessage", "RunOutcome"], forbiddenActions: ["Do not invent busywork or declare publication readiness."], successCriteria: array(proposed.success_criteria).length ? array(proposed.success_criteria) : ["Project has a justified next assignment, waiting condition, or terminal state."], reviewPolicy: !openGaps.length && isReview ? { min_approved_rounds: 1, review_type: String(proposed.review_type ?? "other") } : { min_approved_rounds: 1, review_type: "other" } } })
  return { state: "reconciled", actionable: true, next_workstream: workstream, created: true }
}

export async function submitRunOutcome(input: { workspaceId: string; agentRunId: string; completedWork?: unknown; changedObjects?: unknown; evidenceGenerated?: unknown; checksPerformed?: unknown; problemsEncountered?: unknown; unresolvedUncertainty?: unknown; gapsCreated?: unknown; gapsResolved?: unknown; nextAction?: unknown }) {
  const run = await prisma.agentRun.findFirstOrThrow({ where: { workspaceId: input.workspaceId, id: input.agentRunId }, include: { project: true, workstream: true } })
  if (!["started", "running", "submitted"].includes(run.status)) throw new Error("Only an active or submitted AgentRun can produce a run outcome.")
  const nextAction = object(input.nextAction)
  let frontier = await ensureProjectActionable(input.workspaceId, run.projectId, false)
  const nextRole = recommendedRoleFor(nextAction, run.role)
  const reviewBoundary = nextRole === "HostileReviewer" || ["review", "audit", "novelty", "editorial", "strategic"].some((word) => String(nextAction.kind ?? nextAction.type ?? "").toLowerCase().includes(word))
  let mode: ContinuationMode = reviewBoundary ? "fresh_chat_required" : "same_chat"
  let reason = reviewBoundary ? "The next action crosses from construction to independent judgment." : "The next action remains constructive work in the same role and context."
  if (nextAction.waiting_for_user) { mode = "waiting_for_user"; reason = String(nextAction.reason ?? "User direction is required.") }
  if (nextAction.waiting_for_external_condition) { mode = "waiting_for_external_condition"; reason = String(nextAction.reason ?? "An external condition must change.") }
  const requestedTerminalStatus = ["completed", "terminated"].includes(String(nextAction.project_status)) ? String(nextAction.project_status) : null
  if (requestedTerminalStatus) { mode = "terminal"; reason = String(nextAction.reason ?? `Project is ${requestedTerminalStatus}.`) }
  if (["completed", "terminated", "archived"].includes(run.project.status)) { mode = "terminal"; reason = `Project is ${run.project.status}.` }
  if (mode !== "terminal" && !frontier.actionable && !["waiting_for_user", "waiting_for_external_condition"].includes(mode)) frontier = await ensureProjectActionable(input.workspaceId, run.projectId, true, nextAction)
  const title = String(nextAction.title ?? (frontier as any).next_workstream?.title ?? "the next Maff assignment")
  const userPrompt = mode === "same_chat" ? `Type continue to ${title.toLowerCase()}.` : mode === "fresh_chat_required" ? `Start a new chat and say: "Use Maff. Continue ${run.project.title} with ${title}."` : mode === "terminal" ? "No further assignment is required." : reason
  const outcome = await prisma.$transaction(async (tx) => {
    if (["waiting_for_user", "waiting_for_external_condition"].includes(mode)) {
      await tx.projectWaitingState.updateMany({ where: { workspaceId: input.workspaceId, projectId: run.projectId, active: true }, data: { active: false, resolvedAt: new Date() } })
      await tx.projectWaitingState.create({ data: { workspaceId: input.workspaceId, projectId: run.projectId, reason, unblockCondition: String(nextAction.unblock_condition ?? reason), ownerRole: nextRole } })
      await tx.project.update({ where: { id: run.projectId }, data: { status: "waiting" } })
    } else if (requestedTerminalStatus) {
      await tx.project.update({ where: { id: run.projectId }, data: { status: requestedTerminalStatus as any } })
    }
    const created = await tx.runOutcome.create({ data: { workspaceId: input.workspaceId, projectId: run.projectId, agentRunId: run.id, completedWork: array(input.completedWork), changedObjects: array(input.changedObjects), evidenceGenerated: array(input.evidenceGenerated), checksPerformed: array(input.checksPerformed), problemsEncountered: array(input.problemsEncountered), unresolvedUncertainty: array(input.unresolvedUncertainty), gapsCreated: array(input.gapsCreated), gapsResolved: array(input.gapsResolved), nextAction, continuationMode: mode, continuationReason: reason, userPrompt } })
    await tx.agentRun.update({ where: { id: run.id }, data: { status: "completed", finishedAt: new Date(), outputSummary: array(input.completedWork).map(String).join("; ") } })
    return created
  })
  return { outcome, frontier, continuation: { mode, reason, prompt: userPrompt } }
}

export async function beginProjectImport(input: { workspaceId: string; projectId?: string; title: string; provenance: unknown }) {
  return prisma.projectImport.create({ data: { workspaceId: input.workspaceId, projectId: input.projectId, title: input.title, provenance: object(input.provenance) } })
}

export async function analyzeProjectImport(input: { workspaceId: string; importId: string; artifactIds?: string[]; proposedMap: unknown }) {
  const found = await prisma.artifact.count({ where: { workspaceId: input.workspaceId, id: { in: input.artifactIds ?? [] } } })
  if (found !== (input.artifactIds ?? []).length) throw new Error("Every import artifact must be durably accessible in the workspace.")
  return prisma.projectImport.update({ where: { id: input.importId, workspaceId: input.workspaceId }, data: { artifactIds: input.artifactIds ?? [], proposedMap: object(input.proposedMap), status: "analyzed" } })
}

export async function commitProjectImport(input: { workspaceId: string; importId: string; userCorrections?: unknown }) {
  const staged = await prisma.projectImport.findFirstOrThrow({ where: { workspaceId: input.workspaceId, id: input.importId } })
  if (staged.status !== "analyzed") throw new Error("Import must be analyzed and previewed before commit.")
  const proposed = { ...object(staged.proposedMap), ...object(input.userCorrections) }
  return prisma.$transaction(async (tx) => {
    let projectId = staged.projectId
    if (!projectId) {
      const project = await tx.project.create({ data: { workspaceId: input.workspaceId, slug: `${slugify(staged.title)}-${randomUUID().slice(0, 6)}`, title: staged.title, statement: String(proposed.statement ?? `Imported project: ${staged.title}`), status: "active", coordinatorSummary: "Imported baseline is unverified pending a fresh audit." } })
      projectId = project.id
    }
    for (const raw of array(proposed.claims)) {
      const claim = object(raw)
      if (!claim.title || !claim.statementMarkdown) continue
      await tx.claim.create({ data: { workspaceId: input.workspaceId, projectId, title: String(claim.title), statementMarkdown: String(claim.statementMarkdown), kind: (claim.kind ?? "main") as any, status: "unexamined", metadata: { provenance: "imported_author_assertion", original: claim } } })
    }
    await tx.workstream.create({ data: { workspaceId: input.workspaceId, projectId, title: "Audit imported baseline", kind: "hostile_review", coordinatorRole: "GraphAuditor", status: "ready", priority: 100, targetObjectType: "ProjectImport", targetObjectId: staged.id, instructions: "In a fresh context, reconstruct the imported project's mathematical and publication state without inheriting author assertions as approval.", allowedWrites: ["ProjectAudit", "AuditFinding", "RunOutcome"], forbiddenActions: ["Do not edit imported project objects during the audit."], successCriteria: ["Immutable baseline audit completed with an actionable handoff."], reviewPolicy: { review_type: "other", min_approved_rounds: 0 } } })
    await tx.projectImport.update({ where: { id: staged.id }, data: { projectId, userCorrections: object(input.userCorrections), status: "committed", committedAt: new Date() } })
    return { project_id: projectId, import_id: staged.id, status: "imported_unverified", next_action: "Start a fresh chat and audit the imported baseline." }
  })
}

export async function runProjectGraphAudit(input: { workspaceId: string; projectId: string; mode: string; auditorRunId?: string }) {
  const mode = input.mode as ProjectAuditMode
  if (!["invariant_check", "release_audit", "migration_audit", "forensic_audit"].includes(mode)) throw new Error(`Invalid graph audit mode: ${input.mode}`)
  if (mode !== "invariant_check") {
    if (!input.auditorRunId) throw new Error("Full project graph audits require a fresh GraphAuditor AgentRun.")
    const auditor = await prisma.agentRun.findFirstOrThrow({ where: { workspaceId: input.workspaceId, projectId: input.projectId, id: input.auditorRunId } })
    if (auditor.role !== "GraphAuditor" || !["started", "running"].includes(auditor.status)) throw new Error("Full graph audit must run in an active GraphAuditor context.")
    const constructiveWork = await prisma.objectContribution.count({ where: { workspaceId: input.workspaceId, projectId: input.projectId, agentRunId: auditor.id, type: { in: [...constructive] as any } } })
    if (constructiveWork) throw new Error("A GraphAuditor that contributed constructive project work is ineligible; start a fresh chat.")
  }
  const [project, versions, reviews, runs, gaps, artifacts, workstreams, imports, readiness] = await Promise.all([
    prisma.project.findFirstOrThrow({ where: { workspaceId: input.workspaceId, id: input.projectId } }),
    prisma.manuscriptVersion.findMany({ where: { workspaceId: input.workspaceId, projectId: input.projectId }, include: { physicalArtifacts: { include: { artifact: true } }, obligations: true } }),
    prisma.reviewRound.findMany({ where: { workspaceId: input.workspaceId, projectId: input.projectId }, include: { createdByAgentRun: true, reviewAssignment: true, evidenceSections: true } }),
    prisma.agentRun.findMany({ where: { workspaceId: input.workspaceId, projectId: input.projectId } }),
    prisma.gap.findMany({ where: { workspaceId: input.workspaceId, projectId: input.projectId } }),
    prisma.artifact.findMany({ where: { workspaceId: input.workspaceId, projectId: input.projectId } }),
    prisma.workstream.findMany({ where: { workspaceId: input.workspaceId, projectId: input.projectId } }),
    prisma.externalReviewImport.findMany({ where: { workspaceId: input.workspaceId, projectId: input.projectId } }),
    computeSubmissionReadiness(input.workspaceId, input.projectId)
  ])
  const snapshot = { project: { id: project.id, status: project.status, updatedAt: project.updatedAt }, versions: versions.map((v) => [v.id, v.contentHash, v.isCanonical]), reviews: reviews.map((r) => [r.id, r.reviewType, r.verdict, r.evidenceStatus]), gaps: gaps.map((g) => [g.id, g.status, g.severity]), artifacts: artifacts.map((a) => [a.id, a.sha256, a.storageStatus]), workstreams: workstreams.map((w) => [w.id, w.status]), imports: imports.map((r) => [r.id, r.verdict, r.challengedAt]) }
  const findings: Array<Record<string, any>> = []
  const provenanceDefects = reviews.filter((review) => review.reviewType !== "legacy_unspecified" && (!review.createdByAgentRunId || !review.reviewAssignmentId))
  if (provenanceDefects.length) findings.push({
    severity: "critical",
    category: "review_provenance",
    title: "Internal review provenance is structurally incomplete",
    descriptionMarkdown: `${provenanceDefects.length} review records have typed decisions without complete locked-assignment provenance. This is one systemic workflow defect, not ${provenanceDefects.length} independent mathematical repairs.`,
    targetObjectType: "Project",
    targetObjectId: project.id,
    evidence: provenanceDefects.map((review) => review.id),
    proposedRepair: "Bulk-quarantine the defective historical evidence, reconstruct the current release-candidate gate state, and rerun only gates still missing for that exact candidate."
  })
  const executionDefects = reviews.filter((review) => review.createdByAgentRun && !["completed", "submitted"].includes(review.createdByAgentRun.status))
  if (executionDefects.length) findings.push({
    severity: "major",
    category: "review_execution",
    title: "Reviewer-run completion is structurally unreliable",
    descriptionMarkdown: `${executionDefects.length} review records reference reviewer runs that did not complete. Treat these as one infrastructure defect and preserve the individual records only as forensic evidence.`,
    targetObjectType: "Project",
    targetObjectId: project.id,
    evidence: executionDefects.flatMap((review) => [review.id, review.createdByAgentRunId]).filter(Boolean),
    proposedRepair: "Bulk-quarantine the incomplete historical runs and execute only the current release-candidate review delta through fresh locked assignments."
  })
  for (const version of versions.filter((v) => v.isCanonical)) {
    if (!version.obligations.length) findings.push({ severity: "critical", category: "proof_ledger", title: "Canonical manuscript has no proof obligations", descriptionMarkdown: `Canonical version ${version.id} has an empty ledger.`, targetObjectType: "ManuscriptVersion", targetObjectId: version.id, evidence: [], proposedRepair: "Reconstruct an atomic exact-version proof ledger." })
    if (!version.physicalArtifacts.length) findings.push({ severity: "major", category: "artifact_integrity", title: "Canonical manuscript lacks exact physical artifacts", descriptionMarkdown: `Version ${version.id} has no attached immutable source or PDF bytes.`, targetObjectType: "ManuscriptVersion", targetObjectId: version.id, evidence: [], proposedRepair: "Ingest and attach exact source and PDF artifacts." })
  }
  const untriagedExternal = imports.filter((review) => ["needs_revision", "rejected"].includes(review.verdict) && !review.triagedAt)
  if (untriagedExternal.length) findings.push({ severity: "major", category: "external_challenge", title: "External challenges require consolidated triage", descriptionMarkdown: `${untriagedExternal.length} adverse external review records remain untriaged.`, targetObjectType: "Project", targetObjectId: project.id, evidence: untriagedExternal.map((review) => review.id), proposedRepair: "Triage the external findings together, then create only distinct mathematical or manuscript gaps." })
  const empty = await ensureProjectActionable(input.workspaceId, input.projectId, false)
  if (empty.state === "workflow_frontier_empty" && project.status === "active") findings.push({ severity: "major", category: "frontier_continuity", title: "Active project has no actionable frontier", descriptionMarkdown: "No runnable, active, review, waiting, paused, or terminal state exists.", targetObjectType: "Project", targetObjectId: project.id, evidence: [], proposedRepair: "Reconcile the frontier without inventing busywork." })
  const affectedObjects = new Set(findings.flatMap((finding) => finding.evidence ?? [])).size
  const summary = `Graph audit found ${findings.filter((f) => f.severity === "critical").length} critical and ${findings.filter((f) => f.severity === "major").length} major defect classes affecting ${affectedObjects} recorded objects. Repeated instances were grouped so repair remains bounded. No project state was changed.`
  const storedReadiness = {
    project_status: project.status,
    canonical_versions: versions.filter((version) => version.isCanonical).map((version) => ({ id: version.id, verification_state: version.verificationState, freeze_level: version.freezeLevel })),
    recorded_approved_gates: reviews.filter((review) => review.verdict === "approved").map((review) => ({ id: review.id, review_type: review.reviewType, evidence_status: review.evidenceStatus }))
  }
  const audit = await prisma.projectAudit.create({ data: { workspaceId: input.workspaceId, projectId: input.projectId, mode, status: "completed", auditorRunId: input.auditorRunId, graphSnapshotHash: hash(snapshot), policyVersion: READINESS_POLICY_VERSION, storedReadiness: storedReadiness as any, reconstructedReadiness: readiness as any, summaryMarkdown: summary, noProjectMutation: true, completedAt: new Date(), findings: { create: findings.map((finding) => ({ workspaceId: input.workspaceId, projectId: input.projectId, severity: finding.severity, category: finding.category, title: finding.title, descriptionMarkdown: finding.descriptionMarkdown, targetObjectType: finding.targetObjectType, targetObjectId: finding.targetObjectId, evidence: finding.evidence, proposedRepair: finding.proposedRepair })) } }, include: { findings: true } })
  return { audit, project_mutated: false, next_action: findings.length ? { continuation_mode: "fresh_chat_required", prompt: `Start a new chat and say: "Use Maff. Apply the latest full ${project.title} audit, create the repair campaign, and begin the highest-priority repair."` } : { continuation_mode: "fresh_chat_required", prompt: `Start a new chat and say: "Use Maff. Continue the ${project.title} release process."` } }
}

export async function beginRepairFromAudit(input: { workspaceId: string; projectId: string; auditId?: string }) {
  const audit = input.auditId ? await prisma.projectAudit.findFirstOrThrow({ where: { workspaceId: input.workspaceId, projectId: input.projectId, id: input.auditId }, include: { findings: true } }) : await prisma.projectAudit.findFirstOrThrow({ where: { workspaceId: input.workspaceId, projectId: input.projectId, status: "completed" }, orderBy: { createdAt: "desc" }, include: { findings: true } })
  const existing = await prisma.repairCampaign.findFirst({ where: { workspaceId: input.workspaceId, projectId: input.projectId, auditId: audit.id, title: { startsWith: "Bounded audit repair" }, status: { in: ["active", "awaiting_reaudit"] } }, include: { tasks: { orderBy: { priority: "desc" } } } })
  if (existing) {
    const next = existing.tasks.find((task) => ["active", "planned", "blocked"].includes(task.status)) ?? null
    return { campaign: existing, tasks: existing.tasks, next_action: next, idempotent: true, continuation: { mode: "same_chat", prompt: next ? `Type continue to ${next.title.toLowerCase()}.` : "The bounded repair campaign has no remaining task." }, frontier: await ensureProjectActionable(input.workspaceId, input.projectId, true) }
  }
  const accepted = audit.findings.filter((finding) => ["proposed", "accepted"].includes(finding.status) && ["critical", "major"].includes(finding.severity))
  const result = await prisma.$transaction(async (tx) => {
    const legacyCampaigns = await tx.repairCampaign.findMany({ where: { workspaceId: input.workspaceId, projectId: input.projectId, auditId: audit.id, status: { in: ["planned", "active", "awaiting_reaudit"] } }, include: { tasks: true } })
    const legacyTasks = legacyCampaigns.flatMap((candidate) => candidate.tasks)
    const legacyWorkstreamIds = legacyTasks.flatMap((task) => task.workstreamId ? [task.workstreamId] : [])
    const legacyGapIds = legacyTasks.flatMap((task) => task.gapId ? [task.gapId] : [])
    if (legacyWorkstreamIds.length) await tx.workstream.updateMany({ where: { workspaceId: input.workspaceId, id: { in: legacyWorkstreamIds }, status: { notIn: ["completed", "abandoned"] } }, data: { status: "abandoned", escalationMessage: "Superseded by a bounded audit-repair campaign; historical reports remain preserved." } })
    if (legacyGapIds.length) await tx.gap.updateMany({ where: { workspaceId: input.workspaceId, id: { in: legacyGapIds }, status: { not: "resolved" } }, data: { status: "resolved", suggestedResolution: `Workflow-only audit row consolidated into the bounded repair campaign for audit ${audit.id}; this is not a mathematical resolution.` } })
    if (legacyTasks.length) await tx.repairTask.updateMany({ where: { id: { in: legacyTasks.map((task) => task.id) }, status: { not: "completed" } }, data: { status: "cancelled" } })
    if (legacyCampaigns.length) await tx.repairCampaign.updateMany({ where: { id: { in: legacyCampaigns.map((candidate) => candidate.id) } }, data: { status: "cancelled" } })

    const evidenceIds = [...new Set(accepted.filter((finding) => ["review_provenance", "review_execution"].includes(finding.category)).flatMap((finding) => [finding.targetObjectId, ...array(finding.evidence).map(String)]).filter((id): id is string => Boolean(id)))]
    const defectiveReviews = evidenceIds.length ? await tx.reviewRound.findMany({ where: { workspaceId: input.workspaceId, projectId: input.projectId, id: { in: evidenceIds } }, select: { id: true } }) : []
    if (defectiveReviews.length) await tx.reviewRound.updateMany({ where: { id: { in: defectiveReviews.map((review) => review.id) } }, data: { evidenceStatus: "quarantined" } })

    const campaign = await tx.repairCampaign.create({ data: { workspaceId: input.workspaceId, projectId: input.projectId, auditId: audit.id, title: `Bounded audit repair for ${audit.mode} ${audit.id}`, status: "active" } })
    const phases = [
      { title: "Reconstruct the current verification baseline", kind: "project_coordination", role: "ProjectCoordinator", priority: 100, instructions: "Treat defective historical review rows as quarantined forensic evidence. Identify the exact canonical release candidate, reconstruct gate readiness, and record only the current missing gate delta. Do not create one task per historical review.", success: "The exact current release candidate and its genuinely missing release gates are recorded." },
      { title: "Execute the current-candidate release-gate delta", kind: "project_coordination", role: "ProjectCoordinator", priority: 90, instructions: "For the exact canonical release candidate, create fresh locked independent review workstreams only for gates that remain missing. Mark each such workstream review_policy.remediation=true with the exact review_type. Never rerun a historical review merely to repair telemetry. One author-disjoint reviewer chat may drain these distinct gate assignments sequentially; a separate chat per gate is not required.", success: "Every genuinely missing current-candidate gate has fresh valid evidence or one explicit blocker." },
      { title: "Run the fresh immutable release re-audit", kind: "hostile_review", role: "GraphAuditor", priority: 80, instructions: "In a fresh GraphAuditor context, run one immutable release audit over the repaired current state. Do not edit project objects during the audit.", success: "A fresh immutable audit confirms readiness or yields a newly grouped bounded finding set." }
    ] as const
    const tasks = []
    for (const [index, phase] of phases.entries()) {
      const workstream = await tx.workstream.create({ data: { workspaceId: input.workspaceId, projectId: input.projectId, title: phase.title, kind: phase.kind, coordinatorRole: phase.role, status: index === 0 ? "ready" : "blocked", priority: phase.priority, targetObjectType: "ProjectAudit", targetObjectId: audit.id, instructions: phase.instructions, escalationMessage: index === 0 ? null : "Waiting for the prior bounded repair phase.", allowedWrites: ["Workstream", "ReviewAssignment", "ReviewRound", "ProjectAudit", "AuditFinding", "WorkstreamReport", "RunOutcome"], forbiddenActions: ["Do not alter or delete immutable audit or review history.", "Do not create per-row historical rerun tasks.", "Do not edit the manuscript unless a new substantive defect is independently established."], successCriteria: [phase.success], reviewPolicy: { min_approved_rounds: 0, review_type: "other", bounded_audit_repair: true, phase: index + 1 } } })
      tasks.push(await tx.repairTask.create({ data: { workspaceId: input.workspaceId, projectId: input.projectId, campaignId: campaign.id, workstreamId: workstream.id, title: phase.title, instructions: phase.instructions, priority: phase.priority, status: index === 0 ? "active" : "planned", successCondition: phase.success, killCondition: "A fresh substantive finding requires a new grouped audit campaign rather than expanding this campaign." } }))
    }
    if (accepted.length) await tx.auditFinding.updateMany({ where: { id: { in: accepted.map((finding) => finding.id) }, status: "proposed" }, data: { status: "accepted" } })
    return { campaign, tasks, next_action: tasks[0], superseded_campaign_ids: legacyCampaigns.map((candidate) => candidate.id), quarantined_review_count: defectiveReviews.length, phase_count: tasks.length, continuation: { mode: "same_chat", prompt: `Type continue to reconstruct the current verification baseline. This campaign is capped at ${tasks.length} phases.` } }
  })
  const frontier = await ensureProjectActionable(input.workspaceId, input.projectId, true)
  return { ...result, frontier }
}

export async function triageExternalReview(input: { workspaceId: string; projectId: string; externalReviewId: string; agentRunId: string; dispositions: unknown }) {
  const run = await prisma.agentRun.findFirstOrThrow({ where: { workspaceId: input.workspaceId, projectId: input.projectId, id: input.agentRunId } })
  const constructiveWork = await prisma.objectContribution.count({ where: { workspaceId: input.workspaceId, projectId: input.projectId, agentRunId: run.id, type: { in: [...constructive] as any } } })
  if (constructiveWork) throw new Error("External-review triage requires a fresh non-author context.")
  const review = await prisma.externalReviewImport.findFirstOrThrow({ where: { workspaceId: input.workspaceId, projectId: input.projectId, id: input.externalReviewId } })
  if (review.triagedAt) throw new Error("External review has already been triaged.")
  const items = array(input.dispositions).map(object)
  if (!items.length) throw new Error("External-review triage requires explicit issue dispositions.")
  const result = await prisma.$transaction(async (tx) => {
    const gaps = []
    for (const item of items.filter((candidate) => candidate.applicable !== false)) {
      const severity = ["minor", "major", "fatal"].includes(String(item.severity)) ? String(item.severity) : "major"
      gaps.push(await tx.gap.create({ data: { workspaceId: input.workspaceId, projectId: input.projectId, title: String(item.title ?? item.issue ?? "External review finding"), descriptionMarkdown: String(item.description ?? item.issue ?? "External reviewer finding requires resolution."), severity: severity as any, status: "open", suggestedResolution: item.suggested_resolution ? String(item.suggested_resolution) : undefined, targetObjectType: String(item.target_object_type ?? (review.manuscriptVersionId ? "ManuscriptVersion" : "ExternalReviewImport")), targetObjectId: String(item.target_object_id ?? review.manuscriptVersionId ?? review.id), externalReviewId: review.id } }))
    }
    await tx.externalReviewImport.update({ where: { id: review.id }, data: { triagedAt: new Date() } })
    return { external_review_id: review.id, created_gap_ids: gaps.map((gap) => gap.id), disposition_count: items.length }
  })
  const frontier = await ensureProjectActionable(input.workspaceId, input.projectId, true)
  return { ...result, frontier }
}

export async function createPublicationPackage(input: { workspaceId: string; projectId: string; manuscriptVersionId: string; sourceArtifactId: string; pdfArtifactId: string; supplementaryArtifactIds?: string[]; buildManifest: unknown }) {
  const readiness = await computeSubmissionReadiness(input.workspaceId, input.projectId)
  if (!(readiness as any).publication_candidate) throw new Error("Publication package requires reconstructed publication-candidate readiness.")
  const version = await prisma.manuscriptVersion.findFirstOrThrow({ where: { workspaceId: input.workspaceId, projectId: input.projectId, id: input.manuscriptVersionId, isCanonical: true } })
  const physicalLinks = await prisma.artifactManuscriptVersion.findMany({ where: { workspaceId: input.workspaceId, manuscriptVersionId: version.id, artifactId: { in: [input.sourceArtifactId, input.pdfArtifactId] } } })
  if (!physicalLinks.some((link) => link.artifactId === input.sourceArtifactId && ["source_bundle", "manuscript_source"].includes(link.role))) throw new Error("Publication source must be the exact managed source attached to the canonical manuscript.")
  if (!physicalLinks.some((link) => link.artifactId === input.pdfArtifactId && ["compiled_pdf", "final_pdf"].includes(link.role))) throw new Error("Publication PDF must be the exact compiled PDF attached to the canonical manuscript.")
  const artifacts = await prisma.artifact.findMany({ where: { workspaceId: input.workspaceId, projectId: input.projectId, id: { in: [input.sourceArtifactId, input.pdfArtifactId, ...(input.supplementaryArtifactIds ?? [])] } } })
  if (artifacts.length !== 2 + (input.supplementaryArtifactIds ?? []).length) throw new Error("Every publication artifact must be durably registered.")
  for (const artifact of artifacts) {
    if (!artifact.storageKey || !artifact.sha256 || artifact.byteSize === null) throw new Error(`Publication artifact ${artifact.id} has no managed bytes.`)
    const verification = await verifyStoredFile(artifact.storageKey, artifact.sha256, artifact.byteSize)
    if (!verification.ok) throw new Error(`Publication artifact ${artifact.id} failed integrity verification.`)
  }
  const source = artifacts.find((artifact) => artifact.id === input.sourceArtifactId)!, pdf = artifacts.find((artifact) => artifact.id === input.pdfArtifactId)!
  if (pdf.mimeType !== "application/pdf" && !pdf.originalFilename?.toLowerCase().endsWith(".pdf")) throw new Error("Publication PDF artifact is not identified as a PDF.")
  const packageHash = hash({ manuscript: version.contentHash, source: source.sha256, pdf: pdf.sha256, supplement: input.supplementaryArtifactIds ?? [], build: input.buildManifest })
  return prisma.$transaction(async (tx) => {
    await tx.readinessSnapshot.create({ data: { workspaceId: input.workspaceId, projectId: input.projectId, manuscriptVersionId: version.id, policyVersion: READINESS_POLICY_VERSION, assessment: readiness as any, assessmentHash: hash(readiness) } })
    const publication = await tx.publicationPackage.create({ data: { workspaceId: input.workspaceId, projectId: input.projectId, manuscriptVersionId: version.id, sourceArtifactId: source.id, pdfArtifactId: pdf.id, supplementaryArtifactIds: input.supplementaryArtifactIds ?? [], buildManifest: object(input.buildManifest), packageHash, status: "released", releasedAt: new Date() } })
    await tx.artifact.updateMany({ where: { id: { in: artifacts.map((artifact) => artifact.id) } }, data: { visibility: "published" } })
    return publication
  })
}
