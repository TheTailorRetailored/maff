import fs from "node:fs/promises"
import path from "node:path"
import type { AgentRole, ClaimStatus, Prisma, WorkstreamKind } from "@prisma/client"
import { prisma } from "../db/prisma.js"
import { config } from "../config.js"
import { leanClient } from "../lean/leanClient.js"

const roleRecipeFiles: Record<AgentRole, string> = {
  ProjectCoordinator: "project_coordinator.md",
  WorkstreamCoordinator: "workstream_coordinator.md",
  LiteratureAgent: "literature_agent.md",
  ProofRouteAgent: "proof_route_agent.md",
  ProofAttemptAgent: "proof_attempt_agent.md",
  CounterexampleAgent: "counterexample_agent.md",
  ExperimentAgent: "experiment_agent.md",
  CodingAgent: "experiment_agent.md",
  GapAnalyst: "gap_analyst.md",
  HostileReviewer: "hostile_reviewer.md",
  FormalizationAgent: "formalization_agent.md",
  LeanChecker: "lean_checker.md",
  PaperWriter: "paper_writer.md",
  TriageAgent: "triage_agent.md"
}

const roleByKind: Record<WorkstreamKind, AgentRole> = {
  project_coordination: "ProjectCoordinator",
  literature_review: "LiteratureAgent",
  proof_route_generation: "ProofRouteAgent",
  proof_attempt: "ProofAttemptAgent",
  counterexample_search: "CounterexampleAgent",
  experiment_design: "ExperimentAgent",
  computation: "CodingAgent",
  hostile_review: "HostileReviewer",
  gap_analysis: "GapAnalyst",
  formalization: "FormalizationAgent",
  lean_check: "LeanChecker",
  paper_synthesis: "PaperWriter",
  triage: "TriageAgent"
}

const allowedWritesByRole: Record<AgentRole, string[]> = {
  ProjectCoordinator: ["Project", "ProjectGoal", "Workstream", "AgentMessage"],
  WorkstreamCoordinator: ["Workstream", "WorkstreamReport", "AgentMessage"],
  LiteratureAgent: ["Paper", "KnownResult", "Artifact", "WorkstreamReport", "AgentMessage"],
  ProofRouteAgent: ["Claim", "ProofRoute", "Gap", "WorkstreamReport", "AgentMessage"],
  ProofAttemptAgent: ["ProofAttempt", "Gap", "Assumption", "WorkstreamReport", "AgentMessage"],
  CounterexampleAgent: ["Counterexample", "Gap", "Experiment", "Artifact", "WorkstreamReport", "AgentMessage"],
  ExperimentAgent: ["Experiment", "Artifact", "WorkstreamReport", "AgentMessage"],
  CodingAgent: ["Experiment", "Artifact", "WorkstreamReport", "AgentMessage"],
  GapAnalyst: ["Gap", "Workstream", "WorkstreamReport", "AgentMessage"],
  HostileReviewer: ["ReviewRound", "AgentMessage"],
  FormalizationAgent: ["FormalizationTarget", "LeanTheorem", "Assumption", "Artifact", "WorkstreamReport", "AgentMessage"],
  LeanChecker: ["LeanTheorem", "Artifact", "WorkstreamReport", "AgentMessage"],
  PaperWriter: ["Artifact", "WorkstreamReport", "AgentMessage"],
  TriageAgent: ["Workstream", "AgentMessage", "WorkstreamReport"]
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || `project-${Date.now()}`
}

function jsonArray(value: unknown): Prisma.InputJsonValue {
  return Array.isArray(value) ? value as Prisma.InputJsonArray : []
}

function jsonObject(value: unknown): Prisma.InputJsonValue {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Prisma.InputJsonObject : {}
}

function normalizeLines(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean)
  if (typeof value === "string" && value.trim()) return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  return []
}

async function workspaceSlug(workspaceId: string) {
  return (await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } })).slug
}

async function fallbackJobUserId(workspaceId: string) {
  return (await prisma.workspaceMember.findFirstOrThrow({ where: { workspaceId }, orderBy: { createdAt: "asc" } })).userId
}

async function roleRecipe(role: AgentRole) {
  const file = path.join(config.promptsDir, "roles", roleRecipeFiles[role])
  try {
    return await fs.readFile(file, "utf8")
  } catch {
    return `# ${role}\n\nNo role recipe file is installed yet.`
  }
}

function forbiddenActions(role: AgentRole) {
  const common = [
    "Do not complete Workstream directly; submit a report, block, or escalate.",
    "Do not delete or overwrite failed attempts.",
    "Do not write outside allowed_writes."
  ]
  if (role === "ProofRouteAgent" || role === "ProofAttemptAgent") common.unshift("Do not mark Claim as proved.")
  if (role === "LiteratureAgent") common.unshift("Do not mark novelty as settled; produce evidence only.")
  if (role === "HostileReviewer") common.unshift("Do not edit the object or report being reviewed in the same ReviewRound.")
  if (role === "LeanChecker") common.unshift("Do not mark LeanTheorem lean_verified when sorry, axiom, failed check, or temporary assumptions remain.")
  return common
}

