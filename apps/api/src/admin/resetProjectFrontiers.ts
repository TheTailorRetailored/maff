import { prisma } from "../db/prisma.js"

const args = process.argv.slice(2)
const value = (flag: string) => args[args.indexOf(flag) + 1]
const workspaceRef = value("--workspace")

if (!workspaceRef) throw new Error("Usage: tsx src/admin/resetProjectFrontiers.ts --workspace <id-or-slug>")

const workspace = await prisma.workspace.findFirst({
  where: /^[0-9a-f-]{36}$/i.test(workspaceRef) ? { id: workspaceRef } : { slug: workspaceRef }
})
if (!workspace) throw new Error(`No workspace found for ${workspaceRef}`)

const projects = await prisma.project.findMany({
  where: { workspaceId: workspace.id, status: { in: ["seed", "active", "waiting"] } },
  orderBy: { createdAt: "asc" }
})

const results = []
for (const project of projects) {
  const result = await prisma.$transaction(async (tx) => {
    const cancelledAssignments = await tx.reviewAssignment.updateMany({
      where: { workspaceId: workspace.id, projectId: project.id, status: "claimed" },
      data: { status: "cancelled" }
    })
    const cancelledRuns = await tx.agentRun.updateMany({
      where: { workspaceId: workspace.id, projectId: project.id, status: { in: ["started", "running", "submitted"] } },
      data: { status: "cancelled" }
    })
    const abandonedWorkstreams = await tx.workstream.updateMany({
      where: {
        workspaceId: workspace.id,
        projectId: project.id,
        status: { in: ["planned", "ready", "claimed", "running", "blocked", "needs_review", "revision_required", "escalated"] }
      },
      data: {
        status: "abandoned",
        assignedToUserId: null,
        claimedSessionId: null,
        leaseExpiresAt: null,
        escalationMessage: "Superseded by workspace workflow-frontier reset. Mathematical objects and prior reports were preserved."
      }
    })
    const clearedWaitingStates = await tx.projectWaitingState.updateMany({
      where: { workspaceId: workspace.id, projectId: project.id, active: true },
      data: { active: false, resolvedAt: new Date() }
    })
    const cancelledRepairTasks = await tx.repairTask.updateMany({
      where: { workspaceId: workspace.id, projectId: project.id, status: { in: ["planned", "active", "blocked"] } },
      data: { status: "cancelled" }
    })
    const cancelledRepairCampaigns = await tx.repairCampaign.updateMany({
      where: { workspaceId: workspace.id, projectId: project.id, status: { in: ["planned", "active", "awaiting_reaudit"] } },
      data: { status: "cancelled" }
    })
    await tx.project.update({
      where: { id: project.id },
      data: {
        status: "active",
        coordinatorSummary: project.coordinatorSummary
          ? `${project.coordinatorSummary}\n\nWorkflow reset: existing mathematical content is preserved; reassess the current graph before choosing new work.`
          : "Workflow reset: existing mathematical content is preserved; reassess the current graph before choosing new work."
      }
    })
    const assessment = await tx.workstream.create({
      data: {
        workspaceId: workspace.id,
        projectId: project.id,
        title: "Reassess current mathematical frontier",
        kind: "project_coordination",
        coordinatorRole: "ProjectCoordinator",
        status: "ready",
        priority: 100,
        targetObjectType: "Project",
        targetObjectId: project.id,
        instructions: "Inspect the existing project graph, theorem and claim statements, proof attempts, gaps, reports, manuscript versions, and prior review findings. Do not rewrite proofs or manuscript text in this assessment. Decide what remains valid, what needs a fresh review, and the smallest substantive next step. Create a compact actionable frontier; do not create a graph audit, forensic audit, repair campaign, or one task per historical workflow defect.",
        allowedWrites: ["Workstream", "WorkstreamReport", "Gap", "AgentMessage", "RunOutcome"],
        forbiddenActions: [
          "Do not rewrite proofs or manuscript text during this assessment.",
          "Do not delete or alter historical mathematical objects or reviews.",
          "Do not create audit-repair work or administrative cleanup tasks."
        ],
        successCriteria: [
          "Existing mathematical content has been assessed from its current evidence.",
          "The project has a small substantive next frontier or an explicit terminal conclusion.",
          "Any fresh theorem review is scoped to the theorem itself and does not require rewriting it first."
        ],
        reviewPolicy: { min_approved_rounds: 0, review_type: "other", workflow_reset_assessment: true }
      }
    })
    return {
      project_id: project.id,
      title: project.title,
      cancelled_assignments: cancelledAssignments.count,
      cancelled_runs: cancelledRuns.count,
      abandoned_workstreams: abandonedWorkstreams.count,
      cleared_waiting_states: clearedWaitingStates.count,
      cancelled_repair_tasks: cancelledRepairTasks.count,
      cancelled_repair_campaigns: cancelledRepairCampaigns.count,
      assessment_workstream_id: assessment.id
    }
  })
  results.push(result)
}

console.log(JSON.stringify({
  workspace: { id: workspace.id, slug: workspace.slug, name: workspace.name },
  projects_reset: results.length,
  projects: results
}, null, 2))

await prisma.$disconnect()
