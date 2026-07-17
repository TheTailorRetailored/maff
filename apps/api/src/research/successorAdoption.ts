import type { Prisma } from "@prisma/client"
import { prisma } from "../db/prisma.js"

const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}

type AdoptionInput = {
  workspaceId: string
  projectId: string
  expectedCurrentManuscriptVersionId: string
  successorManuscriptVersionId: string
  supportingReviewRoundId: string
  paperBuildId: string
}

async function validatedEvidence(db: Prisma.TransactionClient | typeof prisma, input: AdoptionInput) {
  const [project, expected, successor, review, build] = await Promise.all([
    db.project.findFirstOrThrow({ where: { workspaceId: input.workspaceId, id: input.projectId } }),
    db.manuscriptVersion.findFirstOrThrow({ where: { workspaceId: input.workspaceId, projectId: input.projectId, id: input.expectedCurrentManuscriptVersionId }, include: { obligations: true } }),
    db.manuscriptVersion.findFirstOrThrow({ where: { workspaceId: input.workspaceId, projectId: input.projectId, id: input.successorManuscriptVersionId }, include: { obligations: true } }),
    db.reviewRound.findFirstOrThrow({ where: { workspaceId: input.workspaceId, projectId: input.projectId, id: input.supportingReviewRoundId }, include: { reviewAssignment: { include: { reviewerRun: true } } } }),
    db.paperBuild.findFirstOrThrow({ where: { workspaceId: input.workspaceId, projectId: input.projectId, id: input.paperBuildId }, include: { sourceArtifact: true, pdfArtifact: true } })
  ])
  const alreadyAdopted = project.currentWorkingPaperId === successor.id && successor.isCanonical
  if (!alreadyAdopted && (project.currentWorkingPaperId !== expected.id || !expected.isCanonical)) throw new Error(`Expected current ManuscriptVersion ${expected.id} is no longer the project's canonical working manuscript.`)
  const otherCanonicalCount = await db.manuscriptVersion.count({ where: { workspaceId: input.workspaceId, projectId: input.projectId, isCanonical: true, id: { not: alreadyAdopted ? successor.id : expected.id } } })
  if (otherCanonicalCount) throw new Error("Project has contradictory canonical manuscript state; administrative repair is required before successor adoption.")
  if (!alreadyAdopted && successor.isCanonical) throw new Error("Successor is already canonical but is not the project's current working manuscript.")
  if (successor.id === expected.id || successor.version <= expected.version) throw new Error("Adoption requires a later, distinct ManuscriptVersion successor.")
  const requiredObligationIds = successor.obligations.filter((item) => item.required).map((item) => item.id)
  if (!requiredObligationIds.length) throw new Error("A reviewed successor requires a non-empty exact-version proof-obligation ledger.")

  const lineage = await db.researchLink.findFirst({ where: {
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    sourceType: "ManuscriptVersion",
    sourceId: successor.id,
    OR: [
      { targetType: "ManuscriptVersion", targetId: expected.id, relationType: { in: ["source_successor_of", "editorial_successor_of", "adopted_working_successor_of"] } },
      { targetType: "ResearchArtifact", targetId: expected.artifactId, relationType: "derived_from" }
    ]
  } })
  if (!lineage) throw new Error(`Successor ${successor.id} has no explicit lineage to expected current manuscript ${expected.id}.`)

  const manifest = record(build.buildManifest)
  if (build.manuscriptVersionId !== successor.id || build.status !== "succeeded") throw new Error("PaperBuild must be a successful build of the exact successor.")
  if (manifest.manuscript_version_id !== successor.id || manifest.manuscript_content_hash !== successor.contentHash) throw new Error("PaperBuild manifest does not bind the exact successor id and content hash.")
  for (const artifact of [build.sourceArtifact, build.pdfArtifact]) {
    if (!artifact || artifact.storageStatus !== "available" || !artifact.storageKey || !artifact.sha256 || artifact.byteSize === null) throw new Error("PaperBuild must retain available, hashed source and PDF bytes.")
  }

  const scope = record(review.scope)
  const assignment = review.reviewAssignment
  if (review.targetVersion !== successor.id) throw new Error("ReviewRound must target the exact successor ManuscriptVersion.")
  if (review.verdict !== "approved" || review.evidenceStatus !== "assigned_valid") throw new Error("Successor adoption requires assigned, approved exact-version review evidence.")
  if (!assignment || assignment.status !== "submitted" || !["submitted", "completed"].includes(assignment.reviewerRun.status)) throw new Error("Supporting review must come from a submitted locked assignment and completed reviewer run.")
  if (!["independent_reviewer", "external_referee_style"].includes(review.independence)) throw new Error("Supporting review must record independent reviewer provenance.")
  if (scope.paper_build !== build.id) throw new Error("Supporting review scope must bind the exact clean PaperBuild.")
  const checkedRefs = new Set(strings(review.checkedRefs))
  if (!checkedRefs.has(`ManuscriptVersion:${successor.id}`) || !checkedRefs.has(`PaperBuild:${build.id}`)) throw new Error("Supporting review must explicitly inspect the exact successor and PaperBuild.")
  const inspectedArtifacts = new Set(strings(review.inspectedArtifactIds))
  if (!build.sourceArtifactId || !build.pdfArtifactId || !inspectedArtifacts.has(build.sourceArtifactId) || !inspectedArtifacts.has(build.pdfArtifactId)) throw new Error("Supporting review must inspect the exact source and PDF artifacts from the clean build.")
  const checked = new Set(strings(review.checkedObligationIds))
  const unchecked = requiredObligationIds.filter((id) => !checked.has(id))
  if (unchecked.length) throw new Error(`Supporting review did not check required successor obligations: ${unchecked.join(", ")}.`)
  return { project, expected, successor, review, build, alreadyAdopted, requiredObligationIds }
}