function outputContract(role: AgentRole) {
  if (role === "ProofRouteAgent") {
    return {
      required_sections: ["Research process", "Created claims", "Proof routes", "Disproof/counterexample route", "Uncertainties", "Recommended next workstreams"],
      required_tool_calls: ["create_claim", "create_proof_route", "create_or_update_workstream_report", "submit_report_for_review"]
    }
  }
  if (role === "HostileReviewer") {
    return { required_sections: ["Verdict", "Issues", "Required changes", "Checked references"], required_tool_calls: ["record_review_round"] }
  }
  if (role === "LiteratureAgent") {
    return {
      required_sections: ["Terminology search", "Exact statements found", "Novelty evidence", "Adjacent inspiration", "Uncertainties"],
      required_tool_calls: ["create_paper", "create_known_result", "create_or_update_workstream_report", "submit_report_for_review"]
    }
  }
  if (role === "GapAnalyst") {
    return {
      required_sections: ["Gap inventory", "Severity ranking", "Smallest next steps", "Escalations"],
      required_tool_calls: ["create_gap", "create_or_update_workstream_report", "submit_report_for_review"]
    }
  }
  if (role === "LeanChecker") {
    return {
      required_sections: ["Lean check summary", "Diagnostics", "Sorry/axiom hygiene", "Assumption gate", "Verification decision"],
      required_tool_calls: ["lean_check", "mark_lean_verified", "create_or_update_workstream_report", "submit_report_for_review"]
    }
  }
  return { required_sections: ["Research process", "Artifacts produced", "Uncertainties", "Next steps"], required_tool_calls: ["create_or_update_workstream_report", "submit_report_for_review"] }
}

export async function listWorkspacesForUser(userId: string) {
  return prisma.workspace.findMany({ where: { members: { some: { userId } } }, orderBy: { createdAt: "asc" } })
}

export async function createProject(input: { workspaceId: string; title: string; area?: string; statement: string; slug?: string; userId?: string }) {
  return prisma.project.create({
    data: {
      workspaceId: input.workspaceId,
      slug: input.slug ? slugify(input.slug) : slugify(input.title),
      title: input.title,
      area: input.area,
      statement: input.statement,
      status: "seed",
      coordinatorSummary: "Project created. Coordinator should propose explicit user-approved goals before specialist work begins.",
      createdByUserId: input.userId
    }
  })
}

export async function listProjects(workspaceId: string) {
  return prisma.project.findMany({ where: { workspaceId }, orderBy: [{ status: "asc" }, { updatedAt: "desc" }] })
}

export async function getProject(workspaceId: string, projectId: string) {
  return prisma.project.findFirstOrThrow({ where: { workspaceId, id: projectId } })
}

export async function updateProjectSummary(input: { workspaceId: string; projectId: string; coordinatorSummary: string }) {
  return prisma.project.update({ where: { id: input.projectId, workspaceId: input.workspaceId }, data: { coordinatorSummary: input.coordinatorSummary, status: "active" } })
}

export async function proposeProjectGoal(input: { workspaceId: string; projectId: string; title: string; statement: string; priority?: number; successCriteria?: unknown; dependencies?: unknown }) {
  return prisma.projectGoal.create({
    data: {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      title: input.title,
      statement: input.statement,
      status: "proposed",
      priority: input.priority ?? 0,
      successCriteria: jsonArray(input.successCriteria),
      dependencies: jsonArray(input.dependencies)
    }
  })
}

export async function approveProjectGoal(input: { workspaceId: string; goalId: string; userId?: string }) {
  return prisma.projectGoal.update({
    where: { id: input.goalId, workspaceId: input.workspaceId },
    data: { status: "approved", approvedAt: new Date(), approvedByUserId: input.userId }
  })
}

export async function updateProjectGoal(input: { workspaceId: string; goalId: string; patch: Record<string, unknown>; userId?: string }) {
  const data: Prisma.ProjectGoalUpdateInput = {}
  if (typeof input.patch.title === "string") data.title = input.patch.title
  if (typeof input.patch.statement === "string") data.statement = input.patch.statement
  if (typeof input.patch.status === "string") data.status = input.patch.status as any
  if (typeof input.patch.priority === "number") data.priority = input.patch.priority
  if (input.patch.successCriteria !== undefined) data.successCriteria = jsonArray(input.patch.successCriteria)
  if (input.patch.dependencies !== undefined) data.dependencies = jsonArray(input.patch.dependencies)
  if (input.patch.status === "approved") {
    data.approvedAt = new Date()
    data.approvedBy = input.userId ? { connect: { id: input.userId } } : undefined
  }
  return prisma.projectGoal.update({ where: { id: input.goalId, workspaceId: input.workspaceId }, data })
}

export async function listProjectGoals(workspaceId: string, projectId: string) {
  return prisma.projectGoal.findMany({ where: { workspaceId, projectId }, orderBy: [{ priority: "desc" }, { createdAt: "asc" }] })
}

async function requireRunnableGoal(workspaceId: string, goalId: string | undefined, kind: WorkstreamKind) {
  if (kind === "project_coordination" || kind === "triage") return
  if (!goalId) throw new Error("Specialist workstreams require an explicit approved goal.")
  const goal = await prisma.projectGoal.findFirstOrThrow({ where: { workspaceId, id: goalId } })
  if (!["approved", "active"].includes(goal.status)) throw new Error("Workstream goal must be approved or active before specialist work can start.")
}

