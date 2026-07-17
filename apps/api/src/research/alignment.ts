import { prisma } from "../db/prisma.js"

const matureClaimStatuses = ["informal_proof_candidate", "reviewed_informal_proof", "formalization_target", "lean_checked", "lean_verified"] as const
const matureAttemptStatuses = ["candidate", "reviewed"] as const
const activeWorkstreamStatuses = ["planned", "ready", "claimed", "running", "blocked", "needs_review", "revision_required", "escalated"] as const

export async function assessProjectReleaseAlignment(workspaceId: string, projectId: string) {
  const [project, document, versions, matureClaims, matureAttempts, sourceArtifacts, blockingGaps, activePaperWorkstreams] = await Promise.all([
    prisma.project.findFirstOrThrow({ where: { workspaceId, id: projectId } }),
    prisma.manuscriptDocument.findFirst({ where: { workspaceId, projectId }, include: { sections: { where: { isCurrent: true } } } }),
    prisma.manuscriptVersion.findMany({ where: { workspaceId, projectId }, include: { obligations: true }, orderBy: { version: "desc" } }),
    prisma.claim.findMany({ where: { workspaceId, projectId, status: { in: [...matureClaimStatuses] } }, select: { id: true, title: true, status: true } }),
    prisma.proofAttempt.findMany({ where: { workspaceId, projectId, status: { in: [...matureAttemptStatuses] } }, select: { id: true, claimId: true, status: true } }),
    prisma.researchArtifact.findMany({ where: { workspaceId, projectId, kind: { in: ["proof_skeleton", "paper_draft", "survey_memo", "verification_script", "experiment_notebook", "theorem_map", "exposition_note"] } }, select: { id: true, kind: true, title: true } }),
    prisma.gap.findMany({ where: { workspaceId, projectId, status: { in: ["open", "assigned"] }, severity: { in: ["major", "fatal"] }, frontierEligible: true }, select: { id: true, title: true, severity: true } }),
    prisma.workstream.findMany({ where: { workspaceId, projectId, kind: "paper_synthesis", status: { in: [...activeWorkstreamStatuses] } }, select: { id: true, status: true, targetObjectType: true, targetObjectId: true } })
  ])
  const canonical = versions.filter((version) => version.isCanonical)
  const pointer = project.currentWorkingPaperId
  const pointerConsistent = canonical.length <= 1 && (!pointer || canonical.some((version) => version.id === pointer))
  const manuscriptArtifacts = sourceArtifacts.filter((artifact) => artifact.kind === "paper_draft")
  const graphReady = matureClaims.length > 0 && (matureAttempts.length > 0 || sourceArtifacts.some((artifact) => artifact.kind === "proof_skeleton" || artifact.kind === "theorem_map")) && blockingGaps.length === 0

  let classification: "native_aligned" | "proof_graph_ready_for_synthesis" | "legacy_manuscript" | "inconsistent" | "research_in_progress"
  if (!pointerConsistent || canonical.length > 1 || (pointer && !versions.some((version) => version.id === pointer))) classification = "inconsistent"
  else if (document && (canonical.length === 0 || canonical[0].obligations.length > 0)) classification = "native_aligned"
  else if (!document && manuscriptArtifacts.length > 0) classification = "legacy_manuscript"
  else if (!document && versions.length === 0 && graphReady) classification = "proof_graph_ready_for_synthesis"
  else if (versions.length > 0 || canonical.length === 1) classification = "inconsistent"
  else classification = "research_in_progress"

  const requiresAlignment = ["proof_graph_ready_for_synthesis", "legacy_manuscript"].includes(classification)
  return {
    schema_version: "maff.release-alignment.v1",
    project_id: project.id,
    classification,
    aligned: classification === "native_aligned",
    requires_alignment: requiresAlignment,
    requires_administrator: classification === "inconsistent",
    evidence: {
      current_working_paper_id: pointer,
      canonical_manuscript_version_ids: canonical.map((version) => version.id),
      manuscript_document_id: document?.id ?? null,
      current_section_count: document?.sections.length ?? 0,
      mature_claim_ids: matureClaims.map((claim) => claim.id),
      mature_proof_attempt_ids: matureAttempts.map((attempt) => attempt.id),
      source_artifact_ids: sourceArtifacts.map((artifact) => artifact.id),
      legacy_manuscript_artifact_ids: manuscriptArtifacts.map((artifact) => artifact.id),
      blocking_gap_ids: blockingGaps.map((gap) => gap.id),
      active_paper_synthesis_workstream_ids: activePaperWorkstreams.map((workstream) => workstream.id)
    },
    next_action: classification === "proof_graph_ready_for_synthesis" || classification === "legacy_manuscript"
      ? { tool: "align_project_release_state", instruction: "Create or reuse one bounded PaperWriter synthesis frontier. Preserve source provenance and do not infer mathematical approval." }
      : classification === "inconsistent"
        ? { tool: null, instruction: "Stop and repair contradictory manuscript pointers or incomplete legacy state administratively; do not guess." }
        : classification === "native_aligned"
          ? { tool: "get_project_release_contract", instruction: "Continue through the authoritative release contract." }
          : { tool: "claim_next_assignment", instruction: "Continue ordinary research until a mature proof graph exists." }
  }
}

