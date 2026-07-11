import { prisma } from "../db/prisma.js"

export const REQUIRED_MANUSCRIPT_GATES = ["proof_integration", "end_to_end_mathematical", "novelty", "bibliography", "compile"] as const
export type RequiredGate = typeof REQUIRED_MANUSCRIPT_GATES[number]

const approved = "approved"
const contributionRelations = new Set(["governs_claim", "contribution_claim", "manuscript_claim"])
const relevanceRelations = new Set(["derived_from", "uses_source", "governs_claim", "contribution_claim", "manuscript_claim", "has_proof_obligation", "blocks", "depends_on"])

function strings(value: unknown): string[] { return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [] }
function reviewMatchesVersion(review: any, version: any) { return review.targetVersion === version.id || review.targetVersion === version.contentHash }

/** Central gate policy. Reviews only count when type, target version, and scope match. */
export async function computeSubmissionReadiness(workspaceId: string, projectId: string) {
  const project = await prisma.project.findFirstOrThrow({ where: { workspaceId, id: projectId } })
  const version = await prisma.manuscriptVersion.findFirst({ where: { workspaceId, projectId, isCanonical: true }, include: { artifact: true, obligations: true } })
  if (!version) return { submission_ready: false, status: "no_canonical_manuscript", reasons: ["No canonical working-paper version exists."], blocking_object_references: [], stale_review_references: [], missing_gate_references: REQUIRED_MANUSCRIPT_GATES, gates: {} }

  const allLinks = await prisma.researchLink.findMany({ where: { workspaceId, projectId } })
  const governingClaimIds = allLinks.filter((l) => l.sourceType === "ManuscriptVersion" && l.sourceId === version.id && contributionRelations.has(l.relationType) && l.targetType === "Claim").map((l) => l.targetId)
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

  const reviews = await prisma.reviewRound.findMany({ where: { workspaceId, projectId, verdict: approved } })
  const current = reviews.filter((r) => reviewMatchesVersion(r, version))
  const gate = (type: RequiredGate) => current.filter((r) => r.reviewType === type)
  const obligationChecks = await prisma.reviewObligationCheck.findMany({ where: { workspaceId, proofObligationId: { in: version.obligations.map((o) => o.id) }, status: "preserved" }, include: { reviewRound: true } })
  const integrationReviews = gate("proof_integration")
  const coveredObligations = new Set(obligationChecks.filter((c) => integrationReviews.some((r) => r.id === c.reviewRoundId)).map((c) => c.proofObligationId))
  const missingObligations = version.obligations.filter((o) => o.required && !coveredObligations.has(o.id))
  const noveltyCoveredClaims = new Set(gate("novelty").flatMap((r) => strings((r.scope as any)?.claim_ids)))
  const noveltyMissing = claims.filter((c) => !noveltyCoveredClaims.has(c.id))
  const endToEnd = gate("end_to_end_mathematical").filter((r) => r.independence === "independent_reviewer" || r.independence === "external_referee_style")
  const gates: Record<string, any> = {
    proof_integration: { satisfied: integrationReviews.length > 0 && missingObligations.length === 0, review_ids: integrationReviews.map((r) => r.id), missing_obligation_ids: missingObligations.map((o) => o.id) },
    end_to_end_mathematical: { satisfied: endToEnd.length > 0, review_ids: endToEnd.map((r) => r.id), reason: "Requires an independent reviewer of this exact manuscript version." },
    novelty: { satisfied: noveltyMissing.length === 0, review_ids: gate("novelty").map((r) => r.id), missing_claim_ids: noveltyMissing.map((c) => c.id) },
    bibliography: { satisfied: gate("bibliography").length > 0, review_ids: gate("bibliography").map((r) => r.id) },
    compile: { satisfied: gate("compile").length > 0, review_ids: gate("compile").map((r) => r.id) }
  }
  const blockingGaps = relevantGaps.filter((g) => ["fatal", "critical", "major"].includes(g.severity))
  const reasons = [
    ...Object.entries(gates).filter(([, value]) => !(value as any).satisfied).map(([type]) => `Required ${type} gate is missing, stale, or incomplete for manuscript version ${version.version}.`),
    ...blockingGaps.map((g) => `Open ${g.severity} gap ${g.id}: ${g.title}.`)
  ]
  const stale = reviews.filter((r) => REQUIRED_MANUSCRIPT_GATES.includes(r.reviewType as RequiredGate) && !reviewMatchesVersion(r, version)).map((r) => ({ id: r.id, review_type: r.reviewType, target_version: r.targetVersion }))
  return {
    submission_ready: reasons.length === 0,
    status: reasons.length ? "major_revision_required" : "submission_ready",
    canonical_manuscript: { id: version.id, artifact_id: version.artifactId, version: version.version, content_hash: version.contentHash, theorem_fingerprint: version.theoremFingerprint, citation_fingerprint: version.citationFingerprint },
    gates,
    reasons,
    blocking_object_references: blockingGaps.map((g) => ({ type: "Gap", id: g.id, path: paths.get(`Gap:${g.id}`) ?? [`Claim:${g.claimId ?? "unlinked"}`, `Gap:${g.id}`] })),
    stale_review_references: stale,
    missing_gate_references: Object.entries(gates).filter(([, v]) => !(v as any).satisfied).map(([k]) => k),
    open_relevant_gaps: relevantGaps,
    governing_claim_ids: governingClaimIds,
    proof_obligations: { total: version.obligations.length, uncovered_required_ids: missingObligations.map((o) => o.id) }
  }
}

export async function workstreamDependenciesSatisfied(workspaceId: string, workstreamId: string) {
  const dependencies = await prisma.workstreamDependency.findMany({ where: { workspaceId, dependentWorkstreamId: workstreamId }, include: { prerequisite: { include: { reviews: true } } } })
  return { satisfied: dependencies.every((d) => d.prerequisite.status === "completed" && d.prerequisite.reviews.some((r) => r.verdict === approved)), dependencies }
}