export async function createWorkstream(input: {
  workspaceId: string
  projectId: string
  goalId?: string
  parentWorkstreamId?: string
  title: string
  kind: WorkstreamKind
  coordinatorRole?: AgentRole
  priority?: number
  targetObjectType?: string
  targetObjectId?: string
  instructions: string
  allowedWrites?: unknown
  forbiddenActions?: unknown
  successCriteria?: unknown
  reviewPolicy?: unknown
}) {
  await requireRunnableGoal(input.workspaceId, input.goalId, input.kind)
  const role = input.coordinatorRole ?? roleByKind[input.kind]
  return prisma.workstream.create({
    data: {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      goalId: input.goalId,
      parentWorkstreamId: input.parentWorkstreamId,
      title: input.title,
      kind: input.kind,
      coordinatorRole: role,
      status: "ready",
      priority: input.priority ?? 0,
      targetObjectType: input.targetObjectType,
      targetObjectId: input.targetObjectId,
      instructions: input.instructions,
      allowedWrites: input.allowedWrites !== undefined ? jsonArray(input.allowedWrites) : allowedWritesByRole[role],
      forbiddenActions: input.forbiddenActions !== undefined ? jsonArray(input.forbiddenActions) : forbiddenActions(role),
      successCriteria: input.successCriteria !== undefined ? jsonArray(input.successCriteria) : ["Submit a report with linked artifacts and uncertainties.", "Pass required review rounds."],
      reviewPolicy: input.reviewPolicy !== undefined ? jsonObject(input.reviewPolicy) : { min_approved_rounds: 1, reviewer_role: "HostileReviewer" }
    }
  })
}

export async function listWorkstreams(input: { workspaceId: string; projectId?: string; status?: string }) {
  return prisma.workstream.findMany({
    where: { workspaceId: input.workspaceId, projectId: input.projectId, status: input.status as any },
    orderBy: [{ status: "asc" }, { priority: "desc" }, { updatedAt: "desc" }]
  })
}

export async function getWorkstream(workspaceId: string, workstreamId: string) {
  return prisma.workstream.findFirstOrThrow({
    where: { workspaceId, id: workstreamId },
    include: { project: true, goal: true, reports: { orderBy: { updatedAt: "desc" }, take: 5 }, reviews: { orderBy: { createdAt: "desc" }, take: 5 }, agentRuns: { orderBy: { startedAt: "desc" }, take: 10 }, messages: { orderBy: { createdAt: "desc" }, take: 20 }, artifacts: { orderBy: { createdAt: "desc" }, take: 20 } }
  })
}

async function targetObjects(workstream: { targetObjectType: string | null; targetObjectId: string | null; workspaceId: string; projectId: string }) {
  if (!workstream.targetObjectType || !workstream.targetObjectId) return []
  const type = workstream.targetObjectType
  const id = workstream.targetObjectId
  if (type === "Claim") return prisma.claim.findMany({ where: { workspaceId: workstream.workspaceId, id } })
  if (type === "ProofRoute") return prisma.proofRoute.findMany({ where: { workspaceId: workstream.workspaceId, id } })
  if (type === "Gap") return prisma.gap.findMany({ where: { workspaceId: workstream.workspaceId, id } })
  return [{ type, id }]
}

export async function getAgentBriefing(workspaceId: string, workstreamId: string) {
  const workstream = await prisma.workstream.findFirstOrThrow({ where: { workspaceId, id: workstreamId }, include: { project: true, goal: true, parent: true } })
  const role = workstream.coordinatorRole
  const [recipe, targets, relevantReports, openGaps, relatedKnownResults] = await Promise.all([
    roleRecipe(role),
    targetObjects(workstream),
    prisma.workstreamReport.findMany({ where: { workspaceId, projectId: workstream.projectId, status: { in: ["submitted", "reviewed_approved"] } }, orderBy: { updatedAt: "desc" }, take: 8 }),
    prisma.gap.findMany({ where: { workspaceId, projectId: workstream.projectId, status: { in: ["open", "assigned"] } }, orderBy: [{ severity: "desc" }, { updatedAt: "desc" }], take: 12 }),
    prisma.knownResult.findMany({ where: { workspaceId, projectId: workstream.projectId }, orderBy: { updatedAt: "desc" }, take: 8 })
  ])
  return {
    role,
    role_recipe: recipe,
    project: workstream.project,
    goal: workstream.goal,
    workstream,
    parent_context: workstream.parent,
    target_objects: targets,
    relevant_reports: relevantReports,
    open_gaps: openGaps,
    related_known_results: relatedKnownResults,
    allowed_writes: normalizeLines(workstream.allowedWrites),
    forbidden_actions: normalizeLines(workstream.forbiddenActions),
    success_criteria: normalizeLines(workstream.successCriteria),
    output_contract: outputContract(role),
    completion_options: ["submit_workstream_report", "mark_workstream_blocked", "escalate_workstream"]
  }
}

export async function claimAgentAssignment(input: { workspaceId: string; projectId?: string; workstreamId?: string; sessionId: string; userId?: string; leaseMinutes?: number }) {
  const leaseExpiresAt = new Date(Date.now() + (input.leaseMinutes ?? 120) * 60_000)
  const workstream = input.workstreamId
    ? await prisma.workstream.findFirstOrThrow({ where: { workspaceId: input.workspaceId, id: input.workstreamId } })
    : await prisma.workstream.findFirstOrThrow({
      where: { workspaceId: input.workspaceId, projectId: input.projectId, status: { in: ["ready", "planned", "revision_required"] } },
      orderBy: [{ priority: "desc" }, { updatedAt: "asc" }]
    })
  const claimed = await prisma.workstream.update({
    where: { id: workstream.id, workspaceId: input.workspaceId },
    data: { status: "claimed", claimedSessionId: input.sessionId, assignedToUserId: input.userId, leaseExpiresAt }
  })
  return { assignment: claimed, briefing: await getAgentBriefing(input.workspaceId, claimed.id) }
}

