import { prisma } from "../db/prisma.js"

export const READINESS_POLICY_VERSION = "1.4.0-paper-builder"
export const REQUIRED_MANUSCRIPT_GATES = ["proof_integration", "end_to_end_mathematical", "novelty", "bibliography", "editorial", "compile"] as const
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
  const version = await prisma.manuscriptVersion.findFirst({ where: { workspaceId, projectId, isCanonical: true }, include: { artifact: true, obligations: true, physicalArtifacts: { include: { artifact: true } }, paperBuilds: { orderBy: { completedAt: "desc" } } } })
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
  for (const gap of gaps) if ((gap.claimId && governingClaimIds.includes(gap.claimId)) || nodeKeys.has(`Gap:${gap.id}`) || (gap.targetObjectType === "ManuscriptVersion" && gap.targetObjectId === version.id) || (gap.targetObjectType === "ResearchArtifact" && gap.targetObjectId === version.artifactId) || (gap.targetObjectType === "ProofObligation" && version.obligations.some((obligation) => obligation.id === gap.targetObjectId))) relevantGapIds.add(gap.id)
  const relevantGaps = gaps.filter((gap) => relevantGapIds.has(gap.id))

  const reviews = await prisma.reviewRound.findMany({ where: { workspaceId, projectId }, include: { workstream: { select: { id: true, title: true, kind: true } }, reviewAssignment: { include: { reviewerRun: true } }, evidenceSections: true } })
  const diagnosticsFor = (type: RequiredGate) => reviews.filter((review) => review.reviewType === type).map((review) => {
    if (review.verdict !== approved) return { review, accepted: false, basis: null, reason: `verdict_${review.verdict}` }
    const match = reviewEvidenceMatch(review, version, versions, type)
    if (!match.accepted) return { review, ...match }
    if (review.evidenceStatus !== "assigned_valid" || !review.reviewAssignment) return { review, accepted: false, basis: match.basis, reason: "assigned_review_evidence_required" }
    if (review.reviewAssignment.status !== "submitted" || review.reviewAssignment.reviewerRun.status !== "completed") return { review, accepted: false, basis: match.basis, reason: "completed_reviewer_run_required" }
    if (!review.evidenceSections.some((section) => section.sectionType === type && section.evidenceMarkdown.trim().length > 0 && section.conclusion.trim().length > 0)) return { review, accepted: false, basis: match.basis, reason: "structured_evidence_section_required" }
    if (["proof_integration", "end_to_end_mathematical", "novelty", "bibliography", "editorial"].includes(type) && !["author_disjoint", "fully_disjoint_internal_referee"].includes(review.reviewAssignment.independence)) return { review, accepted: false, basis: match.basis, reason: "computed_author_disjoint_reviewer_required" }
    return { review, ...match }
  })
  const diagnostics = Object.fromEntries(REQUIRED_MANUSCRIPT_GATES.map((type) => [type, diagnosticsFor(type)])) as Record<RequiredGate, Array<{ review: any; accepted: boolean; basis: string | null; reason: string | null }>>
  const adverseExactReviews = reviews.filter((review) => ["needs_revision", "rejected"].includes(review.verdict) && review.reviewType !== "compile" && REQUIRED_MANUSCRIPT_GATES.includes(review.reviewType as RequiredGate)).filter((review) => {
    const match = reviewEvidenceMatch(review, version, versions, review.reviewType as RequiredGate)
    return match.accepted && review.evidenceStatus === "assigned_valid" && review.reviewAssignment?.status === "submitted" && ["submitted", "completed"].includes(review.reviewAssignment.reviewerRun.status)
  })
  const gateReviews = (type: RequiredGate) => diagnostics[type].filter((item) => item.accepted).map((item) => item.review)
  const obligationChecks = await prisma.reviewObligationCheck.findMany({ where: { workspaceId, proofObligationId: { in: version.obligations.map((o) => o.id) } }, include: { reviewRound: true } })
  const integrationReviews = gateReviews("proof_integration")
  const integrationReviewIds = new Set(integrationReviews.map((review) => review.id))
  const coveredObligations = new Set(obligationChecks.filter((check) => integrationReviewIds.has(check.reviewRoundId) && normalizedObligationCheckStatus(check.status) === "preserved").map((check) => check.proofObligationId))
  const compatibilityReviewIds: string[] = []
  for (const review of integrationReviews) {
    const checkedIds = strings(review.checkedObligationIds)
    if (checkedIds.length && checkedIds.some((id) => !coveredObligations.has(id))) compatibilityReviewIds.push(review.id)
  }
  const missingObligations = version.obligations.filter((o) => o.required && !coveredObligations.has(o.id))
  const requiredObligations = version.obligations.filter((o) => o.required)
  const zeroObligationLedger = requiredObligations.length === 0
  const weakObligations = requiredObligations.filter((obligation) => !obligation.statementMarkdown.trim() || (!strings(obligation.assumptions).length && !strings(obligation.boundaryCases).length && !strings(obligation.excludedRegimes).length))
  const noveltyCoveredClaims = new Set(gateReviews("novelty").flatMap((r) => strings((r.scope as any)?.claim_ids)))
  const noveltyMissing = claims.filter((c) => !noveltyCoveredClaims.has(c.id))
  const unclassifiedLiteratureEvidence = reviews.filter((review) => review.reviewType === "legacy_unspecified" && review.verdict === approved && review.workstream.kind === "literature_review").map((review) => ({ review_id: review.id, workstream_id: review.workstream.id, workstream_title: review.workstream.title, target_version: review.targetVersion }))
  const evidence = (type: RequiredGate) => diagnostics[type].map((item) => ({ review_id: item.review.id, verdict: item.review.verdict, target_version: item.review.targetVersion, independence: item.review.independence, accepted: item.accepted, match_basis: item.basis, rejection_reason: item.reason }))
  const endToEnd = gateReviews("end_to_end_mathematical")
  const attached = version.physicalArtifacts.map((link) => ({ role: link.role, artifact: link.artifact }))
  const sourceArtifacts = attached.filter((item) => ["source_bundle", "manuscript_source"].includes(item.role))
  const pdfArtifacts = attached.filter((item) => ["compiled_pdf", "final_pdf"].includes(item.role))
  const physicalHealthy = (items: typeof attached) => items.some(({ artifact }) => artifact.storageStatus === "available" && Boolean(artifact.storageKey && artifact.sha256 && artifact.byteSize !== null))
  const successfulBuild = version.paperBuilds.find((build) => build.status === "succeeded" && build.sourceArtifactId && build.pdfArtifactId && (build.buildManifest as any)?.manuscript_content_hash === version.contentHash)
  const externalChallenges = await prisma.externalReviewImport.findMany({ where: { workspaceId, projectId, manuscriptVersionId: version.id, verdict: { in: ["needs_revision", "rejected"] }, triagedAt: null } })
  const numericalRequired = claims.some((claim) => (claim.metadata as any)?.requires_numerical_validation === true)
  const numericalDiagnostics = reviews.filter((review) => review.reviewType === "numerical_verification" && review.verdict === approved && review.evidenceStatus === "assigned_valid" && review.reviewAssignment?.status === "submitted" && review.reviewAssignment.reviewerRun.status === "completed")
  const gates: Record<string, any> = {
    adverse_review_resolution: { satisfied: adverseExactReviews.length === 0, review_ids: adverseExactReviews.map((review) => review.id), reason: "Accepted adverse exact-candidate reviews must be repaired in a new manuscript version before remaining release gates continue." },
    artifact_integrity: { satisfied: physicalHealthy(sourceArtifacts) && physicalHealthy(pdfArtifacts), source_artifact_ids: sourceArtifacts.map((item) => item.artifact.id), pdf_artifact_ids: pdfArtifacts.map((item) => item.artifact.id), reason: "Exact managed source and compiled PDF bytes must both be attached and healthy." },
    proof_obligation_ledger: { satisfied: !zeroObligationLedger && weakObligations.length === 0, weak_obligation_ids: weakObligations.map((o) => o.id), reason: "A nontrivial canonical manuscript needs atomic obligations covering assumptions, excluded regimes, or boundary cases." },
    proof_integration: { satisfied: !zeroObligationLedger && integrationReviews.length > 0 && missingObligations.length === 0, review_ids: integrationReviews.map((r) => r.id), missing_obligation_ids: missingObligations.map((o) => o.id), invalid_zero_obligation_ledger: zeroObligationLedger, compatibility_checked_id_review_ids: compatibilityReviewIds, evidence: evidence("proof_integration") },
    end_to_end_mathematical: { satisfied: endToEnd.length > 0, review_ids: endToEnd.map((r) => r.id), reason: "Requires an independent reviewer of this exact manuscript version.", evidence: evidence("end_to_end_mathematical") },
    novelty: { satisfied: noveltyMissing.length === 0 && gateReviews("novelty").length > 0, review_ids: gateReviews("novelty").map((r) => r.id), missing_claim_ids: noveltyMissing.map((c) => c.id), evidence: evidence("novelty"), unclassified_literature_evidence_candidates: unclassifiedLiteratureEvidence },
    bibliography: { satisfied: gateReviews("bibliography").length > 0, review_ids: gateReviews("bibliography").map((r) => r.id), evidence: evidence("bibliography"), unclassified_literature_evidence_candidates: unclassifiedLiteratureEvidence },
    editorial: { satisfied: gateReviews("editorial").length > 0, review_ids: gateReviews("editorial").map((r) => r.id), evidence: evidence("editorial") },
    compile: { satisfied: Boolean(successfulBuild) && physicalHealthy(sourceArtifacts) && physicalHealthy(pdfArtifacts), paper_build_id: successfulBuild?.id ?? null, builder_version: successfulBuild?.builderVersion ?? null, source_hash: successfulBuild?.sourceHash ?? null, review_ids: [], evidence: [] },
    numerical_verification: { required: numericalRequired, satisfied: !numericalRequired || numericalDiagnostics.length > 0, review_ids: numericalDiagnostics.map((review) => review.id) },
    external_challenge_resolution: { satisfied: externalChallenges.length === 0, unresolved_external_review_ids: externalChallenges.map((review) => review.id) }
  }
  const blockingGaps = relevantGaps.filter((g) => ["fatal", "critical", "major"].includes(g.severity))
  const gateReason = (type: RequiredGate) => {
    if (type === "compile") return `No successful internal PaperBuild matches exact release candidate ${version.id}.`
    if (type === "proof_integration" && integrationReviews.length && missingObligations.length) return `Approved exact-version proof-integration evidence is missing preserved checks for obligations: ${missingObligations.map((obligation) => obligation.id).join(", ")}.`
    if (type === "novelty" && gateReviews(type).length && noveltyMissing.length) return `Accepted theorem-fingerprint novelty evidence does not cover claims: ${noveltyMissing.map((claim) => claim.id).join(", ")}.`
    const rejected = diagnostics[type].filter((item) => !item.accepted && item.review.verdict === approved)
    if (rejected.length) return `No accepted ${type} evidence. Rejected approved reviews: ${rejected.map((item) => `${item.review.id} (${item.reason})`).join(", ")}.`
    return `No approved ${type} evidence is registered for release candidate ${version.id}.`
  }
  const reasons = [
    ...adverseExactReviews.map((review) => `Accepted ${review.verdict} ${review.reviewType} review ${review.id} requires a revised exact manuscript version.`),
    ...REQUIRED_MANUSCRIPT_GATES.filter((type) => !gates[type].satisfied).map(gateReason),
    ...(!gates.artifact_integrity.satisfied ? [gates.artifact_integrity.reason] : []),
    ...(!gates.proof_obligation_ledger.satisfied ? [gates.proof_obligation_ledger.reason] : []),
    ...(!gates.numerical_verification.satisfied ? ["Applicable computational or numerical claims lack assigned independent validation."] : []),
    ...externalChallenges.map((review) => `External ${review.verdict} review ${review.id} remains untriaged for the exact release candidate.`),
    ...blockingGaps.map((g) => `Open ${g.severity} gap ${g.id}: ${g.title}.`)
  ]
  const releaseOrder: RequiredGate[] = ["compile", "proof_integration", "novelty", "bibliography", "end_to_end_mathematical", "editorial"]
  const nextGate = adverseExactReviews.length ? null : releaseOrder.find((type) => !gates[type].satisfied) ?? null
  const nextAction: Record<RequiredGate, string> = {
    compile: `Build exact release candidate ${version.id} with PaperBuilder. This is an automated build, not a reviewer assignment.`,
    proof_integration: `Review every required obligation against exact release candidate ${version.id}; record one preserved/passed obligation check per required obligation.`,
    novelty: unclassifiedLiteratureEvidence.length ? `Classify eligible existing literature review evidence (${unclassifiedLiteratureEvidence.map((candidate) => candidate.review_id).join(", ")}) against theorem fingerprint ${version.theoremFingerprint}, or run only the uncovered novelty delta.` : `Register approved novelty evidence for theorem fingerprint ${version.theoremFingerprint}; matching evidence from an earlier version is reusable.`,
    bibliography: unclassifiedLiteratureEvidence.length ? `Classify eligible existing literature review evidence (${unclassifiedLiteratureEvidence.map((candidate) => candidate.review_id).join(", ")}) against citation fingerprint ${version.citationFingerprint}, or run only the uncovered bibliography delta.` : `Register approved bibliography evidence for citation fingerprint ${version.citationFingerprint}; matching evidence from an earlier version is reusable.`,
    end_to_end_mathematical: `Run one assigned, author-disjoint end-to-end mathematical review of exact release candidate ${version.id}.`,
    editorial: `Run an assigned author-disjoint significance, exposition, and venue-suitability review of exact release candidate ${version.id}.`
  }
  const repeatedWithoutNewIssues = releaseOrder.filter((type) => {
    if (type === "compile") return false
    if (gates[type].satisfied) return false
    const exactAttempts = diagnostics[type]
      .filter((item) => item.basis === "exact_version" && item.review.evidenceStatus === "assigned_valid" && item.review.reviewAssignment?.status === "submitted" && item.review.reviewAssignment?.reviewerRun?.status === "completed")
      .map((item) => item.review)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    return exactAttempts.length >= 2 && exactAttempts.slice(-2).every((review) => strings(review.issues).length === 0)
  })
  const acceptedButIncomplete = releaseOrder.filter((type) => type !== "compile" && !gates[type].satisfied && diagnostics[type].some((item) => item.accepted))
  const circuitBreakerGates = [...new Set([...repeatedWithoutNewIssues, ...acceptedButIncomplete])]
  const stale = REQUIRED_MANUSCRIPT_GATES.flatMap((type) => diagnostics[type].filter((item) => !item.accepted && item.review.verdict === approved).map((item) => ({ id: item.review.id, review_type: type, target_version: item.review.targetVersion, reason: item.reason })))
  return {
    submission_ready: reasons.length === 0,
    publication_candidate: reasons.length === 0,
    policy_version: READINESS_POLICY_VERSION,
    status: reasons.length ? externalChallenges.length ? "externally_challenged" : adverseExactReviews.length ? "revision_required" : circuitBreakerGates.length ? "workflow_infrastructure_blocked" : "release_gates_pending" : "publication_candidate",
    lifecycle_stage: reasons.length === 0 ? "publication_candidate" : gates.end_to_end_mathematical.satisfied ? "internally_refereed" : gates.proof_integration.satisfied ? "proof_integration_checked" : gates.compile.satisfied ? "build_reproducible" : "draft",
    canonical_manuscript: { id: version.id, artifact_id: version.artifactId, version: version.version, content_hash: version.contentHash, theorem_fingerprint: version.theoremFingerprint, citation_fingerprint: version.citationFingerprint },
    release_candidate: { id: version.id, label: `RC-${version.version}`, exact_content_hash: version.contentHash, theorem_fingerprint: version.theoremFingerprint, citation_fingerprint: version.citationFingerprint, immutable_review_target: true },
    gates,
    gate_plan: [...(adverseExactReviews.length ? [{ gate: "revision", status: "next", accepted_review_ids: adverseExactReviews.map((review) => review.id), next_action: `Apply the bounded required changes from accepted adverse review${adverseExactReviews.length === 1 ? "" : "s"} ${adverseExactReviews.map((review) => review.id).join(", ")} and register a new exact manuscript version.` }] : []), ...releaseOrder.map((type) => ({ gate: type, status: gates[type].satisfied ? "complete" : type === nextGate ? "next" : "pending", accepted_review_ids: gates[type].review_ids, next_action: gates[type].satisfied ? null : nextAction[type] }))],
    next_required_action: adverseExactReviews.length ? { gate: "revision", review_round_ids: adverseExactReviews.map((review) => review.id), instruction: `Apply the bounded required changes from accepted adverse review${adverseExactReviews.length === 1 ? "" : "s"} and register a new exact manuscript version before any further release review.` } : nextGate ? { gate: nextGate, instruction: nextAction[nextGate] } : null,
    workflow_circuit_breaker: { active: circuitBreakerGates.length > 0, pause_duplicate_final_reviews: circuitBreakerGates.length > 0, affected_gates: circuitBreakerGates, instruction: circuitBreakerGates.length ? "Do not create another identical review. Repair or classify the rejected/incomplete gate evidence shown in gates.<type>.evidence." : null },
    reasons,
    blocking_object_references: blockingGaps.map((g) => ({ type: "Gap", id: g.id, path: paths.get(`Gap:${g.id}`) ?? [`Claim:${g.claimId ?? "unlinked"}`, `Gap:${g.id}`] })),
    stale_review_references: stale,
    missing_gate_references: ["adverse_review_resolution", "artifact_integrity", "proof_obligation_ledger", ...REQUIRED_MANUSCRIPT_GATES, ...(numericalRequired ? ["numerical_verification"] : []), "external_challenge_resolution"].filter((type) => !gates[type].satisfied),
    open_relevant_gaps: relevantGaps,
    governing_claim_ids: governingClaimIds,
    proof_obligations: { total: version.obligations.length, uncovered_required_ids: missingObligations.map((o) => o.id) }
  }
}

export async function workstreamDependenciesSatisfied(workspaceId: string, workstreamId: string) {
  const dependencies = await prisma.workstreamDependency.findMany({ where: { workspaceId, dependentWorkstreamId: workstreamId }, include: { prerequisite: { include: { reviews: true } } } })
  return { satisfied: dependencies.every((dependency) => {
    const policy = dependency.prerequisite.reviewPolicy as Record<string, unknown>
    const requiredApprovals = typeof policy.min_approved_rounds === "number" ? policy.min_approved_rounds : 1
    const approvals = dependency.prerequisite.reviews.filter((review) => review.verdict === approved).length
    return dependency.prerequisite.status === "completed" && approvals >= requiredApprovals
  }), dependencies }
}
