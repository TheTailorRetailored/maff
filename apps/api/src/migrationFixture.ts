import assert from "node:assert/strict"
import { readFile, writeFile } from "node:fs/promises"
import { prisma } from "./db/prisma.js"
import * as runtime from "./research/runtime.js"

const mode = process.argv[2]
const manifestPath = process.env.MAFF_MIGRATION_FIXTURE_MANIFEST
if (!manifestPath || !["seed", "verify"].includes(mode)) throw new Error("Usage: MAFF_MIGRATION_FIXTURE_MANIFEST=<outside-repo path> npm run test:migration:fixture -- seed|verify")

if (mode === "seed") {
  const owner = await prisma.user.create({ data: { auth0Sub: "synthetic-auth0|migration-owner", email: "migration-owner@example.invalid", displayName: "Synthetic migration owner" } })
  const member = await prisma.user.create({ data: { auth0Sub: "synthetic-auth0|migration-member", email: "migration-member@example.invalid", displayName: "Synthetic migration member" } })
  const workspace = await prisma.workspace.create({ data: { slug: "synthetic-provider-migration", name: "Synthetic provider migration", type: "private", ownerUserId: owner.id } })
  await prisma.workspaceMember.createMany({ data: [
    { workspaceId: workspace.id, userId: owner.id, role: "owner" },
    { workspaceId: workspace.id, userId: member.id, role: "editor" }
  ] })
  const node = await prisma.nodeIndex.create({ data: { workspaceId: workspace.id, nodeId: "synthetic-node", slug: "synthetic-node", title: "Synthetic node", type: "Claim", status: "active", path: "synthetic/node.md", metadata: { synthetic: true }, bodyPreview: "Synthetic graph fixture" } })
  const edge = await prisma.edgeIndex.create({ data: { workspaceId: workspace.id, sourceNodeId: node.nodeId, targetNodeRef: "synthetic-target", edgeType: "depends_on" } })
  const task = await prisma.taskIndex.create({ data: { workspaceId: workspace.id, nodeId: "synthetic-task", targetNodeId: node.nodeId, workflow: "migration_fixture", title: "Synthetic task", assignedToUserId: member.id } })
  const project = await runtime.createProject({ workspaceId: workspace.id, title: "Synthetic migration project", statement: "Verify provider-neutral identity migration.", userId: owner.id })
  const proposedGoal = await runtime.proposeProjectGoal({ workspaceId: workspace.id, projectId: project.id, title: "Synthetic migration goal", statement: "Verify the upgrade path preserves research records.", successCriteria: ["Synthetic fixture survives migration."] })
  const goal = await runtime.approveProjectGoal({ workspaceId: workspace.id, goalId: proposedGoal.id, userId: owner.id })
  const workstream = await runtime.createWorkstream({ workspaceId: workspace.id, projectId: project.id, goalId: goal.id, title: "Synthetic migration workstream", kind: "proof_route_generation", instructions: "Synthetic fixture only." })
  const claim = await runtime.createClaim({ workspaceId: workspace.id, projectId: project.id, title: "Synthetic migration claim", statementMarkdown: "Synthetic statement.", kind: "conjecture" })
  const report = await runtime.submitWorkstreamReport({ workspaceId: workspace.id, workstreamId: workstream.id, title: "Synthetic report", bodyMarkdown: "Synthetic migration report.", linkedObjectRefs: [`Claim:${claim.id}`], uncertaintyNotes: [], artifactRefs: [] })
  const review = await runtime.recordReviewRound({ workspaceId: workspace.id, workstreamId: workstream.id, reportId: report.report_id, verdict: "approved", bodyMarkdown: "Synthetic approval.", issues: [], requiredChanges: [], checkedRefs: [`Claim:${claim.id}`] })
  const artifact = await runtime.createResearchArtifact({ workspaceId: workspace.id, projectId: project.id, title: "Synthetic manuscript", kind: "paper_draft", contentMarkdown: "Synthetic manuscript content." })
  const manuscript = await runtime.createManuscriptVersion({ workspaceId: workspace.id, projectId: project.id, artifactId: artifact.id, claimIds: [claim.id] })
  const audit = await prisma.auditLog.create({ data: { workspaceId: workspace.id, userId: owner.id, action: "migration.fixture.seed", targetType: "Workspace", targetId: workspace.id, details: { synthetic: true } } })
  await writeFile(manifestPath, JSON.stringify({ ownerId: owner.id, memberId: member.id, workspaceId: workspace.id, nodeId: node.id, edgeId: edge.id, taskId: task.id, projectId: project.id, goalId: goal.id, workstreamId: workstream.id, claimId: claim.id, reportId: report.report_id, reviewId: review.id, artifactId: artifact.id, manuscriptId: manuscript.id, auditId: audit.id }), { encoding: "utf8", mode: 0o600 })
  console.log("Synthetic pre-migration fixture seeded")
} else {
  const ids = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, string>
  const owner = await prisma.user.findUniqueOrThrow({ where: { id: ids.ownerId } })
  const member = await prisma.user.findUniqueOrThrow({ where: { id: ids.memberId } })
  assert.equal(owner.auth0Sub, "synthetic-auth0|migration-owner")
  assert.equal(member.auth0Sub, "synthetic-auth0|migration-member")
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: ids.workspaceId }, include: { members: true } })
  assert.equal(workspace.ownerUserId, ids.ownerId)
  assert.deepEqual(new Set(workspace.members.map((item) => `${item.userId}:${item.role}`)), new Set([`${ids.ownerId}:owner`, `${ids.memberId}:editor`]))
  await Promise.all([
    prisma.nodeIndex.findUniqueOrThrow({ where: { id: ids.nodeId } }),
    prisma.edgeIndex.findUniqueOrThrow({ where: { id: ids.edgeId } }),
    prisma.taskIndex.findUniqueOrThrow({ where: { id: ids.taskId } }),
    prisma.project.findUniqueOrThrow({ where: { id: ids.projectId } }),
    prisma.projectGoal.findUniqueOrThrow({ where: { id: ids.goalId } }),
    prisma.workstream.findUniqueOrThrow({ where: { id: ids.workstreamId } }),
    prisma.claim.findUniqueOrThrow({ where: { id: ids.claimId } }),
    prisma.workstreamReport.findUniqueOrThrow({ where: { id: ids.reportId } }),
    prisma.reviewRound.findUniqueOrThrow({ where: { id: ids.reviewId } }),
    prisma.researchArtifact.findUniqueOrThrow({ where: { id: ids.artifactId } }),
    prisma.manuscriptVersion.findUniqueOrThrow({ where: { id: ids.manuscriptId } }),
    prisma.auditLog.findUniqueOrThrow({ where: { id: ids.auditId } })
  ])
  assert.equal(await prisma.userIdentity.count(), 0, "migration must not invent external identity links")
  console.log("Synthetic pre-migration relationships and stable IDs preserved")
}

await prisma.$disconnect()