export async function startAgentRun(input: { workspaceId: string; workstreamId: string; sessionId: string; model?: string }) {
  const briefing = await getAgentBriefing(input.workspaceId, input.workstreamId)
  const run = await prisma.agentRun.create({
    data: {
      workspaceId: input.workspaceId,
      projectId: briefing.workstream.projectId,
      workstreamId: input.workstreamId,
      role: briefing.role,
      status: "running",
      model: input.model,
      sessionId: input.sessionId,
      inputBriefing: briefing as Prisma.InputJsonValue,
      toolCalls: [],
      createdObjectRefs: [],
      updatedObjectRefs: []
    }
  })
  await prisma.workstream.update({ where: { id: input.workstreamId, workspaceId: input.workspaceId }, data: { status: "running", claimedSessionId: input.sessionId } })
  return { agentRun: run, briefing }
}

export async function writeAgentObservation(input: { workspaceId: string; projectId: string; workstreamId?: string; fromRole: AgentRole; toRole?: AgentRole; kind?: string; body: string; artifactRefs?: unknown }) {
  return prisma.agentMessage.create({
    data: {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      workstreamId: input.workstreamId,
      fromRole: input.fromRole,
      toRole: input.toRole ?? "ProjectCoordinator",
      kind: input.kind as any ?? "update",
      body: input.body,
      artifactRefs: jsonArray(input.artifactRefs)
    }
  })
}

export async function createOrUpdateWorkstreamReport(input: { workspaceId: string; workstreamId: string; title: string; bodyMarkdown: string; uncertaintyNotes?: unknown; linkedObjectRefs?: unknown; artifactRefs?: unknown }) {
  const workstream = await prisma.workstream.findFirstOrThrow({ where: { workspaceId: input.workspaceId, id: input.workstreamId } })
  const existingId = workstream.reportId
  const data = {
    workspaceId: input.workspaceId,
    projectId: workstream.projectId,
    workstreamId: input.workstreamId,
    title: input.title,
    bodyMarkdown: input.bodyMarkdown,
    uncertaintyNotes: jsonArray(input.uncertaintyNotes),
    linkedObjectRefs: jsonArray(input.linkedObjectRefs),
    artifactRefs: jsonArray(input.artifactRefs)
  }
  const report = existingId
    ? await prisma.workstreamReport.update({ where: { id: existingId, workspaceId: input.workspaceId }, data })
    : await prisma.workstreamReport.create({ data })
  await prisma.workstream.update({ where: { id: input.workstreamId, workspaceId: input.workspaceId }, data: { reportId: report.id } })
  return report
}

export async function submitReportForReview(input: { workspaceId: string; reportId?: string; workstreamId?: string }) {
  const report = input.reportId
    ? await prisma.workstreamReport.findFirstOrThrow({ where: { workspaceId: input.workspaceId, id: input.reportId } })
    : await prisma.workstreamReport.findFirstOrThrow({ where: { workspaceId: input.workspaceId, workstreamId: input.workstreamId }, orderBy: { updatedAt: "desc" } })
  const submitted = await prisma.workstreamReport.update({ where: { id: report.id, workspaceId: input.workspaceId }, data: { status: "submitted", submittedAt: new Date() } })
  await prisma.workstream.update({ where: { id: submitted.workstreamId, workspaceId: input.workspaceId }, data: { status: "needs_review", reportId: submitted.id } })
  return submitted
}

export async function submitWorkstreamReport(input: Parameters<typeof createOrUpdateWorkstreamReport>[0]) {
  const report = await createOrUpdateWorkstreamReport(input)
  return submitReportForReview({ workspaceId: input.workspaceId, reportId: report.id })
}

export async function recordReviewRound(input: {
  workspaceId: string
  workstreamId: string
  reportId?: string
  targetObjectType?: string
  targetObjectId?: string
  reviewerRole?: AgentRole
  verdict: string
  issues?: unknown
  requiredChanges?: unknown
  checkedRefs?: unknown
  bodyMarkdown: string
  createdByAgentRunId?: string
}) {
  const workstream = await prisma.workstream.findFirstOrThrow({ where: { workspaceId: input.workspaceId, id: input.workstreamId } })
  if (input.createdByAgentRunId) {
    const run = await prisma.agentRun.findFirstOrThrow({ where: { workspaceId: input.workspaceId, id: input.createdByAgentRunId } })
    if (run.workstreamId === input.workstreamId && run.role === workstream.coordinatorRole) throw new Error("Reviewer cannot review or edit the same workstream output in the same ReviewRound.")
  }
  if (input.verdict === "approved" && workstream.kind === "computation") {
    const report = input.reportId ? await prisma.workstreamReport.findFirst({ where: { workspaceId: input.workspaceId, id: input.reportId } }) : null
    const artifactRefs = normalizeLines(report?.artifactRefs)
    const artifactCount = await prisma.artifact.count({ where: { workspaceId: input.workspaceId, workstreamId: input.workstreamId } })
    if (!artifactRefs.length && artifactCount === 0) throw new Error("Computational workstreams require recorded verification artifacts before approval.")
  }
  const review = await prisma.reviewRound.create({
    data: {
      workspaceId: input.workspaceId,
      projectId: workstream.projectId,
      workstreamId: input.workstreamId,
      reportId: input.reportId ?? workstream.reportId,
      targetObjectType: input.targetObjectType ?? "WorkstreamReport",
      targetObjectId: input.targetObjectId ?? input.reportId ?? workstream.reportId ?? input.workstreamId,
      reviewerRole: input.reviewerRole ?? "HostileReviewer",
      verdict: input.verdict as any,
      issues: jsonArray(input.issues),
      requiredChanges: jsonArray(input.requiredChanges),
      checkedRefs: jsonArray(input.checkedRefs),
      bodyMarkdown: input.bodyMarkdown,
      createdByAgentRunId: input.createdByAgentRunId
    }
  })
  const workstreamStatus = input.verdict === "approved" ? "approved" : input.verdict === "needs_revision" || input.verdict === "rejected" ? "revision_required" : input.verdict === "escalate" ? "escalated" : "blocked"
  const reportStatus = input.verdict === "approved" ? "reviewed_approved" : "reviewed_needs_revision"
  await prisma.workstream.update({ where: { id: input.workstreamId, workspaceId: input.workspaceId }, data: { status: workstreamStatus as any } })
  if (review.reportId) await prisma.workstreamReport.update({ where: { id: review.reportId, workspaceId: input.workspaceId }, data: { status: reportStatus } })
  return review
}

