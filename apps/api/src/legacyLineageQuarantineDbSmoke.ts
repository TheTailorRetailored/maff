import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { prisma } from "./db/prisma.js"
import { quarantineLegacyManuscriptLineage } from "./research/legacyLineage.js"

const suffix = randomUUID().slice(0, 8)
const workspace = await prisma.workspace.create({ data: { slug: `legacy-lineage-smoke-${suffix}`, name: "Legacy lineage smoke", type: "private" } })
try {
  const project = await prisma.project.create({ data: { workspaceId: workspace.id, slug: "legacy-paper", title: "Legacy paper", statement: "Smoke fixture", status: "active" } })
  const claim = await prisma.claim.create({ data: { workspaceId: workspace.id, projectId: project.id, title: "Preserved claim", statementMarkdown: "C", kind: "theorem", status: "reviewed_informal_proof", metadata: {} } })
  const artifact = await prisma.researchArtifact.create({ data: { workspaceId: workspace.id, projectId: project.id, title: "Imported paper", slug: `imported-paper-${suffix}`, kind: "other", status: "draft", contentMarkdown: "retained exact paper content" } })
  const version = await prisma.manuscriptVersion.create({ data: { workspaceId: workspace.id, projectId: project.id, artifactId: artifact.id, version: 1, contentHash: "a".repeat(64), theoremFingerprint: "b".repeat(64), citationFingerprint: "c".repeat(64), isCanonical: true } })
  await prisma.project.update({ where: { id: project.id }, data: { currentWorkingPaperId: version.id } })
  await prisma.proofObligation.create({ data: { workspaceId: workspace.id, projectId: project.id, manuscriptVersionId: version.id, claimId: claim.id, title: "Preserved obligation", statementMarkdown: "O" } })

  const first: any = await quarantineLegacyManuscriptLineage(workspace.id, project.id)
  assert.equal(first.idempotent, false)
  assert.deepEqual(first.graph_before, first.graph_after)
  assert.equal(await prisma.manuscriptVersion.count({ where: { projectId: project.id } }), 0)
  assert.equal((await prisma.project.findUniqueOrThrow({ where: { id: project.id } })).currentWorkingPaperId, null)
  assert.equal((await prisma.researchArtifact.findUniqueOrThrow({ where: { id: artifact.id } })).kind, "paper_draft")
  assert.equal((await prisma.researchArtifact.findUniqueOrThrow({ where: { id: artifact.id } })).contentMarkdown, "retained exact paper content")
  const audit = await prisma.projectAudit.findFirstOrThrow({ where: { projectId: project.id, policyVersion: "legacy-manuscript-lineage-quarantine.v1" } })
  assert.match(JSON.stringify(audit.storedReadiness), /Preserved obligation/)
  assert.equal(await prisma.workstream.count({ where: { projectId: project.id, kind: "paper_synthesis", status: "ready" } }), 1)

  const second: any = await quarantineLegacyManuscriptLineage(workspace.id, project.id)
  assert.equal(second.idempotent, true)
  assert.equal(await prisma.workstream.count({ where: { projectId: project.id, kind: "paper_synthesis", status: "ready" } }), 1)
  console.log("Legacy manuscript lineage quarantine database smoke checks passed.")
} finally {
  await prisma.workspace.delete({ where: { id: workspace.id } }).catch(() => undefined)
  await prisma.$disconnect()
}
