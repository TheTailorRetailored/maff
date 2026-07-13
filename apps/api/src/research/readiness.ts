import { prisma } from "../db/prisma.js"

export const REQUIRED_MANUSCRIPT_GATES = ["proof_integration", "end_to_end_mathematical", "novelty", "bibliography", "compile"] as const
export type RequiredGate = typeof REQUIRED_MANUSCRIPT_GATES[number]
type VersionIdentity = { id: string; version: number; contentHash: string; theoremFingerprint: string; citationFingerprint: string }

const approved = "approved"
const contributionRelations = new Set(["governs_claim", "contribution_claim", "manuscript_claim"])
const relevanceRelations = new Set(["derived_from", "uses_source", "governs_claim", "contribution_claim", "manuscript_claim", "has_proof_obligation", "blocks", "depends_on"])

function strings(value: unknown): string[] { return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [] }

export function normalizedObligationCheckStatus(status: unknown) {
  const normalized = typeof status === "string" ? status.trim().toLowerCase() : ""
  return normalized === "preserved" || normalized === "passed" ? "preserved" : normalized
}

function resolveReviewVersion(review: any, versions: VersionIdentity[]) {
  if (!review.targetVersion) return null
  return versions.find((version) => review.targetVersion === version.id || review.targetVersion === version.contentHash || review.targetVersion === String(version.version)) ?? null
}

export function reviewEvidenceMatch(review: any, candidate: VersionIdentity, versions: VersionIdentity[], gate: RequiredGate) {
  const target = resolveReviewVersion(review, versions)
  if (!target) return { accepted: false, basis: null, reason: "target_version_not_recognized" }
  if (target.id === candidate.id) return { accepted: true, basis: "exact_version", reason: null }
  if (gate === "novelty" && target.theoremFingerprint && target.theoremFingerprint === candidate.theoremFingerprint) return { accepted: true, basis: "theorem_fingerprint", reason: null }
  if (gate === "bibliography" && target.citationFingerprint && target.citationFingerprint === candidate.citationFingerprint) return { accepted: true, basis: "citation_fingerprint", reason: null }
  return { accepted: false, basis: null, reason: gate === "novelty" ? "theorem_fingerprint_changed" : gate === "bibliography" ? "citation_fingerprint_changed" : "exact_version_required" }
}