export async function completeWorkstream(input: { workspaceId: string; workstreamId: string }) {
  const workstream = await prisma.workstream.findFirstOrThrow({ where: { workspaceId: input.workspaceId, id: input.workstreamId } })
  const policy = workstream.reviewPolicy as Record<string, unknown>
  const minApprovals = typeof policy.min_approved_rounds === "number" ? policy.min_approved_rounds : 1
  const approvedReviews = await prisma.reviewRound.count({ where: { workspaceId: input.workspaceId, workstreamId: input.workstreamId, verdict: "approved" } })
  if (approvedReviews < minApprovals) throw new Error(`Workstream cannot complete until ${minApprovals} approved ReviewRound(s) exist.`)
  return prisma.workstream.update({ where: { id: input.workstreamId, workspaceId: input.workspaceId }, data: { status: "completed", completedAt: new Date() } })
}

export async function markWorkstreamBlocked(input: { workspaceId: string; workstreamId: string; message: string }) {
  return prisma.workstream.update({ where: { id: input.workstreamId, workspaceId: input.workspaceId }, data: { status: "blocked", escalationMessage: input.message } })
}

export async function escalateWorkstream(input: { workspaceId: string; workstreamId: string; message: string }) {
  return prisma.workstream.update({ where: { id: input.workstreamId, workspaceId: input.workspaceId }, data: { status: "escalated", escalationMessage: input.message } })
}

export async function requestWorkstreamRevision(input: { workspaceId: string; workstreamId: string; message: string }) {
  await prisma.agentMessage.create({
    data: {
      workspaceId: input.workspaceId,
      projectId: (await prisma.workstream.findFirstOrThrow({ where: { workspaceId: input.workspaceId, id: input.workstreamId } })).projectId,
      workstreamId: input.workstreamId,
      fromRole: "HostileReviewer",
      toRole: "WorkstreamCoordinator",
      kind: "review_request",
      body: input.message,
      artifactRefs: []
    }
  })
  return prisma.workstream.update({ where: { id: input.workstreamId, workspaceId: input.workspaceId }, data: { status: "revision_required" } })
}

export async function approveWorkstream(input: { workspaceId: string; workstreamId: string }) {
  const approvals = await prisma.reviewRound.count({ where: { workspaceId: input.workspaceId, workstreamId: input.workstreamId, verdict: "approved" } })
  if (!approvals) throw new Error("Cannot approve Workstream without an approved ReviewRound.")
  return prisma.workstream.update({ where: { id: input.workstreamId, workspaceId: input.workspaceId }, data: { status: "approved" } })
}

export async function createClaim(input: { workspaceId: string; projectId: string; title: string; statementMarkdown: string; kind?: string; status?: string; confidence?: number; metadata?: unknown; actorRole?: AgentRole }) {
  return prisma.claim.create({
    data: {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      title: input.title,
      statementMarkdown: input.statementMarkdown,
      kind: input.kind as any ?? "conjecture",
      status: input.status as any ?? "conjectured",
      confidence: input.confidence,
      metadata: jsonObject(input.metadata)
    }
  })
}

export async function updateClaimStatus(input: { workspaceId: string; claimId: string; status: ClaimStatus; actorRole?: AgentRole; reason?: string }) {
  if (input.actorRole === "ProofAttemptAgent" && ["informal_proof_candidate", "reviewed_informal_proof", "formalization_target", "lean_checked", "lean_verified"].includes(input.status)) {
    throw new Error("ProofAttemptAgent cannot mark a Claim as proved or verified.")
  }
  return prisma.claim.update({ where: { id: input.claimId, workspaceId: input.workspaceId }, data: { status: input.status, metadata: input.reason ? { status_reason: input.reason } : undefined } })
}

export async function createProofRoute(input: { workspaceId: string; projectId: string; claimId: string; title: string; strategyMarkdown: string; requiredLemmas?: unknown; firstTestableStep: string; killCondition: string; status?: string; createdByWorkstreamId?: string }) {
  const route = await prisma.proofRoute.create({
    data: {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      claimId: input.claimId,
      title: input.title,
      strategyMarkdown: input.strategyMarkdown,
      requiredLemmas: jsonArray(input.requiredLemmas),
      firstTestableStep: input.firstTestableStep,
      killCondition: input.killCondition,
      status: input.status as any ?? "proposed",
      createdByWorkstreamId: input.createdByWorkstreamId
    }
  })
  await prisma.claim.update({ where: { id: input.claimId, workspaceId: input.workspaceId }, data: { status: "has_routes" } })
  return route
}

