import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { prisma } from "./db/prisma.js"
import * as runtime from "./research/runtime.js"

const suffix = randomUUID().slice(0, 8)
const workspace = await prisma.workspace.create({ data: { slug: `paper-builder-smoke-${suffix}`, name: "PaperBuilder smoke", type: "private" } })
try {
  const user = await prisma.user.create({ data: { auth0Sub: `paper-builder-smoke-${suffix}`, displayName: "PaperBuilder Smoke" } })
  await prisma.workspaceMember.create({ data: { workspaceId: workspace.id, userId: user.id, role: "owner" } })
  const project = await runtime.createProject({ workspaceId: workspace.id, title: "Structured paper smoke", slug: `structured-paper-${suffix}`, statement: "Prove the identity x=x.", userId: user.id })
  const proposed = await runtime.proposeProjectGoal({ workspaceId: workspace.id, projectId: project.id, title: "Build a paper", statement: "Materialize the structured manuscript.", successCriteria: ["Internal PDF builds"] })
  const goal = await runtime.approveProjectGoal({ workspaceId: workspace.id, goalId: proposed.id, userId: user.id })
  const workstream = await runtime.createWorkstream({ workspaceId: workspace.id, projectId: project.id, goalId: goal.id, title: "Write structured paper", kind: "paper_synthesis", instructions: "Use PaperBuilder." })
  const claim = await runtime.createClaim({ workspaceId: workspace.id, projectId: project.id, title: "Identity", statementMarkdown: "For every $x$, $x=x$.", kind: "theorem", status: "candidate" })
  const claimed = await runtime.claimAgentAssignment({ workspaceId: workspace.id, projectId: project.id, workstreamId: workstream.id, sessionId: `paper-builder-${suffix}`, userId: user.id })
  const run = await runtime.startAgentRun({ workspaceId: workspace.id, workstreamId: claimed.assignment.id, sessionId: `paper-builder-${suffix}`, model: "smoke" })
  await runtime.updateStructuredManuscript({
    workspaceId: workspace.id,
    projectId: project.id,
    agentRunId: run.agentRun.id,
    metadata: { title: "Structured paper smoke", authors: ["Maff Smoke"], abstract_markdown: "A deterministic build test." },
    sections: [
      { stableKey: "main", ordinal: 1, kind: "proof", title: "Main result", sourceFormat: "latex", contentMarkdown: "\\begin{theorem}For every $x$, $x=x$.\\end{theorem}\n\\begin{proof}Immediate.\\end{proof}", claimIds: [claim.id] }
    ],
    obligationDrafts: [{ title: "Identity proof", statement_markdown: "Prove the identity for all x.", claim_id: claim.id, assumptions: ["x belongs to a fixed set"], boundary_cases: ["empty ambient set is vacuous"], exact_manuscript_proof_present: true }]
  })
  const built = await runtime.buildStructuredManuscript({ workspaceId: workspace.id, projectId: project.id, agentRunId: run.agentRun.id })
  assert.equal(built.paper_build.status, "succeeded")
  assert.equal(built.surfaced_file, null)
  assert.equal(built.manuscript_version.isCanonical, true)
  assert.equal(built.manuscript_version.physicalArtifacts.length, 2)
  assert.ok(built.manuscript_version.physicalArtifacts.every((link: any) => link.artifact.visibility === "internal"))
  const inspected = await runtime.inspectStructuredManuscriptBuild(workspace.id, built.paper_build.id)
  assert.match(inspected.tex ?? "", /maff-section:main@1/)
  assert.match(inspected.normalized_manuscript_markdown ?? "", /Main result/)
  assert.equal(inspected.pdf?.surfaced, false)
  const readiness: any = await runtime.computeProjectSubmissionReadiness(workspace.id, project.id)
  assert.equal(readiness.gates.compile.satisfied, true)
  assert.equal(readiness.gates.compile.paper_build_id, built.paper_build.id)
  assert.notEqual(readiness.next_required_action?.gate, "compile")
  console.log("PaperBuilder database smoke checks passed")
} finally {
  await prisma.workspace.delete({ where: { id: workspace.id } }).catch(() => undefined)
  await prisma.$disconnect()
}
