import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { prisma } from "./db/prisma.js"
import * as runtime from "./research/runtime.js"

if (!process.env.DATABASE_URL) {
  console.log("Skipping Maff v2 database smoke checks: DATABASE_URL is not set.")
  process.exit(0)
}

const suffix = randomUUID().slice(0, 8)
const user = await prisma.user.create({ data: { auth0Sub: `smoke|${suffix}`, email: `smoke-${suffix}@maff.local` } })
const workspace = await prisma.workspace.create({ data: { slug: `smoke-v2-${suffix}`, name: `Smoke v2 ${suffix}`, type: "private", ownerUserId: user.id } })
await prisma.workspaceMember.create({ data: { workspaceId: workspace.id, userId: user.id, role: "owner" } })

const project = await runtime.createProject({ workspaceId: workspace.id, title: "Maff v2 vertical slice", area: "smoke", statement: "Check project-goal-workstream-agent-report-review gates.", userId: user.id })
const proposedGoal = await runtime.proposeProjectGoal({ workspaceId: workspace.id, projectId: project.id, title: "Find proof routes", statement: "Produce multiple candidate routes.", successCriteria: ["Two routes", "Review passed"] })
const goal = await runtime.approveProjectGoal({ workspaceId: workspace.id, goalId: proposedGoal.id, userId: user.id })
assert.equal(goal.status, "approved")

const workstream = await runtime.createWorkstream({ workspaceId: workspace.id, projectId: project.id, goalId: goal.id, title: "Proof route generation", kind: "proof_route_generation", instructions: "Create claims and routes." })
const context = await runtime.getMyMaffContext({ userId: user.id, project: "vertical slice" })
assert.equal(context.active_project?.id, project.id)
const ergonomicClaim = await runtime.claimNextAssignment({ userId: user.id, project: "vertical slice", role: "ProofRouteAgent", sessionId: `session-${suffix}`, model: "smoke" })
assert.equal(ergonomicClaim.assignment?.id, workstream.id)
assert.equal(ergonomicClaim.agent_run?.role, "ProofRouteAgent")
const assignment = await runtime.claimAgentAssignment({ workspaceId: workspace.id, projectId: project.id, workstreamId: workstream.id, sessionId: `session-${suffix}-direct`, userId: user.id })
assert.equal(assignment.briefing.role, "ProofRouteAgent")
const run = await runtime.startAgentRun({ workspaceId: workspace.id, workstreamId: workstream.id, sessionId: `session-${suffix}-direct`, model: "smoke" })
assert.equal(run.agentRun.role, "ProofRouteAgent")

const claim = await runtime.createClaim({ workspaceId: workspace.id, projectId: project.id, title: "Smoke claim", statementMarkdown: "Every smoke test has a review gate.", kind: "conjecture", actorRole: "ProofRouteAgent" })
const routeA = await runtime.createProofRoute({ workspaceId: workspace.id, projectId: project.id, claimId: claim.id, title: "Direct route", strategyMarkdown: "Prove by inspecting the runtime.", requiredLemmas: ["Gate lemma"], firstTestableStep: "Create report", killCondition: "Review rejects", createdByWorkstreamId: workstream.id })
const routeB = await runtime.createProofRoute({ workspaceId: workspace.id, projectId: project.id, claimId: claim.id, title: "Counterexample route", strategyMarkdown: "Try to complete before review.", requiredLemmas: [], firstTestableStep: "Call complete early", killCondition: "Completion succeeds incorrectly", createdByWorkstreamId: workstream.id })
assert.ok(routeA.id && routeB.id)

const report = await runtime.submitWorkstreamReport({ workspaceId: workspace.id, workstreamId: workstream.id, title: "Route report", bodyMarkdown: "## Research process\nCreated two routes, including a disproof route.", linkedObjectRefs: [`Claim:${claim.id}`, `ProofRoute:${routeA.id}`, `ProofRoute:${routeB.id}`], uncertaintyNotes: ["Smoke uncertainty"], artifactRefs: [] })
assert.equal(report.status, "submitted")

const rejection = await runtime.recordReviewRound({ workspaceId: workspace.id, workstreamId: workstream.id, reportId: report.id, verdict: "needs_revision", bodyMarkdown: "Needs a sharper first testable step.", issues: ["First test unclear"], requiredChanges: ["Clarify step"], checkedRefs: [] })
assert.equal(rejection.verdict, "needs_revision")
await assert.rejects(() => runtime.completeWorkstream({ workspaceId: workspace.id, workstreamId: workstream.id }), /approved ReviewRound/)

const approval = await runtime.recordReviewRound({ workspaceId: workspace.id, workstreamId: workstream.id, reportId: report.id, verdict: "approved", bodyMarkdown: "Approved after revision.", issues: [], requiredChanges: [], checkedRefs: [`WorkstreamReport:${report.id}`] })
assert.equal(approval.verdict, "approved")
const completed = await runtime.completeWorkstream({ workspaceId: workspace.id, workstreamId: workstream.id })
assert.equal(completed.status, "completed")

await assert.rejects(() => runtime.updateClaimStatus({ workspaceId: workspace.id, claimId: claim.id, status: "lean_verified", actorRole: "ProofAttemptAgent" }), /ProofAttemptAgent/)

const theorem = await runtime.createLeanTheorem({ workspaceId: workspace.id, projectId: project.id, leanName: "smoke_theorem", proofFile: "Smoke.lean", statementMarkdown: "theorem smoke : True := by trivial", hasSorry: true, hasAxiom: false })
const checked = await runtime.markLeanVerified({ workspaceId: workspace.id, leanTheoremId: theorem.id })
assert.notEqual(checked.status, "lean_verified")

const controlRoom = await runtime.getProjectControlRoom(workspace.id, project.id)
assert.ok(controlRoom.workstreams_by_status.completed?.some((item) => item.id === workstream.id))

await prisma.$disconnect()
console.log("Maff v2 database smoke checks passed")