export async function createProofAttempt(input: { workspaceId: string; projectId: string; claimId: string; routeId?: string; workstreamId?: string; bodyMarkdown: string; status?: string; gapSummary?: string }) {
  return prisma.proofAttempt.create({
    data: {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      claimId: input.claimId,
      routeId: input.routeId,
      workstreamId: input.workstreamId,
      bodyMarkdown: input.bodyMarkdown,
      status: input.status as any ?? "draft",
      gapSummary: input.gapSummary
    }
  })
}

export async function createGap(input: { workspaceId: string; projectId: string; claimId?: string; proofAttemptId?: string; routeId?: string; title: string; descriptionMarkdown: string; severity?: string; status?: string; suggestedResolution?: string }) {
  return prisma.gap.create({
    data: {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      claimId: input.claimId,
      proofAttemptId: input.proofAttemptId,
      routeId: input.routeId,
      title: input.title,
      descriptionMarkdown: input.descriptionMarkdown,
      severity: input.severity as any ?? "unknown",
      status: input.status as any ?? "open",
      suggestedResolution: input.suggestedResolution
    }
  })
}

export async function resolveGap(input: { workspaceId: string; gapId: string; suggestedResolution?: string }) {
  return prisma.gap.update({ where: { id: input.gapId, workspaceId: input.workspaceId }, data: { status: "resolved", suggestedResolution: input.suggestedResolution } })
}

export async function createCounterexample(input: { workspaceId: string; projectId: string; claimId: string; title: string; constructionMarkdown: string; status?: string; verificationArtifactId?: string }) {
  return prisma.counterexample.create({ data: { workspaceId: input.workspaceId, projectId: input.projectId, claimId: input.claimId, title: input.title, constructionMarkdown: input.constructionMarkdown, status: input.status as any ?? "candidate", verificationArtifactId: input.verificationArtifactId } })
}

export async function createMathObject(input: { workspaceId: string; projectId: string; type: string; title: string; statementMarkdown: string; status?: string; metadata?: unknown }) {
  return prisma.mathObject.create({ data: { workspaceId: input.workspaceId, projectId: input.projectId, type: input.type as any, title: input.title, statementMarkdown: input.statementMarkdown, status: input.status ?? "draft", metadata: jsonObject(input.metadata) } })
}

export async function createExperiment(input: { workspaceId: string; projectId: string; workstreamId?: string; title: string; hypothesisMarkdown: string; methodMarkdown: string; resultMarkdown?: string; reproducibility?: unknown; status?: string }) {
  return prisma.experiment.create({ data: { workspaceId: input.workspaceId, projectId: input.projectId, workstreamId: input.workstreamId, title: input.title, hypothesisMarkdown: input.hypothesisMarkdown, methodMarkdown: input.methodMarkdown, resultMarkdown: input.resultMarkdown ?? "", reproducibility: jsonObject(input.reproducibility), status: input.status as any ?? "planned" } })
}

export async function createPaper(input: { workspaceId: string; projectId?: string; title: string; authors?: unknown; year?: number; venue?: string; url?: string; arxivId?: string; doi?: string; notesMarkdown?: string }) {
  return prisma.paper.create({ data: { workspaceId: input.workspaceId, projectId: input.projectId, title: input.title, authors: jsonArray(input.authors), year: input.year, venue: input.venue, url: input.url, arxivId: input.arxivId, doi: input.doi, notesMarkdown: input.notesMarkdown ?? "" } })
}

export async function createKnownResult(input: { workspaceId: string; projectId?: string; paperId?: string; title: string; statementMarkdown: string; applicabilityMarkdown: string; status?: string }) {
  return prisma.knownResult.create({ data: { workspaceId: input.workspaceId, projectId: input.projectId, paperId: input.paperId, title: input.title, statementMarkdown: input.statementMarkdown, applicabilityMarkdown: input.applicabilityMarkdown, status: input.status as any ?? "suspected" } })
}

export async function createAssumption(input: { workspaceId: string; projectId: string; statementMarkdown: string; status: string; reason: string; owner?: string; dischargePlan?: string }) {
  return prisma.assumption.create({ data: { workspaceId: input.workspaceId, projectId: input.projectId, statementMarkdown: input.statementMarkdown, status: input.status as any, reason: input.reason, owner: input.owner, dischargePlan: input.dischargePlan } })
}

export async function createFormalizationTarget(input: { workspaceId: string; projectId: string; claimId?: string; proofAttemptId?: string; statementMarkdown: string; theoremStub?: string; requiredDefinitions?: unknown; feasibility: string; status?: string }) {
  return prisma.formalizationTarget.create({ data: { workspaceId: input.workspaceId, projectId: input.projectId, claimId: input.claimId, proofAttemptId: input.proofAttemptId, statementMarkdown: input.statementMarkdown, theoremStub: input.theoremStub, requiredDefinitions: jsonArray(input.requiredDefinitions), feasibility: input.feasibility, status: input.status as any ?? "proposed" } })
}

export async function createLeanTheorem(input: { workspaceId: string; projectId: string; formalizationTargetId?: string; leanName: string; proofFile: string; statementMarkdown: string; status?: string; hasSorry?: boolean; hasAxiom?: boolean }) {
  return prisma.leanTheorem.create({ data: { workspaceId: input.workspaceId, projectId: input.projectId, formalizationTargetId: input.formalizationTargetId, leanName: input.leanName, proofFile: input.proofFile, statementMarkdown: input.statementMarkdown, status: input.status as any ?? "draft", hasSorry: input.hasSorry ?? false, hasAxiom: input.hasAxiom ?? false } })
}