/** Central gate policy. Reviews only count when type, target version, and scope match. */
export async function computeSubmissionReadiness(workspaceId: string, projectId: string) {
  await prisma.project.findFirstOrThrow({ where: { workspaceId, id: projectId } })
  const version = await prisma.manuscriptVersion.findFirst({ where: { workspaceId, projectId, isCanonical: true }, include: { artifact: true, obligations: true } })
  if (!version) return { submission_ready: false, status: "no_canonical_manuscript", reasons: ["No canonical working-paper version exists."], blocking_object_references: [], stale_review_references: [], missing_gate_references: REQUIRED_MANUSCRIPT_GATES, gates: {} }

  const versions = await prisma.manuscriptVersion.findMany({ where: { workspaceId, projectId }, select: { id: true, version: true, contentHash: true, theoremFingerprint: true, citationFingerprint: true } })

  const allLinks = await prisma.researchLink.findMany({ where: { workspaceId, projectId } })
  const governingClaimIds = [...new Set([
    ...allLinks.filter((l) => l.sourceType === "ManuscriptVersion" && l.sourceId === version.id && contributionRelations.has(l.relationType) && l.targetType === "Claim").map((l) => l.targetId),
    ...version.obligations.flatMap((obligation) => obligation.claimId ? [obligation.claimId] : [])
  ])]
  const sourceArtifactIds = allLinks.filter((l) => l.sourceType === "ManuscriptVersion" && l.sourceId === version.id && ["derived_from", "uses_source"].includes(l.relationType) && l.targetType === "ResearchArtifact").map((l) => l.targetId)
  const nodeKeys = new Set([`ManuscriptVersion:${version.id}`, `ResearchArtifact:${version.artifactId}`, ...governingClaimIds.map((id) => `Claim:${id}`), ...sourceArtifactIds.map((id) => `ResearchArtifact:${id}`)])
  const paths = new Map<string, string[]>([...nodeKeys].map((key) => [key, [key]]))
  for (let depth = 0; depth < 8; depth++) {
    let added = 0
    for (const link of allLinks) {
      if (!relevanceRelations.has(link.relationType)) continue
      const source = `${link.sourceType}:${link.sourceId}`, target = `${link.targetType}:${link.targetId}`
      if (nodeKeys.has(source) && !nodeKeys.has(target)) { nodeKeys.add(target); paths.set(target, [...(paths.get(source) ?? [source]), target]); added++ }
      if (nodeKeys.has(target) && !nodeKeys.has(source)) { nodeKeys.add(source); paths.set(source, [...(paths.get(target) ?? [target]), source]); added++ }
    }
    if (!added) break
  }
  const claims = await prisma.claim.findMany({ where: { workspaceId, projectId, id: { in: governingClaimIds } } })
  const relevantGapIds = new Set<string>()
  const gaps = await prisma.gap.findMany({ where: { workspaceId, projectId, status: { in: ["open", "assigned"] } } })
  for (const gap of gaps) if ((gap.claimId && governingClaimIds.includes(gap.claimId)) || nodeKeys.has(`Gap:${gap.id}`)) relevantGapIds.add(gap.id)
  const relevantGaps = gaps.filter((gap) => relevantGapIds.has(gap.id))

  const reviews = await prisma.reviewRound.findMany({ where: { workspaceId, projectId }, include: { workstream: { select: { id: true, title: true, kind: true } } } })
  const diagnosticsFor = (type: RequiredGate) => reviews.filter((review) => review.reviewType === type).map((review) => {
    if (review.verdict !== approved) return { review, accepted: false, basis: null, reason: `verdict_${review.verdict}` }
    const match = reviewEvidenceMatch(review, version, versions, type)
    if (type === "end_to_end_mathematical" && match.accepted && review.independence !== "independent_reviewer" && review.independence !== "external_referee_style") return { review, accepted: false, basis: match.basis, reason: "independent_reviewer_required" }
    return { review, ...match }
  })
  const diagnostics = Object.fromEntries(REQUIRED_MANUSCRIPT_GATES.map((type) => [type, diagnosticsFor(type)])) as Record<RequiredGate, Array<{ review: any; accepted: boolean; basis: string | null; reason: string | null }>>
  const gateReviews = (type: RequiredGate) => diagnostics[type].filter((item) => item.accepted).map((item) => item.review)
  const obligationChecks = await prisma.reviewObligationCheck.findMany({ where: { workspaceId, proofObligationId: { in: version.obligations.map((o) => o.id) } }, include: { reviewRound: true } })
  const integrationReviews = gateReviews("proof_integration")
  const integrationReviewIds = new Set(integrationReviews.map((review) => review.id))
  const coveredObligations = new Set(obligationChecks.filter((check) => integrationReviewIds.has(check.reviewRoundId) && normalizedObligationCheckStatus(check.status) === "preserved").map((check) => check.proofObligationId))
  const compatibilityReviewIds: string[] = []
  for (const review of integrationReviews) {
    const checkedIds = strings(review.checkedObligationIds)
    if (checkedIds.length && checkedIds.some((id) => !coveredObligations.has(id))) compatibilityReviewIds.push(review.id)
    for (const id of checkedIds) if (version.obligations.some((obligation) => obligation.id === id)) coveredObligations.add(id)
  }
  const missingObligations = version.obligations.filter((o) => o.required && !coveredObligations.has(o.id))
  const zeroObligationLedger = version.obligations.filter((o) => o.required).length === 0
  const noveltyCoveredClaims = new Set(gateReviews("novelty").flatMap((r) => strings((r.scope as any)?.claim_ids)))
  const noveltyMissing = claims.filter((c) => !noveltyCoveredClaims.has(c.id))
  const unclassifiedLiteratureEvidence = reviews.filter((review) => review.reviewType === "legacy_unspecified" && review.verdict === approved && review.workstream.kind === "literature_review").map((review) => ({ review_id: review.id, workstream_id: review.workstream.id, workstream_title: review.workstream.title, target_version: review.targetVersion }))
  const evidence = (type: RequiredGate) => diagnostics[type].map((item) => ({ review_id: item.review.id, verdict: item.review.verdict, target_version: item.review.targetVersion, independence: item.review.independence, accepted: item.accepted, match_basis: item.basis, rejection_reason: item.reason }))
  const endToEnd = gateReviews("end_to_end_mathematical")
  const gates: Record<string, any> = {
    proof_obligation_ledger: { satisfied: !zeroObligationLedger, reason: "A nontrivial canonical manuscript must have a non-empty exact-version proof-obligation ledger." },
    proof_integration: { satisfied: !zeroObligationLedger && integrationReviews.length > 0 && missingObligations.length === 0, review_ids: integrationReviews.map((r) => r.id), missing_obligation_ids: missingObligations.map((o) => o.id), invalid_zero_obligation_ledger: zeroObligationLedger, compatibility_checked_id_review_ids: compatibilityReviewIds, evidence: evidence("proof_integration") },
    end_to_end_mathematical: { satisfied: endToEnd.length > 0, review_ids: endToEnd.map((r) => r.id), reason: "Requires an independent reviewer of this exact manuscript version.", evidence: evidence("end_to_end_mathematical") },
    novelty: { satisfied: noveltyMissing.length === 0 && gateReviews("novelty").length > 0, review_ids: gateReviews("novelty").map((r) => r.id), missing_claim_ids: noveltyMissing.map((c) => c.id), evidence: evidence("novelty"), unclassified_literature_evidence_candidates: unclassifiedLiteratureEvidence },
    bibliography: { satisfied: gateReviews("bibliography").length > 0, review_ids: gateReviews("bibliography").map((r) => r.id), evidence: evidence("bibliography"), unclassified_literature_evidence_candidates: unclassifiedLiteratureEvidence },
    compile: { satisfied: gateReviews("compile").length > 0, review_ids: gateReviews("compile").map((r) => r.id), evidence: evidence("compile") }
  }
  const blockingGaps = relevantGaps.filter((g) => ["fatal", "critical", "major"].includes(g.severity))
  const gateReason = (type: RequiredGate) => {
    if (type === "proof_integration" && integrationReviews.length && missingObligations.length) return `Approved exact-version proof-integration evidence is missing preserved checks for obligations: ${missingObligations.map((obligation) => obligation.id).join(", ")}.`
    if (type === "novelty" && gateReviews(type).length && noveltyMissing.length) return `Accepted theorem-fingerprint novelty evidence does not cover claims: ${noveltyMissing.map((claim) => claim.id).join(", ")}.`
    const rejected = diagnostics[type].filter((item) => !item.accepted && item.review.verdict === approved)
    if (rejected.length) return `No accepted ${type} evidence. Rejected approved reviews: ${rejected.map((item) => `${item.review.id} (${item.reason})`).join(", ")}.`
    return `No approved ${type} evidence is registered for release candidate ${version.id}.`
  }
  const reasons = [
    ...REQUIRED_MANUSCRIPT_GATES.filter((type) => !gates[type].satisfied).map(gateReason),
    ...(!gates.proof_obligation_ledger.satisfied ? [gates.proof_obligation_ledger.reason] : []),
    ...blockingGaps.map((g) => `Open ${g.severity} gap ${g.id}: ${g.title}.`)
  ]
  const releaseOrder: RequiredGate[] = ["compile", "proof_integration", "novelty", "bibliography", "end_to_end_mathematical"]
  const nextGate = releaseOrder.find((type) => !gates[type].satisfied) ?? null
  const nextAction: Record<RequiredGate, string> = {
    compile: `Run mechanical validation against exact release candidate ${version.id}.`,
    proof_integration: `Review every required obligation against exact release candidate ${version.id}; record one preserved/passed obligation check per required obligation.`,
    novelty: unclassifiedLiteratureEvidence.length ? `Classify eligible existing literature review evidence (${unclassifiedLiteratureEvidence.map((candidate) => candidate.review_id).join(", ")}) against theorem fingerprint ${version.theoremFingerprint}, or run only the uncovered novelty delta.` : `Register approved novelty evidence for theorem fingerprint ${version.theoremFingerprint}; matching evidence from an earlier version is reusable.`,
    bibliography: unclassifiedLiteratureEvidence.length ? `Classify eligible existing literature review evidence (${unclassifiedLiteratureEvidence.map((candidate) => candidate.review_id).join(", ")}) against citation fingerprint ${version.citationFingerprint}, or run only the uncovered bibliography delta.` : `Register approved bibliography evidence for citation fingerprint ${version.citationFingerprint}; matching evidence from an earlier version is reusable.`,
    end_to_end_mathematical: `Run one independent end-to-end mathematical review of exact release candidate ${version.id}.`
  }
  const repeatedWithoutNewIssues = releaseOrder.filter((type) => {
    if (gates[type].satisfied) return false
    const exactAttempts = diagnostics[type].filter((item) => item.basis === "exact_version").map((item) => item.review).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    return exactAttempts.length >= 2 && exactAttempts.slice(-2).every((review) => strings(review.issues).length === 0)
  })
  const acceptedButIncomplete = releaseOrder.filter((type) => !gates[type].satisfied && diagnostics[type].some((item) => item.accepted))
  const circuitBreakerGates = [...new Set([...repeatedWithoutNewIssues, ...acceptedButIncomplete])]
  const stale = REQUIRED_MANUSCRIPT_GATES.flatMap((type) => diagnostics[type].filter((item) => !item.accepted && item.review.verdict === approved).map((item) => ({ id: item.review.id, review_type: type, target_version: item.review.targetVersion, reason: item.reason })))
  return {
    submission_ready: reasons.length === 0,
    status: reasons.length ? circuitBreakerGates.length ? "workflow_infrastructure_blocked" : "release_gates_pending" : "submission_ready",
    canonical_manuscript: { id: version.id, artifact_id: version.artifactId, version: version.version, content_hash: version.contentHash, theorem_fingerprint: version.theoremFingerprint, citation_fingerprint: version.citationFingerprint },
    release_candidate: { id: version.id, label: `RC-${version.version}`, exact_content_hash: version.contentHash, theorem_fingerprint: version.theoremFingerprint, citation_fingerprint: version.citationFingerprint, immutable_review_target: true },
    gates,
    gate_plan: releaseOrder.map((type) => ({ gate: type, status: gates[type].satisfied ? "complete" : type === nextGate ? "next" : "pending", accepted_review_ids: gates[type].review_ids, next_action: gates[type].satisfied ? null : nextAction[type] })),
    next_required_action: nextGate ? { gate: nextGate, instruction: nextAction[nextGate] } : null,
    workflow_circuit_breaker: { active: circuitBreakerGates.length > 0, pause_duplicate_final_reviews: circuitBreakerGates.length > 0, affected_gates: circuitBreakerGates, instruction: circuitBreakerGates.length ? "Do not create another identical review. Repair or classify the rejected/incomplete gate evidence shown in gates.<type>.evidence." : null },
    reasons,
    blocking_object_references: blockingGaps.map((g) => ({ type: "Gap", id: g.id, path: paths.get(`Gap:${g.id}`) ?? [`Claim:${g.claimId ?? "unlinked"}`, `Gap:${g.id}`] })),
    stale_review_references: stale,
    missing_gate_references: ["proof_obligation_ledger", ...REQUIRED_MANUSCRIPT_GATES].filter((type) => !gates[type].satisfied),
    open_relevant_gaps: relevantGaps,
    governing_claim_ids: governingClaimIds,
    proof_obligations: { total: version.obligations.length, uncovered_required_ids: missingObligations.map((o) => o.id) }
  }
}

export async function workstreamDependenciesSatisfied(workspaceId: string, workstreamId: string) {
  const dependencies = await prisma.workstreamDependency.findMany({ where: { workspaceId, dependentWorkstreamId: workstreamId }, include: { prerequisite: { include: { reviews: true } } } })
  return { satisfied: dependencies.every((d) => d.prerequisite.status === "completed" && d.prerequisite.reviews.some((r) => r.verdict === approved)), dependencies }
}