export async function findAdoptableReviewedManuscriptSuccessor(workspaceId: string, projectId: string, expectedCurrentManuscriptVersionId: string) {
  const reviews = await prisma.reviewRound.findMany({
    where: { workspaceId, projectId, verdict: "approved", evidenceStatus: "assigned_valid", targetVersion: { not: null } },
    orderBy: { createdAt: "desc" }
  })
  for (const review of reviews) {
    if (!review.targetVersion || review.targetVersion === expectedCurrentManuscriptVersionId) continue
    const buildId = typeof record(review.scope).paper_build === "string" ? String(record(review.scope).paper_build) : null
    if (!buildId) continue
    try {
      const evidence = await validatedEvidence(prisma, { workspaceId, projectId, expectedCurrentManuscriptVersionId, successorManuscriptVersionId: review.targetVersion, supportingReviewRoundId: review.id, paperBuildId: buildId })
      if (!evidence.alreadyAdopted) return {
        expected_current_manuscript_version_id: evidence.expected.id,
        successor_manuscript_version_id: evidence.successor.id,
        supporting_review_round_id: evidence.review.id,
        paper_build_id: evidence.build.id
      }
    } catch { /* A release contract advertises only a fully validated successor. */ }
  }
  return null
}

export async function adoptReviewedManuscriptSuccessor(input: AdoptionInput) {
  const adopted = await prisma.$transaction(async (tx) => {
    const evidence = await validatedEvidence(tx, input)
    const note = JSON.stringify({ supporting_review_round_id: evidence.review.id, paper_build_id: evidence.build.id, changes_working_text_authority_only: true, confers_mathematical_approval: false, activates_release_assessment: false, publishes: false })
    const existingLink = await tx.researchLink.findFirst({ where: { workspaceId: input.workspaceId, projectId: input.projectId, sourceType: "ManuscriptVersion", sourceId: evidence.successor.id, relationType: "adopted_working_successor_of", targetType: "ManuscriptVersion", targetId: evidence.expected.id } })
    if (evidence.alreadyAdopted) {
      if (!existingLink) throw new Error("Successor is current, but its atomic adoption provenance is missing.")
      return { idempotent: true, predecessor: evidence.expected, successor: evidence.successor }
    }
    const now = new Date()
    await tx.manuscriptVersion.update({ where: { id: evidence.expected.id }, data: { isCanonical: false, supersededAt: now } })
    const successor = await tx.manuscriptVersion.update({ where: { id: evidence.successor.id }, data: { isCanonical: true, supersededAt: null } })
    await tx.project.update({ where: { id: input.projectId }, data: { currentWorkingPaperId: successor.id } })
    if (!existingLink) await tx.researchLink.create({ data: { workspaceId: input.workspaceId, projectId: input.projectId, sourceType: "ManuscriptVersion", sourceId: successor.id, relationType: "adopted_working_successor_of", targetType: "ManuscriptVersion", targetId: evidence.expected.id, noteMarkdown: note } })
    return { idempotent: false, predecessor: evidence.expected, successor }
  }, { isolationLevel: "Serializable" })
  return adopted
}