export async function runLeanTheoremCheck(input: { workspaceId: string; leanTheoremId: string; userId?: string }) {
  const theorem = await prisma.leanTheorem.findFirstOrThrow({ where: { workspaceId: input.workspaceId, id: input.leanTheoremId } })
  const startedAt = new Date()
  const result = await leanClient.check({ workspaceSlug: await workspaceSlug(input.workspaceId), filePath: theorem.proofFile })
  const job = await prisma.job.create({
    data: {
      workspaceId: input.workspaceId,
      type: "lean_check",
      status: result.success ? "succeeded" : "failed",
      input: { leanTheoremId: theorem.id, proofFile: theorem.proofFile, leanName: theorem.leanName },
      output: result,
      createdByUserId: input.userId ?? await fallbackJobUserId(input.workspaceId),
      startedAt,
      finishedAt: new Date()
    }
  })
  const output = result as Record<string, unknown>
  const hasSorry = output.hasSorry === true
  const hasAxiom = output.hasAxiom === true
  const activeAssumptions = await prisma.assumption.count({ where: { workspaceId: input.workspaceId, projectId: theorem.projectId, status: { in: ["temporary_axiom", "unproved_dependency"] } } })
  const status = !result.success ? "failed" : hasSorry || hasAxiom || activeAssumptions > 0 ? "lean_checked" : "lean_checked"
  const leanTheorem = await prisma.leanTheorem.update({
    where: { id: theorem.id, workspaceId: input.workspaceId },
    data: { latestCheckJobId: job.id, status, hasSorry, hasAxiom }
  })
  return { result, job, leanTheorem, verificationGate: { hasSorry, hasAxiom, activeTemporaryOrUnprovedAssumptions: activeAssumptions } }
}

export async function markLeanVerified(input: { workspaceId: string; leanTheoremId: string }) {
  const theorem = await prisma.leanTheorem.findFirstOrThrow({ where: { workspaceId: input.workspaceId, id: input.leanTheoremId } })
  const latest = theorem.latestCheckJobId
    ? await prisma.job.findFirst({ where: { workspaceId: input.workspaceId, id: theorem.latestCheckJobId } })
    : await prisma.job.findFirst({ where: { workspaceId: input.workspaceId, type: "lean_check", input: { path: ["leanTheoremId"], equals: theorem.id } }, orderBy: { finishedAt: "desc" } })
  const output = latest?.output as Record<string, unknown> | null
  const hasSorry = theorem.hasSorry || output?.hasSorry === true
  const hasAxiom = theorem.hasAxiom || output?.hasAxiom === true
  const activeAssumptions = await prisma.assumption.count({ where: { workspaceId: input.workspaceId, projectId: theorem.projectId, status: { in: ["temporary_axiom", "unproved_dependency"] } } })
  if (!latest || latest.status !== "succeeded" || output?.success !== true || hasSorry || hasAxiom || activeAssumptions > 0) {
    return prisma.leanTheorem.update({ where: { id: theorem.id, workspaceId: input.workspaceId }, data: { status: "lean_checked", hasSorry, hasAxiom } })
  }
  return prisma.leanTheorem.update({ where: { id: theorem.id, workspaceId: input.workspaceId }, data: { status: "lean_verified", hasSorry: false, hasAxiom: false } })
}

export async function linkObjects(input: { workspaceId: string; projectId?: string; sourceType: string; sourceId: string; targetType: string; targetId: string; edgeType: string; metadata?: unknown }) {
  return prisma.graphEdge.create({ data: { workspaceId: input.workspaceId, projectId: input.projectId, sourceType: input.sourceType, sourceId: input.sourceId, targetType: input.targetType, targetId: input.targetId, edgeType: input.edgeType as any, metadata: jsonObject(input.metadata) } })
}

export async function getObjectGraph(input: { workspaceId: string; projectId?: string; sourceType?: string; sourceId?: string }) {
  const edges = await prisma.graphEdge.findMany({ where: { workspaceId: input.workspaceId, projectId: input.projectId, sourceType: input.sourceType, sourceId: input.sourceId }, orderBy: { createdAt: "asc" }, take: 200 })
  const [claims, routes, gaps, objects, papers, knownResults, formalizationTargets, leanTheorems] = await Promise.all([
    prisma.claim.findMany({ where: { workspaceId: input.workspaceId, projectId: input.projectId }, take: 100 }),
    prisma.proofRoute.findMany({ where: { workspaceId: input.workspaceId, projectId: input.projectId }, take: 100 }),
    prisma.gap.findMany({ where: { workspaceId: input.workspaceId, projectId: input.projectId }, take: 100 }),
    prisma.mathObject.findMany({ where: { workspaceId: input.workspaceId, projectId: input.projectId }, take: 100 }),
    prisma.paper.findMany({ where: { workspaceId: input.workspaceId, projectId: input.projectId }, take: 100 }),
    prisma.knownResult.findMany({ where: { workspaceId: input.workspaceId, projectId: input.projectId }, take: 100 }),
    prisma.formalizationTarget.findMany({ where: { workspaceId: input.workspaceId, projectId: input.projectId }, take: 100 }),
    prisma.leanTheorem.findMany({ where: { workspaceId: input.workspaceId, projectId: input.projectId }, take: 100 })
  ])
  return {
    nodes: [
      ...claims.map((n) => ({ ...n, type: "Claim" })),
      ...routes.map((n) => ({ ...n, type: "ProofRoute" })),
      ...gaps.map((n) => ({ ...n, type: "Gap" })),
      ...objects.map((n) => ({ ...n, type: "MathObject" })),
      ...papers.map((n) => ({ ...n, type: "Paper", status: "cited" })),
      ...knownResults.map((n) => ({ ...n, type: "KnownResult" })),
      ...formalizationTargets.map((n) => ({ ...n, type: "FormalizationTarget" })),
      ...leanTheorems.map((n) => ({ ...n, type: "LeanTheorem" }))
    ],
    edges
  }
}

