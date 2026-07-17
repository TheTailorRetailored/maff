import { createHash } from "node:crypto"
import { prisma } from "../db/prisma.js"
import { alignProjectReleaseState, assessProjectReleaseAlignment } from "./alignment.js"

const POLICY_VERSION = "legacy-manuscript-lineage-quarantine.v1"

const jsonSafe = <T>(value: T) => JSON.parse(JSON.stringify(value))
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex")

async function graphCounts(workspaceId: string, projectId: string) {
  const [claims, proofAttempts, gaps, edges] = await Promise.all([
    prisma.claim.count({ where: { workspaceId, projectId } }),
    prisma.proofAttempt.count({ where: { workspaceId, projectId } }),
    prisma.gap.count({ where: { workspaceId, projectId } }),
    prisma.graphEdge.count({ where: { workspaceId, projectId } })
  ])
  return { claims, proof_attempts: proofAttempts, gaps, edges }
}

export async function assessLegacyManuscriptLineageQuarantine(workspaceId: string, projectId: string) {
  const project = await prisma.project.findFirstOrThrow({ where: { workspaceId, id: projectId } })
  const versions = await prisma.manuscriptVersion.findMany({
    where: { workspaceId, projectId },
    include: {
      artifact: true,
      obligations: { orderBy: { createdAt: "asc" } },
      _count: { select: {
        externalReviewImports: true,
        physicalArtifacts: true,
        reviewAssignments: true,
        publicationPackages: true,
        readinessSnapshots: true,
        paperBuilds: true
      } }
    },
    orderBy: { version: "asc" }
  })
  const priorAudit = await prisma.projectAudit.findFirst({
    where: { workspaceId, projectId, mode: "migration_audit", policyVersion: POLICY_VERSION, status: "completed" },
    orderBy: { createdAt: "desc" }
  })
  if (versions.length === 0 && priorAudit) {
    return { project, versions, priorAudit, alreadyQuarantined: true, blockers: [] as string[], graph: await graphCounts(workspaceId, projectId) }
  }
  const blockers: string[] = []
  if (versions.length === 0) blockers.push("No legacy manuscript versions exist to quarantine.")
  for (const version of versions) {
    const downstream = version._count
    if (downstream.externalReviewImports) blockers.push(`Version ${version.version} has external review imports.`)
    if (downstream.physicalArtifacts) blockers.push(`Version ${version.version} has physical artifact attachments.`)
    if (downstream.reviewAssignments) blockers.push(`Version ${version.version} has review assignments.`)
    if (downstream.publicationPackages) blockers.push(`Version ${version.version} has publication packages.`)
    if (downstream.readinessSnapshots) blockers.push(`Version ${version.version} has readiness snapshots.`)
    if (downstream.paperBuilds) blockers.push(`Version ${version.version} has structured paper builds.`)
    if (!version.artifact.contentMarkdown && !version.artifact.filePath && !version.artifact.url) {
      blockers.push(`Version ${version.version} source artifact has no retained content or provenance location.`)
    }
  }
  return { project, versions, priorAudit, alreadyQuarantined: false, blockers, graph: await graphCounts(workspaceId, projectId) }
}

export async function quarantineLegacyManuscriptLineage(workspaceId: string, projectId: string) {
  const preflight = await assessLegacyManuscriptLineageQuarantine(workspaceId, projectId)
  if (preflight.blockers.length) throw new Error(`Legacy manuscript lineage quarantine blocked: ${preflight.blockers.join(" ")}`)
  if (preflight.alreadyQuarantined) {
    const alignment = await alignProjectReleaseState(workspaceId, projectId)
    return { idempotent: true, audit: preflight.priorAudit, alignment, graph_before: preflight.graph, graph_after: await graphCounts(workspaceId, projectId) }
  }

  const snapshot = jsonSafe({
    schema_version: "maff.legacy-manuscript-lineage-archive.v1",
    archived_at: new Date().toISOString(),
    project: {
      id: preflight.project.id,
      slug: preflight.project.slug,
      title: preflight.project.title,
      current_working_paper_id: preflight.project.currentWorkingPaperId
    },
    graph_counts: preflight.graph,
    manuscript_versions: preflight.versions.map(({ artifact, obligations, _count, ...version }) => ({
      ...version,
      source_artifact: artifact,
      proof_obligations: obligations,
      downstream_counts: _count
    }))
  })
  const artifactIds = [...new Set(preflight.versions.map((version) => version.artifactId))]
  const versionIds = preflight.versions.map((version) => version.id)

  const audit = await prisma.$transaction(async (tx) => {
    await tx.project.update({ where: { id: projectId }, data: { currentWorkingPaperId: null } })
    await tx.researchArtifact.updateMany({
      where: { workspaceId, projectId, id: { in: artifactIds } },
      data: { kind: "paper_draft" }
    })
    await tx.manuscriptVersion.deleteMany({ where: { workspaceId, projectId, id: { in: versionIds } } })
    return tx.projectAudit.create({ data: {
      workspaceId,
      projectId,
      mode: "migration_audit",
      status: "completed",
      graphSnapshotHash: hash(preflight.graph),
      policyVersion: POLICY_VERSION,
      storedReadiness: snapshot,
      reconstructedReadiness: {
        disposition: "source_paper_preserved_for_structured_resynthesis",
        source_artifact_ids: artifactIds,
        removed_active_manuscript_version_ids: versionIds,
        current_working_paper_id: null
      },
      summaryMarkdown: "Archived detached legacy manuscript-version metadata and obligations; retained the exact source artifacts as paper_draft provenance; cleared only active release authority so a structured manuscript can be synthesized and reviewed under the current lifecycle.",
      noProjectMutation: false,
      completedAt: new Date()
    } })
  }, { isolationLevel: "Serializable" })

  const alignment = await alignProjectReleaseState(workspaceId, projectId)
  const graphAfter = await graphCounts(workspaceId, projectId)
  if (JSON.stringify(preflight.graph) !== JSON.stringify(graphAfter)) throw new Error("Graph invariant violated during legacy manuscript lineage quarantine.")
  const postAssessment = await assessProjectReleaseAlignment(workspaceId, projectId)
  return { idempotent: false, audit, alignment, post_assessment: postAssessment, graph_before: preflight.graph, graph_after: graphAfter }
}