export async function alignProjectReleaseState(workspaceId: string, projectId: string) {
  const assessment = await assessProjectReleaseAlignment(workspaceId, projectId)
  if (!assessment.requires_alignment) return { assessment, workstream: null, idempotent: true }
  const legacyIds = assessment.evidence.legacy_manuscript_artifact_ids
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const result = await prisma.$transaction(async (tx) => {
        const existing = await tx.workstream.findFirst({ where: { workspaceId, projectId, kind: "paper_synthesis", status: { in: [...activeWorkstreamStatuses] } }, orderBy: { createdAt: "asc" } })
        if (existing) return { workstream: existing, created: false }
        const workstream = await tx.workstream.create({ data: {
          workspaceId,
          projectId,
          title: assessment.classification === "legacy_manuscript" ? "Align legacy manuscript with the structured release workflow" : "Synthesize the mature proof graph into a structured manuscript",
          kind: "paper_synthesis",
          coordinatorRole: "PaperWriter",
          status: "ready",
          priority: 100,
          targetObjectType: "Project",
          targetObjectId: projectId,
          instructions: assessment.classification === "legacy_manuscript"
            ? `Read the legacy manuscript artifacts (${legacyIds.join(", ")}) and governing graph. Author one structured ManuscriptDocument with explicit claim links and proof-obligation drafts, then build it through PaperBuilder. Preserve provenance; do not treat historical prose or reviews as current approval.`
            : "Read the mature governing claims, reviewed proof attempts, source artifacts, assumptions, boundary cases, citations, and remaining non-blocking uncertainty. Author one structured ManuscriptDocument with explicit claim links and proof-obligation drafts, then build it through PaperBuilder.",
          allowedWrites: ["ManuscriptDocument", "ManuscriptSection", "ManuscriptVersion", "ProofObligation", "PaperBuild", "WorkstreamReport", "RunOutcome"],
          forbiddenActions: ["Do not infer review approval from graph maturity.", "Do not create generic reviews or graph audits.", "Do not upload, hash, attach, or bless manuscript files manually."],
          successCriteria: ["One structured manuscript represents the mature mainline graph.", "Every governing claim and load-bearing proof has an explicit obligation draft.", "A successful exact PaperBuild is promoted as the working manuscript, not as a submission candidate."],
          reviewPolicy: { required: false, note: "Manuscript release gates are enforced on the exact built version, not on this synthesis assignment." }
        } })
        return { workstream, created: true }
      }, { isolationLevel: "Serializable" })
      return { assessment, workstream: result.workstream, idempotent: !result.created }
    } catch (error: any) {
      if (error?.code !== "P2034" || attempt === 2) throw error
    }
  }
  throw new Error("Release-state alignment could not acquire a serializable project transition.")
}