export async function searchResearchObjects(input: { workspaceId: string; projectId?: string; query?: string; type?: string }) {
  const contains = input.query ? { contains: input.query, mode: "insensitive" as const } : undefined
  const [claims, routes, gaps, papers, knownResults] = await Promise.all([
    !input.type || input.type === "Claim" ? prisma.claim.findMany({ where: { workspaceId: input.workspaceId, projectId: input.projectId, OR: contains ? [{ title: contains }, { statementMarkdown: contains }] : undefined }, take: 25 }) : [],
    !input.type || input.type === "ProofRoute" ? prisma.proofRoute.findMany({ where: { workspaceId: input.workspaceId, projectId: input.projectId, OR: contains ? [{ title: contains }, { strategyMarkdown: contains }] : undefined }, take: 25 }) : [],
    !input.type || input.type === "Gap" ? prisma.gap.findMany({ where: { workspaceId: input.workspaceId, projectId: input.projectId, OR: contains ? [{ title: contains }, { descriptionMarkdown: contains }] : undefined }, take: 25 }) : [],
    !input.type || input.type === "Paper" ? prisma.paper.findMany({ where: { workspaceId: input.workspaceId, projectId: input.projectId, title: contains }, take: 25 }) : [],
    !input.type || input.type === "KnownResult" ? prisma.knownResult.findMany({ where: { workspaceId: input.workspaceId, projectId: input.projectId, OR: contains ? [{ title: contains }, { statementMarkdown: contains }] : undefined }, take: 25 }) : []
  ])
  return { claims, routes, gaps, papers, knownResults }
}

export async function createArtifact(input: { workspaceId: string; projectId: string; workstreamId?: string; kind?: string; title: string; uri?: string; path?: string; contentHash?: string; metadata?: unknown; createdByAgentRunId?: string }) {
  return prisma.artifact.create({ data: { workspaceId: input.workspaceId, projectId: input.projectId, workstreamId: input.workstreamId, kind: input.kind as any ?? "other", title: input.title, uri: input.uri, path: input.path, contentHash: input.contentHash, metadata: jsonObject(input.metadata), createdByAgentRunId: input.createdByAgentRunId } })
}

export async function getReport(workspaceId: string, reportId: string) {
  return prisma.workstreamReport.findFirstOrThrow({ where: { workspaceId, id: reportId }, include: { workstream: true, reviews: { orderBy: { createdAt: "desc" } } } })
}

export async function listReviewRounds(workspaceId: string, workstreamId: string) {
  return prisma.reviewRound.findMany({ where: { workspaceId, workstreamId }, orderBy: { createdAt: "desc" } })
}

export async function getProjectControlRoom(workspaceId: string, projectId: string) {
  const [project, goals, workstreams, needsReview, blocked, recentAgentRuns, keyClaims, openGaps, reviews] = await Promise.all([
    prisma.project.findFirstOrThrow({ where: { workspaceId, id: projectId } }),
    prisma.projectGoal.findMany({ where: { workspaceId, projectId }, orderBy: [{ priority: "desc" }, { updatedAt: "desc" }] }),
    prisma.workstream.findMany({ where: { workspaceId, projectId }, orderBy: [{ status: "asc" }, { priority: "desc" }, { updatedAt: "desc" }], take: 50 }),
    prisma.workstream.findMany({ where: { workspaceId, projectId, status: "needs_review" }, orderBy: { updatedAt: "desc" }, take: 20 }),
    prisma.workstream.findMany({ where: { workspaceId, projectId, status: { in: ["blocked", "escalated", "revision_required"] } }, orderBy: { updatedAt: "desc" }, take: 20 }),
    prisma.agentRun.findMany({ where: { workspaceId, projectId }, orderBy: { startedAt: "desc" }, take: 12 }),
    prisma.claim.findMany({ where: { workspaceId, projectId, status: { not: "archived" } }, orderBy: { updatedAt: "desc" }, take: 12 }),
    prisma.gap.findMany({ where: { workspaceId, projectId, status: { in: ["open", "assigned"] } }, orderBy: { updatedAt: "desc" }, take: 12 }),
    prisma.reviewRound.findMany({ where: { workspaceId, projectId }, orderBy: { createdAt: "desc" }, take: 12 })
  ])
  const suggested = workstreams.find((w) => ["ready", "planned", "revision_required"].includes(w.status)) ?? null
  const groupedGoals = goals.reduce<Record<string, typeof goals>>((acc, goal) => {
    ;(acc[goal.status] ??= []).push(goal)
    return acc
  }, {})
  const groupedWorkstreams = workstreams.reduce<Record<string, typeof workstreams>>((acc, workstream) => {
    ;(acc[workstream.status] ??= []).push(workstream)
    return acc
  }, {})
  return { project, goals_by_status: groupedGoals, workstreams_by_status: groupedWorkstreams, needs_review: needsReview, blocked_or_escalated: blocked, recent_agent_runs: recentAgentRuns, key_claims: keyClaims, open_gaps: openGaps, recent_reviews: reviews, suggested_next_assignment: suggested }
}
