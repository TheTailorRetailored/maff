import fs from "node:fs/promises"
import path from "node:path"
import { randomUUID, createHash } from "node:crypto"
import type { AgentRole, ClaimStatus, Prisma, ReviewVerdict, WorkstreamKind } from "@prisma/client"
import { prisma } from "../db/prisma.js"
import { config } from "../config.js"
import { leanClient } from "../lean/leanClient.js"
import { requireWorkspaceRole } from "../auth/permissions.js"
import { computeSubmissionReadiness, workstreamDependenciesSatisfied } from "./readiness.js"

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

const kindByRole = Object.fromEntries(Object.entries(roleByKind).map(([kind, role]) => [role, kind])) as Partial<Record<AgentRole, WorkstreamKind>>

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

function normalizeLookup(value?: string) {
  return value?.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ")
}

function normalizeEnumToken(value?: string) {
  return value?.trim().replace(/[\s-]+/g, "_")
}

function asAgentRole(value?: string): AgentRole | undefined {
  if (!value) return undefined
  const token = normalizeEnumToken(value)
  const roles = Object.keys(roleRecipeFiles) as AgentRole[]
  return roles.find((role) => role.toLowerCase() === token?.toLowerCase() || role.toLowerCase() === `${token}Agent`.toLowerCase())
}

function asWorkstreamKind(value?: string): WorkstreamKind | undefined {
  if (!value) return undefined
  const token = normalizeEnumToken(value)
  const kinds = Object.keys(roleByKind) as WorkstreamKind[]
  return kinds.find((kind) => kind.toLowerCase() === token?.toLowerCase())
}

const reviewVerdictAliases: Record<string, ReviewVerdict> = {
  approved: "approved",
  approve: "approved",
  accepted: "approved",
  needs_revision: "needs_revision",
  revision_required: "needs_revision",
  requires_revision: "needs_revision",
  needs_changes: "needs_revision",
  changes_requested: "needs_revision",
  rejected: "rejected",
  reject: "rejected",
  blocked: "blocked",
  block: "blocked",
  escalate: "escalate",
  escalated: "escalate"
}

function asReviewVerdict(value?: string): ReviewVerdict {
  const token = normalizeEnumToken(value)?.toLowerCase()
  const verdict = token ? reviewVerdictAliases[token] : undefined
  if (!verdict) {
    throw new Error(`Invalid review verdict: ${value ?? "<empty>"}. Expected one of approved, needs_revision, rejected, blocked, escalate.`)
  }
  return verdict
}

function agentChatPrompt(projectTitle: string, role: AgentRole) {
  return `Use Maff. I am a ${role} for ${projectTitle}. Claim my next assignment and follow the briefing.`
}

function reviewerChatPrompt(projectTitle: string) {
  return `Use Maff. I am a HostileReviewer for ${projectTitle}. Review the next report needing review.`
}

function coordinatorChatPrompt(projectTitle: string) {
  return `Use Maff. Coordinate the ${projectTitle} project and tell me what needs attention next. Include short prompts I can paste into specialist or reviewer chats.`
}

function workstreamWhereForRole(role?: AgentRole, kind?: WorkstreamKind) {
  const inferredKind = kind ?? (role ? kindByRole[role] : undefined)
  return {
    ...(inferredKind ? { kind: inferredKind } : {}),
    ...(role ? { coordinatorRole: role } : {})
  }
}

async function resolveWorkspaceForUser(userId: string, workspaceRef?: string) {
  if (workspaceRef) {
    const workspace = await prisma.workspace.findFirst({
      where: {
        OR: [{ id: workspaceRef }, { slug: workspaceRef }],
        members: { some: { userId } }
      }
    })
    if (!workspace) throw new Error(`No accessible workspace found for ${workspaceRef}.`)
    return workspace
  }

  const workspaces = await prisma.workspace.findMany({
    where: { members: { some: { userId } } },
    orderBy: [{ type: "asc" }, { createdAt: "asc" }]
  })
  const privateWorkspace = workspaces.find((workspace) => workspace.type === "private")
  const workspace = privateWorkspace ?? workspaces[0]
  if (!workspace) throw new Error("No accessible Maff workspace found.")
  return workspace
}

async function resolveProject(workspaceId: string, projectRef?: string) {
  if (!projectRef) return undefined
  const normalized = normalizeLookup(projectRef)
  const projects = await prisma.project.findMany({ where: { workspaceId }, orderBy: { updatedAt: "desc" } })
  const project = projects.find((candidate) => candidate.id === projectRef)
    ?? projects.find((candidate) => candidate.slug === projectRef)
    ?? projects.find((candidate) => normalizeLookup(candidate.title) === normalized)
    ?? projects.find((candidate) => normalizeLookup(candidate.title)?.includes(normalized ?? ""))
  if (!project) {
    const options = projects.map((candidate) => candidate.title).slice(0, 8)
    throw new Error(`No project matched "${projectRef}". Available projects: ${options.join("; ") || "none"}.`)
  }
  return project
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

/** Records only graph-changing work and queues/pauses strategic review at configured thresholds. */
type SubstantiveActionInput = { workspaceId: string; projectId: string; actionType: string; targetType?: string; targetId?: string; meaningfulDelta?: boolean; summary?: string }

async function recordSubstantiveActionInTransaction(tx: Prisma.TransactionClient, input: SubstantiveActionInput) {
    const project = await tx.project.findFirstOrThrow({ where: { workspaceId: input.workspaceId, id: input.projectId } })
    let epoch = await tx.projectEpoch.findFirst({ where: { workspaceId: input.workspaceId, projectId: input.projectId }, orderBy: { number: "desc" } })
    if (!epoch || epoch.strategicReviewCompletedAt) epoch = await tx.projectEpoch.create({ data: { workspaceId: input.workspaceId, projectId: input.projectId, number: (epoch?.number ?? 0) + 1 } })
    epoch = await tx.projectEpoch.update({ where: { id: epoch.id }, data: { substantiveActionCount: { increment: 1 } } })
    const actionCount = epoch.substantiveActionCount
    const queue = !epoch.strategicReviewQueuedAt && actionCount >= project.strategicReviewInterval
    const pause = !epoch.downstreamPausedAt && actionCount >= project.strategicReviewHardLimit && !epoch.strategicReviewCompletedAt
    if (queue || pause) epoch = await tx.projectEpoch.update({ where: { id: epoch.id }, data: { strategicReviewQueuedAt: queue ? new Date() : undefined, downstreamPausedAt: pause ? new Date() : undefined } })
    await tx.projectSubstantiveAction.create({ data: { workspaceId: input.workspaceId, projectEpochId: epoch.id, actionType: input.actionType, targetType: input.targetType, targetId: input.targetId, meaningfulDelta: input.meaningfulDelta ?? false, summary: input.summary } })
    return epoch
}

async function recordSubstantiveAction(input: SubstantiveActionInput) {
  return prisma.$transaction((tx) => recordSubstantiveActionInTransaction(tx, input), { isolationLevel: "Serializable" })
}

async function assertProjectAllowsDownstreamWork(workspaceId: string, projectId: string) {
  const epoch = await prisma.projectEpoch.findFirst({ where: { workspaceId, projectId, downstreamPausedAt: { not: null }, strategicReviewCompletedAt: null }, orderBy: { number: "desc" } })
  if (epoch) throw new Error(`Downstream specialist work is paused: strategic review is overdue for project epoch ${epoch.number}. Record an independent StrategicReviewRound or explicitly rebase the project.`)
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
  dependencyWorkstreamIds?: string[]
}) {
  await requireRunnableGoal(input.workspaceId, input.goalId, input.kind)
  if (!["project_coordination", "triage", "hostile_review"].includes(input.kind)) await assertProjectAllowsDownstreamWork(input.workspaceId, input.projectId)
  const role = input.coordinatorRole ?? roleByKind[input.kind]
  const prerequisites = [...new Set(input.dependencyWorkstreamIds ?? [])].filter(Boolean)
  if (prerequisites.length) {
    const count = await prisma.workstream.count({ where: { workspaceId: input.workspaceId, projectId: input.projectId, id: { in: prerequisites } } })
    if (count !== prerequisites.length) throw new Error("Every workstream dependency must belong to this project and workspace.")
  }
  return prisma.$transaction(async (tx) => {
    const workstream = await tx.workstream.create({
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
    if (prerequisites.length) await tx.workstreamDependency.createMany({ data: prerequisites.map((prerequisiteWorkstreamId) => ({ workspaceId: input.workspaceId, dependentWorkstreamId: workstream.id, prerequisiteWorkstreamId })) })
    return workstream
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
  const dependencyState = await workstreamDependenciesSatisfied(input.workspaceId, workstream.id)
  if (!["project_coordination", "triage", "hostile_review"].includes(workstream.kind)) await assertProjectAllowsDownstreamWork(input.workspaceId, workstream.projectId)
  if (!dependencyState.satisfied) {
    const blocked = dependencyState.dependencies.filter((d) => d.prerequisite.status !== "completed" || !d.prerequisite.reviews.some((r) => r.verdict === "approved")).map((d) => d.prerequisiteWorkstreamId)
    throw new Error(`Workstream is blocked by incomplete prerequisite workstreams: ${blocked.join(", ")}`)
  }
  const claimed = await prisma.workstream.update({
    where: { id: workstream.id, workspaceId: input.workspaceId },
    data: { status: "claimed", claimedSessionId: input.sessionId, assignedToUserId: input.userId, leaseExpiresAt }
  })
  return { assignment: claimed, briefing: await getAgentBriefing(input.workspaceId, claimed.id) }
}

export async function getMyMaffContext(input: { userId: string; workspaceRef?: string; project?: string }) {
  const workspace = await resolveWorkspaceForUser(input.userId, input.workspaceRef)
  const project = await resolveProject(workspace.id, input.project)
  const projects = project ? [project] : await prisma.project.findMany({ where: { workspaceId: workspace.id }, orderBy: { updatedAt: "desc" }, take: 12 })
  const controlRooms = await Promise.all(projects.slice(0, 4).map((item) => getProjectControlRoom(workspace.id, item.id)))
  const nextAssignments = await prisma.workstream.findMany({
    where: {
      workspaceId: workspace.id,
      projectId: project?.id,
      status: { in: ["ready", "planned", "revision_required"] }
    },
    include: { project: true, goal: true },
    orderBy: [{ priority: "desc" }, { updatedAt: "asc" }],
    take: 8
  })
  const reviewQueue = await prisma.workstream.findMany({
    where: { workspaceId: workspace.id, projectId: project?.id, status: "needs_review" },
    include: { project: true, reports: { orderBy: { updatedAt: "desc" }, take: 1 } },
    orderBy: { updatedAt: "asc" },
    take: 8
  })
  const running = await prisma.workstream.findMany({
    where: { workspaceId: workspace.id, projectId: project?.id, status: { in: ["claimed", "running", "blocked", "escalated"] } },
    include: { project: true },
    orderBy: { updatedAt: "desc" },
    take: 8
  })
  return {
    workspace,
    active_project: project ?? null,
    projects,
    control_rooms: controlRooms,
    next_assignments: nextAssignments,
    review_queue: reviewQueue,
    attention: {
      needs_review: reviewQueue.length,
      ready_or_revision_assignments: nextAssignments.length,
      running_or_blocked: running
    },
    suggested_chat_prompts: {
      coordinator: project ? coordinatorChatPrompt(project.title) : "Use Maff. Show me my active projects, what needs attention next, and short prompts I can paste into project coordinator, specialist, or reviewer chats.",
      specialist: nextAssignments[0] ? agentChatPrompt(nextAssignments[0].project.title, nextAssignments[0].coordinatorRole) : null,
      reviewer: reviewQueue[0] ? reviewerChatPrompt(reviewQueue[0].project.title) : null
    }
  }
}

export async function claimNextAssignment(input: {
  userId: string
  workspaceRef?: string
  project?: string
  role?: string
  kind?: string
  sessionId?: string
  model?: string
  leaseMinutes?: number
  startRun?: boolean
}) {
  const workspace = await resolveWorkspaceForUser(input.userId, input.workspaceRef)
  await requireWorkspaceRole(input.userId, workspace.id, "editor")
  const sessionId = input.sessionId ?? `maff-${randomUUID()}`
  const role = asAgentRole(input.role)
  const kind = asWorkstreamKind(input.kind)
  const project = await resolveProject(workspace.id, input.project)
  const filters = workstreamWhereForRole(role, kind)
  const workstream = await prisma.workstream.findFirst({
    where: {
      workspaceId: workspace.id,
      projectId: project?.id,
      status: { in: ["ready", "planned", "revision_required"] },
      ...filters
    },
    include: { project: true, goal: true },
    orderBy: [{ priority: "desc" }, { updatedAt: "asc" }]
  })
  if (!workstream) {
    const available = await prisma.workstream.findMany({
      where: { workspaceId: workspace.id, projectId: project?.id, status: { in: ["ready", "planned", "revision_required", "needs_review", "blocked", "escalated"] } },
      include: { project: true },
      orderBy: [{ status: "asc" }, { priority: "desc" }, { updatedAt: "asc" }],
      take: 10
    })
    return {
      workspace,
      project: project ?? null,
      assignment: null,
      briefing: null,
      message: "No ready assignment matched that project/role/kind.",
      available_workstreams: available
    }
  }
  const claimed = await claimAgentAssignment({ workspaceId: workspace.id, projectId: project?.id, workstreamId: workstream.id, sessionId, userId: input.userId, leaseMinutes: input.leaseMinutes })
  const agentRun = input.startRun === false ? null : await startAgentRun({ workspaceId: workspace.id, workstreamId: claimed.assignment.id, sessionId, model: input.model })
  return {
    workspace,
    project: workstream.project,
    assignment: claimed.assignment,
    briefing: agentRun?.briefing ?? claimed.briefing,
    agent_run: agentRun?.agentRun ?? null,
    session_id: sessionId,
    prompt_to_agent: "Follow the returned briefing. Create only allowed objects. Submit a WorkstreamReport for review. Do not complete the workstream or mark claims proved."
  }
}

export async function claimNextReview(input: { userId: string; workspaceRef?: string; project?: string; sessionId?: string; model?: string; leaseMinutes?: number; startRun?: boolean }) {
  const workspace = await resolveWorkspaceForUser(input.userId, input.workspaceRef)
  await requireWorkspaceRole(input.userId, workspace.id, "editor")
  const sessionId = input.sessionId ?? `maff-${randomUUID()}`
  const project = await resolveProject(workspace.id, input.project)
  const leaseExpiresAt = new Date(Date.now() + (input.leaseMinutes ?? 120) * 60_000)
  const workstream = await prisma.workstream.findFirst({
    where: { workspaceId: workspace.id, projectId: project?.id, status: "needs_review" },
    include: { project: true, goal: true, reports: { orderBy: { updatedAt: "desc" }, take: 1 } },
    orderBy: [{ priority: "desc" }, { updatedAt: "asc" }]
  })
  if (!workstream) {
    return {
      workspace,
      project: project ?? null,
      assignment: null,
      briefing: null,
      message: "No report currently needs review for that scope."
    }
  }
  await prisma.workstream.update({
    where: { id: workstream.id, workspaceId: workspace.id },
    data: { claimedSessionId: sessionId, assignedToUserId: input.userId, leaseExpiresAt }
  })
  const baseBriefing = await getAgentBriefing(workspace.id, workstream.id)
  const briefing = {
    ...baseBriefing,
    role: "HostileReviewer",
    report: workstream.reports[0] ?? null,
    allowed_writes: ["ReviewRound", "AgentMessage"],
    forbidden_actions: [
      "Do not edit the report or reviewed mathematical objects.",
      "Do not approve your own work from the same AgentRun.",
      "Do not complete the Workstream directly."
    ],
    output_contract: {
      required_sections: ["Verdict", "Major issues", "Required changes", "Checked references"],
      required_tool_calls: ["record_review_round"]
    },
    completion_options: ["record_review_round"]
  }
  const agentRun = input.startRun === false ? null : await prisma.agentRun.create({
    data: {
      workspaceId: workspace.id,
      projectId: workstream.projectId,
      workstreamId: workstream.id,
      role: "HostileReviewer",
      status: "running",
      model: input.model,
      sessionId,
      inputBriefing: briefing as Prisma.InputJsonValue,
      toolCalls: [],
      createdObjectRefs: [],
      updatedObjectRefs: []
    }
  })
  return {
    workspace,
    project: workstream.project,
    assignment: workstream,
    briefing,
    agent_run: agentRun,
    session_id: sessionId,
    prompt_to_agent: "Review the submitted report only and create a ReviewRound. Do not edit the reviewed objects."
  }
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
  if (!input.reportId && !input.workstreamId) {
    throw new Error("submitReportForReview requires reportId or workstreamId.")
  }
  const report = input.reportId
    ? await prisma.workstreamReport.findFirstOrThrow({ where: { workspaceId: input.workspaceId, id: input.reportId } })
    : await prisma.workstreamReport.findFirstOrThrow({ where: { workspaceId: input.workspaceId, workstreamId: input.workstreamId }, orderBy: { updatedAt: "desc" } })
  const submitted = await prisma.workstreamReport.update({ where: { id: report.id, workspaceId: input.workspaceId }, data: { status: "submitted", submittedAt: new Date() } })
  const workstream = await prisma.workstream.update({ where: { id: submitted.workstreamId, workspaceId: input.workspaceId }, data: { status: "needs_review", reportId: submitted.id } })
  return {
    ok: true,
    report_id: submitted.id,
    workstream_id: submitted.workstreamId,
    report_status: submitted.status,
    submitted_at: submitted.submittedAt,
    workstream_status: workstream.status
  }
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
  reviewType?: string
  targetVersion?: string
  scope?: unknown
  inspectedArtifactIds?: unknown
  checkedObligationIds?: unknown
  parentMathReopenable?: boolean
  priorApprovalsEvidenceOnly?: boolean
  independence?: string
  obligationChecks?: Array<{ proofObligationId: string; status: string; evidenceMarkdown?: string }>
  bodyMarkdown: string
  createdByAgentRunId?: string
}) {
  const workstream = await prisma.workstream.findFirstOrThrow({ where: { workspaceId: input.workspaceId, id: input.workstreamId } })
  if (input.createdByAgentRunId) {
    const run = await prisma.agentRun.findFirstOrThrow({ where: { workspaceId: input.workspaceId, id: input.createdByAgentRunId } })
    if (run.workstreamId === input.workstreamId && run.role === workstream.coordinatorRole) throw new Error("Reviewer cannot review or edit the same workstream output in the same ReviewRound.")
  }
  const verdict = asReviewVerdict(input.verdict)
  const reviewType = input.reviewType ?? "legacy_unspecified"
  const allowedReviewTypes = ["legacy_unspecified", "ingredient_correctness", "proof_integration", "end_to_end_mathematical", "novelty", "bibliography", "editorial", "source_fidelity", "compile", "numerical_verification", "formal_verification", "other"]
  const allowedIndependence = ["author_self_check", "same_workstream_reviewer", "independent_reviewer", "external_referee_style"]
  if (!allowedReviewTypes.includes(reviewType)) throw new Error(`Invalid review type: ${reviewType}`)
  if (input.independence && !allowedIndependence.includes(input.independence)) throw new Error(`Invalid review independence: ${input.independence}`)
  if (reviewType !== "legacy_unspecified" && !input.targetVersion) throw new Error("Scoped reviews require targetVersion (canonical ManuscriptVersion id or content hash).")
  const manuscriptReviewTypes = new Set(["proof_integration", "end_to_end_mathematical", "novelty", "bibliography", "compile", "editorial", "source_fidelity"])
  let manuscriptTarget: { id: string; contentHash: string } | null = null
  if (manuscriptReviewTypes.has(reviewType)) {
    manuscriptTarget = await prisma.manuscriptVersion.findFirst({ where: { workspaceId: input.workspaceId, OR: [{ id: input.targetVersion }, { contentHash: input.targetVersion }] }, select: { id: true, contentHash: true } })
    if (!manuscriptTarget) throw new Error("This review type requires an exact accessible ManuscriptVersion id or content hash.")
    if (input.targetObjectType && input.targetObjectType !== "ManuscriptVersion") throw new Error("Manuscript review targetObjectType must be ManuscriptVersion.")
    if (input.targetObjectId && input.targetObjectId !== manuscriptTarget.id) throw new Error("Manuscript review targetObjectId must match the exact ManuscriptVersion.")
  }
  if (verdict === "approved" && workstream.kind === "computation") {
    const report = input.reportId ? await prisma.workstreamReport.findFirst({ where: { workspaceId: input.workspaceId, id: input.reportId } }) : null
    const artifactRefs = normalizeLines(report?.artifactRefs)
    const artifactCount = await prisma.artifact.count({ where: { workspaceId: input.workspaceId, workstreamId: input.workstreamId } })
    if (!artifactRefs.length && artifactCount === 0) throw new Error("Computational workstreams require recorded verification artifacts before approval.")
  }
  const obligationChecks = input.obligationChecks ?? []
  if (!Array.isArray(obligationChecks)) throw new Error("obligationChecks must be an array when provided.")
  const obligationIds = obligationChecks.map((check, index) => {
    if (!check || typeof check.proofObligationId !== "string" || !check.proofObligationId.trim()) throw new Error(`obligationChecks[${index}].proofObligationId must be a non-empty string.`)
    if (typeof check.status !== "string" || !check.status.trim()) throw new Error(`obligationChecks[${index}].status must be a non-empty string.`)
    return check.proofObligationId
  })
  if (new Set(obligationIds).size !== obligationIds.length) throw new Error("obligationChecks must not contain duplicate proofObligationId values.")
  const reportId = input.reportId ?? workstream.reportId
  if (reportId) {
    const report = await prisma.workstreamReport.findFirst({ where: { workspaceId: input.workspaceId, id: reportId, workstreamId: input.workstreamId } })
    if (!report) throw new Error("Review report must belong to the target workstream and workspace.")
  }
  if (obligationIds.length) {
    const allowed = await prisma.proofObligation.count({ where: { workspaceId: input.workspaceId, id: { in: obligationIds } } })
    if (allowed !== obligationIds.length) throw new Error("Review obligation checks must reference accessible proof obligations.")
  }
  if (input.createdByAgentRunId) {
    const existing = await prisma.reviewRound.findFirst({ where: { workspaceId: input.workspaceId, workstreamId: input.workstreamId, reportId, createdByAgentRunId: input.createdByAgentRunId, reviewType: reviewType as any, targetVersion: input.targetVersion } })
    if (existing) throw new Error(`A review from this AgentRun already exists for this report and review scope: ${existing.id}`)
  }
  const recordedReview = await prisma.$transaction(async (tx) => {
    const review = await tx.reviewRound.create({
      data: {
        workspaceId: input.workspaceId,
        projectId: workstream.projectId,
        workstreamId: input.workstreamId,
        reportId,
        targetObjectType: manuscriptTarget ? "ManuscriptVersion" : input.targetObjectType ?? "WorkstreamReport",
        targetObjectId: manuscriptTarget?.id ?? input.targetObjectId ?? input.reportId ?? workstream.reportId ?? input.workstreamId,
        reviewerRole: input.reviewerRole ?? "HostileReviewer",
        verdict,
        issues: jsonArray(input.issues),
        requiredChanges: jsonArray(input.requiredChanges),
        checkedRefs: jsonArray(input.checkedRefs),
        bodyMarkdown: input.bodyMarkdown,
        createdByAgentRunId: input.createdByAgentRunId,
        reviewType: reviewType as any,
        targetVersion: input.targetVersion,
        scope: jsonObject(input.scope),
        inspectedArtifactIds: jsonArray(input.inspectedArtifactIds),
        checkedObligationIds: jsonArray(input.checkedObligationIds),
        parentMathReopenable: input.parentMathReopenable ?? true,
        priorApprovalsEvidenceOnly: input.priorApprovalsEvidenceOnly ?? true,
        independence: (input.independence ?? "same_workstream_reviewer") as any
      }
    })
    if (obligationChecks.length) await tx.reviewObligationCheck.createMany({ data: obligationChecks.map((check) => ({ workspaceId: input.workspaceId, reviewRoundId: review.id, proofObligationId: check.proofObligationId, status: check.status, evidenceMarkdown: check.evidenceMarkdown })) })
    const workstreamStatus = verdict === "approved" ? "approved" : verdict === "needs_revision" || verdict === "rejected" ? "revision_required" : verdict === "escalate" ? "escalated" : "blocked"
    const reportStatus = verdict === "approved" ? "reviewed_approved" : "reviewed_needs_revision"
    await tx.workstream.update({ where: { id: input.workstreamId, workspaceId: input.workspaceId }, data: { status: workstreamStatus as any } })
    if (review.reportId) await tx.workstreamReport.update({ where: { id: review.reportId, workspaceId: input.workspaceId }, data: { status: reportStatus } })
    return review
  })
  await recordSubstantiveAction({ workspaceId: input.workspaceId, projectId: workstream.projectId, actionType: "review_recorded", targetType: "ReviewRound", targetId: recordedReview.id, summary: `${reviewType}:${recordedReview.verdict}` })
  return recordedReview
}

export async function completeWorkstream(input: { workspaceId: string; workstreamId: string }) {
  const workstream = await prisma.workstream.findFirstOrThrow({ where: { workspaceId: input.workspaceId, id: input.workstreamId } })
  const dependencyState = await workstreamDependenciesSatisfied(input.workspaceId, input.workstreamId)
  if (!dependencyState.satisfied) throw new Error("Workstream cannot complete while prerequisite workstreams are incomplete or unreviewed.")
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
  const attempt = await prisma.proofAttempt.create({
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
  if (["candidate", "failed", "gap_found", "reviewed", "rejected"].includes(attempt.status)) await recordSubstantiveAction({ workspaceId: input.workspaceId, projectId: input.projectId, actionType: "proof_attempt_finished", targetType: "ProofAttempt", targetId: attempt.id, meaningfulDelta: attempt.status === "reviewed", summary: attempt.status })
  return attempt
}

export async function createGap(input: { workspaceId: string; projectId: string; claimId?: string; proofAttemptId?: string; routeId?: string; title: string; descriptionMarkdown: string; severity?: string; status?: string; suggestedResolution?: string }) {
  const gap = await prisma.gap.create({
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
  await recordSubstantiveAction({ workspaceId: input.workspaceId, projectId: input.projectId, actionType: "gap_created", targetType: "Gap", targetId: gap.id, summary: gap.title })
  return gap
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
  const requestedType = input.type?.toLowerCase().replace(/[\s-]+/g, "_")
  const wants = (names: string[]) => !requestedType || names.includes(requestedType)
  const terms = input.query?.trim().split(/[^\p{L}\p{N}]+/u).filter(Boolean) ?? []
  const text = (fields: string[], projectRelation: string | null = "project") => terms.length ? {
    AND: terms.map((term) => {
      const contains = { contains: term, mode: "insensitive" as const }
      return {
        OR: [
          ...fields.map((field) => ({ [field]: contains })),
          ...(projectRelation ? [{ [projectRelation]: { is: { OR: [{ title: contains }, { slug: contains }] } } }] : [])
        ]
      }
    })
  } : {}
  const [claims, routes, gaps, papers, knownResults, researchDeltas, researchArtifacts, mechanisms, spinoutCandidates, assumptionRegimes, theoremContracts, frontierSnapshots] = await Promise.all([
    wants(["claim", "claims"]) ? prisma.claim.findMany({ where: { workspaceId: input.workspaceId, projectId: input.projectId, ...text(["title", "statementMarkdown"]) } as any, take: 25 }) : [],
    wants(["proofroute", "proof_route", "route", "routes"]) ? prisma.proofRoute.findMany({ where: { workspaceId: input.workspaceId, projectId: input.projectId, ...text(["title", "strategyMarkdown"]) } as any, take: 25 }) : [],
    wants(["gap", "gaps"]) ? prisma.gap.findMany({ where: { workspaceId: input.workspaceId, projectId: input.projectId, ...text(["title", "descriptionMarkdown"]) } as any, take: 25 }) : [],
    wants(["paper", "papers"]) ? prisma.paper.findMany({ where: { workspaceId: input.workspaceId, projectId: input.projectId, ...text(["title"], null) } as any, take: 25 }) : [],
    wants(["knownresult", "known_result", "known_results"]) ? prisma.knownResult.findMany({ where: { workspaceId: input.workspaceId, projectId: input.projectId, ...text(["title", "statementMarkdown"], null) } as any, take: 25 }) : [],
    wants(["research_delta", "research_deltas", "delta"]) ? prisma.researchDelta.findMany({ where: { workspaceId: input.workspaceId, projectId: input.projectId, ...text(["title", "summaryMarkdown", "whatChangedMarkdown", "mainlineEffectMarkdown", "reusableIdeasMarkdown", "blockersMarkdown", "nextMoveMarkdown"]) } as any, take: 25 }) : [],
    wants(["artifact", "artifacts", "research_artifact", "research_artifacts"]) ? prisma.researchArtifact.findMany({ where: { workspaceId: input.workspaceId, projectId: input.projectId, ...text(["title", "descriptionMarkdown", "contentMarkdown"]) } as any, take: 25 }) : [],
    wants(["mechanism", "mechanisms"]) ? prisma.mechanism.findMany({ where: { workspaceId: input.workspaceId, projectId: input.projectId, ...text(["title", "descriptionMarkdown", "coreIdeaMarkdown", "whereItWorkedMarkdown", "whereItFailedMarkdown", "possibleTransfersMarkdown", "killConditionsMarkdown"]) } as any, take: 25 }) : [],
    wants(["spinout", "spinouts", "spinout_candidate", "spinout_candidates"]) ? prisma.spinoutCandidate.findMany({ where: { workspaceId: input.workspaceId, originProjectId: input.projectId, ...text(["title", "statementSketchMarkdown", "whyInterestingMarkdown", "relationToOriginMarkdown", "cheapestNextTestMarkdown", "possiblePayoffMarkdown", "riskMarkdown"], "originProject") } as any, take: 25 }) : [],
    wants(["assumption", "assumptions", "assumption_regime", "assumption_regimes", "regime"]) ? prisma.assumptionRegime.findMany({ where: { workspaceId: input.workspaceId, projectId: input.projectId, ...text(["title", "descriptionMarkdown", "formalStatementMarkdown", "includesMarkdown", "excludesMarkdown", "motivationMarkdown"]) } as any, take: 25 }) : [],
    wants(["theorem_contract", "theorem_contracts", "contract"]) ? prisma.theoremContract.findMany({ where: { workspaceId: input.workspaceId, projectId: input.projectId, ...text(["title", "theoremStatementMarkdown", "assumptionsMarkdown", "conclusionMarkdown", "knownDependenciesMarkdown", "knownBlockersMarkdown", "proofStrategyMarkdown", "currentBestVersionMarkdown"]) } as any, take: 25 }) : [],
    wants(["frontier_snapshot", "frontier_snapshots", "snapshot"]) ? prisma.researchFrontierSnapshot.findMany({ where: { workspaceId: input.workspaceId, projectId: input.projectId, ...text(["title", "snapshotMarkdown", "strongestCurrentTheoremMarkdown", "strongestConditionalTheoremMarkdown", "activeBlockersMarkdown", "activeMechanismsMarkdown", "spinoutsMarkdown", "deadOrPausedBranchesMarkdown", "recommendedNextMovesMarkdown"]) } as any, take: 25 }) : []
  ])
  return { claims, routes, gaps, papers, known_results: knownResults, research_deltas: researchDeltas, research_artifacts: researchArtifacts, mechanisms, spinout_candidates: spinoutCandidates, assumption_regimes: assumptionRegimes, theorem_contracts: theoremContracts, frontier_snapshots: frontierSnapshots }
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
  const dependencyStates = await Promise.all(workstreams.map(async (w) => ({ workstream: w, ...(await workstreamDependenciesSatisfied(workspaceId, w.id)) })))
  const readyWorkstreams = dependencyStates.filter((item) => item.satisfied && ["ready", "planned", "revision_required"].includes(item.workstream.status)).map((item) => item.workstream)
  const suggested = readyWorkstreams[0] ?? null
  const suggestedPrompts = {
    coordinator: coordinatorChatPrompt(project.title),
    next_specialist: suggested ? agentChatPrompt(project.title, suggested.coordinatorRole) : null,
    next_reviewer: needsReview[0] ? reviewerChatPrompt(project.title) : null,
    ready_specialists: readyWorkstreams
      .slice(0, 6)
      .map((w) => ({ workstreamId: w.id, title: w.title, role: w.coordinatorRole, kind: w.kind, prompt: agentChatPrompt(project.title, w.coordinatorRole) })),
    review_chats: needsReview.slice(0, 6).map((w) => ({ workstreamId: w.id, title: w.title, prompt: reviewerChatPrompt(project.title) }))
  }
  const groupedGoals = goals.reduce<Record<string, typeof goals>>((acc, goal) => {
    ;(acc[goal.status] ??= []).push(goal)
    return acc
  }, {})
  const groupedWorkstreams = workstreams.reduce<Record<string, typeof workstreams>>((acc, workstream) => {
    ;(acc[workstream.status] ??= []).push(workstream)
    return acc
  }, {})
  const frontier = await getResearchFrontierSummary({ workspaceId, projectId })
  const readiness = await computeSubmissionReadiness(workspaceId, projectId)
  const projectHealth = await getProjectHealth(workspaceId, projectId)
  return { project, canonical_working_paper: readiness.canonical_manuscript ?? null, readiness, project_health: projectHealth, workstream_dependency_states: dependencyStates.map((item) => ({ workstream_id: item.workstream.id, satisfied: item.satisfied, blocking_prerequisite_ids: item.dependencies.filter((d) => d.prerequisite.status !== "completed" || !d.prerequisite.reviews.some((r) => r.verdict === "approved")).map((d) => d.prerequisiteWorkstreamId) })), goals_by_status: groupedGoals, workstreams_by_status: groupedWorkstreams, needs_review: needsReview, blocked_or_escalated: blocked, recent_agent_runs: recentAgentRuns, key_claims: keyClaims, open_gaps: openGaps, recent_reviews: reviews.map((review) => ({ ...review, scoped_status: reviewScopedStatus(review) })), suggested_next_assignment: suggested, suggested_chat_prompts: suggestedPrompts, frontier }
}

type FrontierListInput = { workspaceId: string; projectId?: string; status?: string; kind?: string; limit?: number }
type FrontierWriteInput = Record<string, any> & { workspaceId: string; projectId?: string; createdByUserId?: string }

function takeLimit(limit?: number) {
  return Math.min(Math.max(Number(limit) || 50, 1), 200)
}

function uniqueSlug(base: string) {
  return `${slugify(base)}-${randomUUID().slice(0, 8)}`
}

function score(value: unknown) {
  return typeof value === "number" && value >= 0 && value <= 5 ? value : undefined
}

function cleanPatch(input: Record<string, unknown>, allowed: string[]) {
  return Object.fromEntries(allowed.filter((key) => input[key] !== undefined).map((key) => [key, input[key]]))
}

export async function getResearchFrontierSummary(input: { workspaceId: string; projectId?: string }) {
  const [latestSnapshot, contracts, mechanisms, spinouts, regimes, deltas, artifacts] = await Promise.all([
    getLatestFrontierSnapshot(input),
    listTheoremContracts({ ...input, status: "active", limit: 8 }),
    listMechanisms({ ...input, limit: 12 }),
    listSpinoutCandidates({ ...input, limit: 8 }),
    listAssumptionRegimes({ ...input, status: "active", limit: 8 }),
    listResearchDeltas({ ...input, limit: 8 }),
    listResearchArtifacts({ ...input, limit: 8 })
  ])
  return { latestSnapshot, contracts, mechanisms, spinouts, assumptionRegimes: regimes, recentDeltas: deltas, artifacts }
}

export async function listResearchDeltas(input: FrontierListInput & { sourceType?: string; sourceId?: string }) {
  return prisma.researchDelta.findMany({
    where: { workspaceId: input.workspaceId, projectId: input.projectId, sourceType: input.sourceType, sourceId: input.sourceId },
    orderBy: { createdAt: "desc" },
    take: takeLimit(input.limit)
  })
}

export async function getResearchDelta(workspaceId: string, id: string) {
  return prisma.researchDelta.findFirstOrThrow({ where: { workspaceId, id } })
}

export async function createResearchDelta(input: FrontierWriteInput) {
  return prisma.researchDelta.create({
    data: {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      title: input.title,
      summaryMarkdown: input.summaryMarkdown ?? input.summary ?? input.whatChangedMarkdown ?? "",
      whatChangedMarkdown: input.whatChangedMarkdown ?? input.summaryMarkdown ?? "",
      mainlineEffectMarkdown: input.mainlineEffectMarkdown,
      reusableIdeasMarkdown: input.reusableIdeasMarkdown,
      blockersMarkdown: input.blockersMarkdown,
      nextMoveMarkdown: input.nextMoveMarkdown,
      confidence: input.confidence,
      createdByUserId: input.createdByUserId
    }
  })
}

export async function updateResearchDelta(input: { workspaceId: string; id: string; patch: Record<string, unknown> }) {
  return prisma.researchDelta.update({ where: { id: input.id, workspaceId: input.workspaceId }, data: cleanPatch(input.patch, ["title", "summaryMarkdown", "whatChangedMarkdown", "mainlineEffectMarkdown", "reusableIdeasMarkdown", "blockersMarkdown", "nextMoveMarkdown", "confidence"]) as any })
}

export async function listMechanisms(input: FrontierListInput & { maturity?: string; portability?: number }) {
  return prisma.mechanism.findMany({
    where: { workspaceId: input.workspaceId, projectId: input.projectId, status: input.status as any, maturity: input.maturity as any, portabilityScore: input.portability },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    take: takeLimit(input.limit)
  })
}

export async function getMechanism(workspaceId: string, id: string) {
  return prisma.mechanism.findFirstOrThrow({ where: { workspaceId, id } })
}

export async function createMechanism(input: FrontierWriteInput) {
  return prisma.mechanism.create({
    data: {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      title: input.title,
      slug: input.slug ? slugify(input.slug) : uniqueSlug(input.title),
      status: input.status ?? "seed",
      maturity: input.maturity ?? "seed",
      centralityScore: score(input.centralityScore),
      portabilityScore: score(input.portabilityScore),
      tractabilityScore: score(input.tractabilityScore),
      noveltyScore: score(input.noveltyScore),
      loadBearingScore: score(input.loadBearingScore),
      descriptionMarkdown: input.descriptionMarkdown ?? input.coreIdeaMarkdown ?? "",
      coreIdeaMarkdown: input.coreIdeaMarkdown,
      whereItWorkedMarkdown: input.whereItWorkedMarkdown,
      whereItFailedMarkdown: input.whereItFailedMarkdown,
      possibleTransfersMarkdown: input.possibleTransfersMarkdown,
      killConditionsMarkdown: input.killConditionsMarkdown,
      createdByUserId: input.createdByUserId
    }
  })
}

export async function updateMechanism(input: { workspaceId: string; id: string; patch: Record<string, unknown> }) {
  return prisma.mechanism.update({ where: { id: input.id, workspaceId: input.workspaceId }, data: cleanPatch(input.patch, ["title", "status", "maturity", "centralityScore", "portabilityScore", "tractabilityScore", "noveltyScore", "loadBearingScore", "descriptionMarkdown", "coreIdeaMarkdown", "whereItWorkedMarkdown", "whereItFailedMarkdown", "possibleTransfersMarkdown", "killConditionsMarkdown"]) as any })
}

export async function listSpinoutCandidates(input: FrontierListInput) {
  return prisma.spinoutCandidate.findMany({ where: { workspaceId: input.workspaceId, originProjectId: input.projectId, status: input.status as any }, orderBy: [{ status: "asc" }, { updatedAt: "desc" }], take: takeLimit(input.limit), include: { promotedProject: true } })
}

export async function getSpinoutCandidate(workspaceId: string, id: string) {
  return prisma.spinoutCandidate.findFirstOrThrow({ where: { workspaceId, id }, include: { originProject: true, promotedProject: true } })
}

export async function createSpinoutCandidate(input: FrontierWriteInput & { originProjectId?: string }) {
  return prisma.spinoutCandidate.create({
    data: {
      workspaceId: input.workspaceId,
      originProjectId: input.originProjectId ?? input.projectId,
      title: input.title,
      slug: input.slug ? slugify(input.slug) : uniqueSlug(input.title),
      status: input.status ?? "seed",
      statementSketchMarkdown: input.statementSketchMarkdown ?? input.statement ?? "",
      whyInterestingMarkdown: input.whyInterestingMarkdown,
      relationToOriginMarkdown: input.relationToOriginMarkdown,
      cheapestNextTestMarkdown: input.cheapestNextTestMarkdown,
      possiblePayoffMarkdown: input.possiblePayoffMarkdown,
      riskMarkdown: input.riskMarkdown,
      createdByUserId: input.createdByUserId
    }
  })
}

export async function updateSpinoutCandidate(input: { workspaceId: string; id: string; patch: Record<string, unknown> }) {
  return prisma.spinoutCandidate.update({ where: { id: input.id, workspaceId: input.workspaceId }, data: cleanPatch(input.patch, ["title", "status", "statementSketchMarkdown", "whyInterestingMarkdown", "relationToOriginMarkdown", "cheapestNextTestMarkdown", "possiblePayoffMarkdown", "riskMarkdown"]) as any })
}

export async function promoteSpinoutCandidate(input: { workspaceId: string; id: string; userId?: string }) {
  const spinout = await prisma.spinoutCandidate.findFirstOrThrow({ where: { workspaceId: input.workspaceId, id: input.id } })
  if (spinout.promotedProjectId) return getSpinoutCandidate(input.workspaceId, input.id)
  const project = await createProject({ workspaceId: input.workspaceId, title: spinout.title, slug: spinout.slug, statement: spinout.statementSketchMarkdown, userId: input.userId })
  await prisma.researchLink.create({ data: { workspaceId: input.workspaceId, projectId: project.id, sourceType: "Project", sourceId: project.id, relationType: "spun_out_from", targetType: "SpinoutCandidate", targetId: spinout.id, createdByUserId: input.userId } })
  return prisma.spinoutCandidate.update({ where: { id: spinout.id, workspaceId: input.workspaceId }, data: { status: "promoted", promotedProjectId: project.id }, include: { promotedProject: true } })
}

export async function listAssumptionRegimes(input: FrontierListInput) {
  return prisma.assumptionRegime.findMany({ where: { workspaceId: input.workspaceId, projectId: input.projectId, status: input.status as any }, orderBy: [{ status: "asc" }, { updatedAt: "desc" }], take: takeLimit(input.limit) })
}

export async function getAssumptionRegime(workspaceId: string, id: string) {
  return prisma.assumptionRegime.findFirstOrThrow({ where: { workspaceId, id } })
}

export async function createAssumptionRegime(input: FrontierWriteInput) {
  return prisma.assumptionRegime.create({ data: { workspaceId: input.workspaceId, projectId: input.projectId, title: input.title, slug: input.slug ? slugify(input.slug) : uniqueSlug(input.title), status: input.status ?? "seed", descriptionMarkdown: input.descriptionMarkdown ?? input.formalStatementMarkdown ?? "", formalStatementMarkdown: input.formalStatementMarkdown, includesMarkdown: input.includesMarkdown, excludesMarkdown: input.excludesMarkdown, motivationMarkdown: input.motivationMarkdown, createdByUserId: input.createdByUserId } })
}

export async function updateAssumptionRegime(input: { workspaceId: string; id: string; patch: Record<string, unknown> }) {
  return prisma.assumptionRegime.update({ where: { id: input.id, workspaceId: input.workspaceId }, data: cleanPatch(input.patch, ["title", "status", "descriptionMarkdown", "formalStatementMarkdown", "includesMarkdown", "excludesMarkdown", "motivationMarkdown"]) as any })
}

export async function listTheoremContracts(input: FrontierListInput) {
  return prisma.theoremContract.findMany({ where: { workspaceId: input.workspaceId, projectId: input.projectId, status: input.status as any }, orderBy: [{ status: "asc" }, { updatedAt: "desc" }], take: takeLimit(input.limit) })
}

export async function getTheoremContract(workspaceId: string, id: string) {
  return prisma.theoremContract.findFirstOrThrow({ where: { workspaceId, id } })
}

export async function createTheoremContract(input: FrontierWriteInput) {
  if (!input.projectId) throw new Error("TheoremContract requires projectId.")
  return prisma.theoremContract.create({ data: { workspaceId: input.workspaceId, projectId: input.projectId, title: input.title, slug: input.slug ? slugify(input.slug) : uniqueSlug(input.title), status: input.status ?? "draft", theoremStatementMarkdown: input.theoremStatementMarkdown ?? input.statement ?? "", assumptionsMarkdown: input.assumptionsMarkdown, conclusionMarkdown: input.conclusionMarkdown, knownDependenciesMarkdown: input.knownDependenciesMarkdown, knownBlockersMarkdown: input.knownBlockersMarkdown, proofStrategyMarkdown: input.proofStrategyMarkdown, currentBestVersionMarkdown: input.currentBestVersionMarkdown, confidence: input.confidence, createdByUserId: input.createdByUserId } })
}

export async function updateTheoremContract(input: { workspaceId: string; id: string; patch: Record<string, unknown> }) {
  return prisma.theoremContract.update({ where: { id: input.id, workspaceId: input.workspaceId }, data: cleanPatch(input.patch, ["title", "status", "theoremStatementMarkdown", "assumptionsMarkdown", "conclusionMarkdown", "knownDependenciesMarkdown", "knownBlockersMarkdown", "proofStrategyMarkdown", "currentBestVersionMarkdown", "confidence"]) as any })
}

export async function listFrontierSnapshots(input: FrontierListInput & { source?: string }) {
  return prisma.researchFrontierSnapshot.findMany({ where: { workspaceId: input.workspaceId, projectId: input.projectId, source: input.source }, orderBy: { createdAt: "desc" }, take: takeLimit(input.limit) })
}

export async function getLatestFrontierSnapshot(input: { workspaceId: string; projectId?: string }) {
  return prisma.researchFrontierSnapshot.findFirst({ where: { workspaceId: input.workspaceId, projectId: input.projectId }, orderBy: { createdAt: "desc" } })
}

export async function createFrontierSnapshot(input: FrontierWriteInput) {
  return prisma.researchFrontierSnapshot.create({ data: { workspaceId: input.workspaceId, projectId: input.projectId, title: input.title, snapshotMarkdown: input.snapshotMarkdown ?? "", strongestCurrentTheoremMarkdown: input.strongestCurrentTheoremMarkdown, strongestConditionalTheoremMarkdown: input.strongestConditionalTheoremMarkdown, activeBlockersMarkdown: input.activeBlockersMarkdown, activeMechanismsMarkdown: input.activeMechanismsMarkdown, spinoutsMarkdown: input.spinoutsMarkdown, deadOrPausedBranchesMarkdown: input.deadOrPausedBranchesMarkdown, recommendedNextMovesMarkdown: input.recommendedNextMovesMarkdown, source: input.source, createdByUserId: input.createdByUserId } })
}

export async function listResearchArtifacts(input: FrontierListInput) {
  return prisma.researchArtifact.findMany({ where: { workspaceId: input.workspaceId, projectId: input.projectId, kind: input.kind as any, status: input.status as any }, orderBy: [{ status: "asc" }, { updatedAt: "desc" }], take: takeLimit(input.limit) })
}

export async function getResearchArtifact(workspaceId: string, id: string) {
  const artifact = await prisma.researchArtifact.findFirst({ where: { workspaceId, id } })
  if (!artifact) throw researchArtifactNotFound()
  return artifact
}

function researchArtifactNotFound() {
  return Object.assign(new Error("Research artifact not found"), { status: 404, code: "research_artifact_not_found" })
}

export async function getResearchArtifactBundle(workspaceId: string, ids: unknown) {
  if (!Array.isArray(ids) || ids.length === 0 || ids.some((id) => typeof id !== "string" || !id)) {
    throw Object.assign(new Error("artifact_ids must be a non-empty array of IDs"), { status: 400 })
  }
  if (new Set(ids).size !== ids.length) {
    throw Object.assign(new Error("artifact_ids must not contain duplicates"), { status: 400 })
  }
  const artifacts = await prisma.researchArtifact.findMany({ where: { workspaceId, id: { in: ids } } })
  if (artifacts.length !== ids.length) throw researchArtifactNotFound()
  return artifacts.sort((a, b) => a.id.localeCompare(b.id))
}

export async function createResearchArtifact(input: FrontierWriteInput) {
  return prisma.researchArtifact.create({ data: { workspaceId: input.workspaceId, projectId: input.projectId, title: input.title, slug: input.slug ? slugify(input.slug) : uniqueSlug(input.title), kind: input.kind ?? "other", status: input.status ?? "draft", descriptionMarkdown: input.descriptionMarkdown, contentMarkdown: input.contentMarkdown, filePath: input.filePath, url: input.url, createdByUserId: input.createdByUserId } })
}

function fingerprint(value: string) { return createHash("sha256").update(value).digest("hex") }

/** Creates an unverified candidate. It can only become the canonical working paper after a non-empty exact ledger exists. */
export async function createManuscriptVersion(input: { workspaceId: string; projectId: string; artifactId: string; parentArtifactIds?: string[]; claimIds?: string[]; theoremFingerprint?: string; citationFingerprint?: string }) {
  const artifact = await prisma.researchArtifact.findFirstOrThrow({ where: { workspaceId: input.workspaceId, projectId: input.projectId, id: input.artifactId } })
  const contentHash = fingerprint(artifact.contentMarkdown ?? "")
  return prisma.$transaction(async (tx) => {
    const existing = await tx.manuscriptVersion.findFirst({ where: { projectId: input.projectId, contentHash } })
    if (existing) return existing
    const latest = await tx.manuscriptVersion.findFirst({ where: { workspaceId: input.workspaceId, projectId: input.projectId }, orderBy: { version: "desc" } })
    const version = await tx.manuscriptVersion.create({ data: { workspaceId: input.workspaceId, projectId: input.projectId, artifactId: artifact.id, version: (latest?.version ?? 0) + 1, contentHash, theoremFingerprint: input.theoremFingerprint ?? fingerprint(JSON.stringify(input.claimIds ?? [])), citationFingerprint: input.citationFingerprint ?? fingerprint((artifact.contentMarkdown ?? "").match(/\\[[^\]]+\]|\\cite\{[^}]+\}/g)?.join("|") ?? ""), isCanonical: false, verificationState: "unverified_candidate", freezeLevel: "none" } })
    if (input.parentArtifactIds?.length) await tx.researchLink.createMany({ data: [...new Set(input.parentArtifactIds)].map((targetId) => ({ workspaceId: input.workspaceId, projectId: input.projectId, sourceType: "ManuscriptVersion", sourceId: version.id, relationType: "derived_from", targetType: "ResearchArtifact", targetId })) })
    if (input.claimIds?.length) await tx.researchLink.createMany({ data: [...new Set(input.claimIds)].map((targetId) => ({ workspaceId: input.workspaceId, projectId: input.projectId, sourceType: "ManuscriptVersion", sourceId: version.id, relationType: "contribution_claim", targetType: "Claim", targetId })) })
    return version
  })
}

/** Promotion is the ledger circuit breaker: a nontrivial canonical manuscript may not have zero obligations. */
export async function promoteManuscriptVersion(input: { workspaceId: string; manuscriptVersionId: string }) {
  return prisma.$transaction(async (tx) => {
    const version = await tx.manuscriptVersion.findFirstOrThrow({ where: { workspaceId: input.workspaceId, id: input.manuscriptVersionId } })
    const obligations = await tx.proofObligation.count({ where: { workspaceId: input.workspaceId, manuscriptVersionId: version.id, required: true } })
    if (obligations === 0) throw new Error("A canonical manuscript requires at least one required proof obligation in its exact-version ledger.")
    const prior = await tx.manuscriptVersion.findFirst({ where: { workspaceId: input.workspaceId, projectId: version.projectId, isCanonical: true } })
    if (prior && prior.id !== version.id) await tx.manuscriptVersion.update({ where: { id: prior.id }, data: { isCanonical: false, supersededAt: new Date() } })
    const promoted = await tx.manuscriptVersion.update({ where: { id: version.id }, data: { isCanonical: true, verificationState: "ledger_complete" } })
    await tx.project.update({ where: { id: version.projectId }, data: { currentWorkingPaperId: version.id } })
    return promoted
  })
}

export async function setManuscriptFreeze(input: { workspaceId: string; manuscriptVersionId: string; level: "lexical" | "interface" | "mathematical" }) {
  const version = await prisma.manuscriptVersion.findFirstOrThrow({ where: { workspaceId: input.workspaceId, id: input.manuscriptVersionId } })
  if (input.level === "mathematical") {
    const readiness = await computeSubmissionReadiness(input.workspaceId, version.projectId)
    if (!readiness.submission_ready) throw new Error("Mathematical freeze requires exact-version mathematical submission readiness; lexical/interface freezes never close mathematics.")
  }
  const now = new Date()
  return prisma.manuscriptVersion.update({ where: { id: version.id }, data: {
    freezeLevel: input.level,
    lexicalFrozenAt: input.level === "lexical" ? now : undefined,
    interfaceFrozenAt: input.level === "interface" ? now : undefined,
    mathematicalFrozenAt: input.level === "mathematical" ? now : undefined,
    verificationState: input.level === "mathematical" ? "mathematically_reviewed" : undefined
  } })
}

export async function importExternalReview(input: { workspaceId: string; projectId: string; manuscriptVersionId?: string; theoremOrArtifactRef: string; originalReviewText: string; originalReviewUri?: string; provenance: string; reviewerIdentity?: string; independenceStatement: string; reviewScope: string; verdict: string; issues?: unknown; requiredChanges?: unknown }) {
  const allowed = ["human", "journal_referee", "fresh_external_ai_chat", "internal_maff_agent", "unknown"]
  if (!allowed.includes(input.provenance)) throw new Error(`Invalid external-review provenance: ${input.provenance}`)
  return prisma.$transaction(async (tx) => {
    if (input.manuscriptVersionId) await tx.manuscriptVersion.findFirstOrThrow({ where: { workspaceId: input.workspaceId, projectId: input.projectId, id: input.manuscriptVersionId } })
    const imported = await tx.externalReviewImport.create({ data: { ...input, provenance: input.provenance as any, verdict: asReviewVerdict(input.verdict), issues: jsonArray(input.issues), requiredChanges: jsonArray(input.requiredChanges) } })
    await recordSubstantiveActionInTransaction(tx, { workspaceId: input.workspaceId, projectId: input.projectId, actionType: "external_review_imported", targetType: "ExternalReviewImport", targetId: imported.id, summary: input.reviewScope })
    return imported
  }, { isolationLevel: "Serializable" })
}

export async function createStrategicReviewRound(input: { workspaceId: string; projectId: string; verdict: string; reviewerIndependence: string; whatChangedMarkdown: string; loopDiagnosisMarkdown: string; blockerStructureMarkdown: string; alternativesMarkdown: string; branchAllocation?: unknown; nextMoves?: unknown; probabilityEstimates?: unknown; metrics?: unknown }) {
  const valid = ["continue", "continue_with_rebase", "split", "pivot", "pause", "terminate"]
  if (!valid.includes(input.verdict)) throw new Error(`Invalid strategic-review verdict: ${input.verdict}`)
  if (!/independent/i.test(input.reviewerIndependence)) throw new Error("StrategicReviewer must declare independence from the current proof work.")
  if (!Array.isArray(input.nextMoves) || input.nextMoves.length !== 3 || input.nextMoves.some((move) => !move || typeof move !== "object" || ["test", "information_gain", "success_condition", "kill_condition", "decision"].some((key) => typeof (move as Record<string, unknown>)[key] !== "string"))) throw new Error("A StrategicReviewRound requires exactly three structured next moves with test, information_gain, success_condition, kill_condition, and decision.")
  const requiredDimensions = new Set(["truth", "provable", "methods", "publishable_fallback", "next_epoch_progress"])
  const estimates = Array.isArray(input.probabilityEstimates) ? input.probabilityEstimates : []
  if (estimates.some((estimate) => !estimate || typeof estimate !== "object" || typeof (estimate as Record<string, unknown>).dimension !== "string" || typeof (estimate as Record<string, unknown>).range !== "string") || ![...requiredDimensions].every((dimension) => estimates.some((estimate) => (estimate as Record<string, unknown>).dimension === dimension))) throw new Error("A StrategicReviewRound requires structured range estimates for truth, provable, methods, publishable_fallback, and next_epoch_progress.")
  const computedMetrics = await getProjectHealthMetrics(input.workspaceId, input.projectId)
  return prisma.$transaction(async (tx) => {
    await tx.project.findFirstOrThrow({ where: { workspaceId: input.workspaceId, id: input.projectId } })
    const epoch = await tx.projectEpoch.findFirst({ where: { workspaceId: input.workspaceId, projectId: input.projectId }, orderBy: { number: "desc" } })
    const review = await tx.strategicReviewRound.create({ data: { ...input, verdict: input.verdict as any, projectEpochId: epoch?.id, branchAllocation: jsonArray(input.branchAllocation), nextMoves: jsonArray(input.nextMoves), probabilityEstimates: jsonArray(input.probabilityEstimates), metrics: jsonObject(input.metrics ?? computedMetrics) } })
    if (epoch) await tx.projectEpoch.update({ where: { id: epoch.id }, data: { strategicReviewCompletedAt: new Date(), downstreamPausedAt: null } })
    return review
  })
}

export async function createProjectBranch(input: { workspaceId: string; projectId: string; title: string; state?: string; rationaleMarkdown?: string; targetObjectType?: string; targetObjectId?: string }) {
  const allowed = ["mainline", "exploratory", "paused", "killed", "spinout_candidate"]
  if (input.state && !allowed.includes(input.state)) throw new Error(`Invalid branch state: ${input.state}`)
  return prisma.projectBranch.create({ data: { ...input, state: input.state as any ?? "exploratory" } })
}

export async function listStrategicReviews(workspaceId: string, projectId: string) {
  return prisma.strategicReviewRound.findMany({ where: { workspaceId, projectId }, orderBy: { createdAt: "desc" } })
}

export async function getProjectHealth(workspaceId: string, projectId: string) {
  const [epoch, reviews, actions, branches, workstreams, gaps] = await Promise.all([
    prisma.projectEpoch.findFirst({ where: { workspaceId, projectId }, orderBy: { number: "desc" } }),
    listStrategicReviews(workspaceId, projectId),
    prisma.projectSubstantiveAction.findMany({ where: { workspaceId, epoch: { projectId } }, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.projectBranch.findMany({ where: { workspaceId, projectId }, orderBy: { updatedAt: "desc" } }),
    prisma.workstream.findMany({ where: { workspaceId, projectId } }),
    prisma.gap.findMany({ where: { workspaceId, projectId, status: { in: ["open", "assigned"] } } })
  ])
  const actionCount = epoch?.substantiveActionCount ?? 0
  return { epoch, strategic_reviews: reviews, branches, metrics: { frontier_delta_rate: actions.filter((a) => a.meaningfulDelta).length / Math.max(actionCount, 1), gap_reopen_rate: gaps.filter((g) => g.status === "open").length / Math.max(gaps.length, 1), blocked_workstream_fraction: workstreams.filter((w) => ["blocked", "escalated", "revision_required"].includes(w.status)).length / Math.max(workstreams.length, 1), review_debt: workstreams.filter((w) => w.status === "needs_review").length }, circuit_breakers: { strategic_review_queued: Boolean(epoch?.strategicReviewQueuedAt && !epoch?.strategicReviewCompletedAt), downstream_paused: Boolean(epoch?.downstreamPausedAt && !epoch?.strategicReviewCompletedAt) } }
}

export async function createProofObligation(input: { workspaceId: string; projectId: string; manuscriptVersionId: string; title: string; statementMarkdown: string; dependencies?: unknown; claimId?: string; sourceArtifactId?: string; proofLocation?: string; manuscriptLocation?: string; externalTheorems?: unknown; externalAssumptionsMatched?: boolean; exactManuscriptProofPresent?: boolean; required?: boolean }) {
  const version = await prisma.manuscriptVersion.findFirstOrThrow({ where: { workspaceId: input.workspaceId, projectId: input.projectId, id: input.manuscriptVersionId } })
  return prisma.proofObligation.create({ data: { workspaceId: input.workspaceId, projectId: input.projectId, manuscriptVersionId: version.id, title: input.title, statementMarkdown: input.statementMarkdown, dependencies: jsonArray(input.dependencies), claimId: input.claimId, sourceArtifactId: input.sourceArtifactId, proofLocation: input.proofLocation, manuscriptLocation: input.manuscriptLocation, externalTheorems: jsonArray(input.externalTheorems), externalAssumptionsMatched: input.externalAssumptionsMatched, exactManuscriptProofPresent: input.exactManuscriptProofPresent, required: input.required ?? true } })
}

const scopedApprovalLabel: Record<string, string> = {
  ingredient_correctness: "local_artifact_correctness",
  proof_integration: "integration_fidelity",
  novelty: "novelty_scope",
  compile: "compile_render",
  end_to_end_mathematical: "exact_version_mathematical"
}

export function reviewScopedStatus(review: { verdict: string; reviewType: string }) {
  return review.verdict === "approved" ? `approved: ${scopedApprovalLabel[review.reviewType] ?? review.reviewType}` : `${review.verdict}: ${review.reviewType}`
}

export async function getProjectHealthMetrics(workspaceId: string, projectId: string) {
  const [epoch, actions, deltas, obligations, checks, gaps, reports, manuscripts, workstreams, reviews] = await Promise.all([
    prisma.projectEpoch.findFirst({ where: { workspaceId, projectId }, orderBy: { number: "desc" } }),
    prisma.projectSubstantiveAction.findMany({ where: { workspaceId, epoch: { projectId } }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.researchDelta.count({ where: { workspaceId, projectId } }),
    prisma.proofObligation.count({ where: { workspaceId, projectId, required: true } }),
    prisma.reviewObligationCheck.count({ where: { workspaceId, proofObligation: { projectId }, status: "preserved" } }),
    prisma.gap.findMany({ where: { workspaceId, projectId } }),
    prisma.workstreamReport.findMany({ where: { workspaceId, projectId }, orderBy: { updatedAt: "desc" }, take: 10 }),
    prisma.manuscriptVersion.count({ where: { workspaceId, projectId } }),
    prisma.workstream.findMany({ where: { workspaceId, projectId }, select: { status: true } }),
    prisma.reviewRound.findMany({ where: { workspaceId, projectId }, orderBy: { createdAt: "desc" }, take: 30 })
  ])
  const actionCount = epoch?.substantiveActionCount ?? 0
  const active = workstreams.filter((w) => ["ready", "claimed", "running", "needs_review", "revision_required", "blocked", "escalated"].includes(w.status))
  const blocked = active.filter((w) => ["blocked", "escalated", "revision_required"].includes(w.status))
  const repeat = reports.length > 1 ? reports.slice(1).filter((report) => report.bodyMarkdown === reports[0].bodyMarkdown).length / (reports.length - 1) : 0
  return { epoch_number: epoch?.number ?? 0, substantive_actions: actionCount, strategic_review_queued: Boolean(epoch?.strategicReviewQueuedAt), downstream_paused: Boolean(epoch?.downstreamPausedAt), frontier_delta_rate: actionCount ? deltas / Math.max(actionCount / 10, 1) : 0, obligation_closure_rate: obligations ? checks / obligations : 0, gap_reopen_count: gaps.filter((gap) => /reopen/i.test(gap.descriptionMarkdown)).length, integration_churn: manuscripts, semantic_repeat_score: repeat, blocked_workstream_fraction: active.length ? blocked.length / active.length : 0, review_debt: workstreams.filter((w) => ["needs_review", "revision_required"].includes(w.status)).length, stale_assumption_count: 0, work_to_frontier_ratio: deltas ? actions.length / deltas : actions.length, recent_review_count: reviews.length }
}

export async function getIntegrationCoverage(workspaceId: string, manuscriptVersionId: string) {
  const obligations = await prisma.proofObligation.findMany({ where: { workspaceId, manuscriptVersionId }, include: { sourceArtifact: true, checks: { include: { reviewRound: true } } } })
  return obligations.map((o) => ({ obligation: o, preserved: o.checks.some((c) => c.status === "preserved" && c.reviewRound.reviewType === "proof_integration" && c.reviewRound.verdict === "approved" && c.reviewRound.targetVersion === manuscriptVersionId), checks: o.checks }))
}

export async function computeProjectSubmissionReadiness(workspaceId: string, projectId: string) { return computeSubmissionReadiness(workspaceId, projectId) }


export async function updateResearchArtifact(input: { workspaceId: string; id: string; patch: Record<string, unknown> }) {
  const before = await prisma.researchArtifact.findFirstOrThrow({ where: { id: input.id, workspaceId: input.workspaceId } })
  const artifact = await prisma.researchArtifact.update({ where: { id: input.id, workspaceId: input.workspaceId }, data: cleanPatch(input.patch, ["title", "kind", "status", "descriptionMarkdown", "contentMarkdown", "filePath", "url"]) as any })
  if (input.patch.contentMarkdown !== undefined && artifact.contentMarkdown !== before.contentMarkdown && artifact.projectId) {
    const canonical = await prisma.manuscriptVersion.findFirst({ where: { workspaceId: input.workspaceId, projectId: artifact.projectId, artifactId: artifact.id, isCanonical: true } })
    if (canonical) {
      await prisma.manuscriptVersion.update({ where: { id: canonical.id }, data: { isCanonical: false, supersededAt: new Date() } })
      const links = await prisma.researchLink.findMany({ where: { workspaceId: input.workspaceId, projectId: artifact.projectId, sourceType: "ManuscriptVersion", sourceId: canonical.id } })
      await createManuscriptVersion({ workspaceId: input.workspaceId, projectId: artifact.projectId, artifactId: artifact.id, parentArtifactIds: links.filter((l) => l.targetType === "ResearchArtifact" && l.relationType === "derived_from").map((l) => l.targetId), claimIds: links.filter((l) => l.targetType === "Claim" && l.relationType === "contribution_claim").map((l) => l.targetId) })
    }
  }
  return artifact
}

export async function listResearchLinks(input: FrontierListInput & { sourceType?: string; sourceId?: string; targetType?: string; targetId?: string }) {
  return prisma.researchLink.findMany({ where: { workspaceId: input.workspaceId, projectId: input.projectId, sourceType: input.sourceType, sourceId: input.sourceId, targetType: input.targetType, targetId: input.targetId }, orderBy: { createdAt: "desc" }, take: takeLimit(input.limit) })
}

export async function createResearchLink(input: FrontierWriteInput) {
  return prisma.researchLink.create({ data: { workspaceId: input.workspaceId, projectId: input.projectId, sourceType: input.sourceType, sourceId: input.sourceId, relationType: input.relationType, targetType: input.targetType, targetId: input.targetId, noteMarkdown: input.noteMarkdown, confidence: input.confidence, createdByUserId: input.createdByUserId } })
}

export async function deleteResearchLink(input: { workspaceId: string; id: string }) {
  await prisma.researchLink.delete({ where: { id: input.id, workspaceId: input.workspaceId } })
  return { ok: true }
}

function legacyProjectSeeds(project: { id: string; slug: string; title: string }) {
  if (project.slug === "galton-watson-conductance-regularity") {
    return {
      mechanisms: [
        ["finite-colour-skeleton-instability-under-competing-branch-counts", "finite-colour skeleton instability under competing branch counts", "A finite-colour skeleton can expose instability when competing branch maps force incompatible packet routing or mass allocation."],
        ["endpoint-packet-control-under-nonlinear-transform", "endpoint packet control under nonlinear transform", "Track endpoint packets through nonlinear transforms to isolate where regularity gains are created or lost."],
        ["convolution-branch-ac-bridge", "convolution branch AC bridge", "Use convolutional smoothing along branching decompositions as a bridge from discrete offspring structure to absolute-continuity claims."],
        ["collision-entropy-growth-obstruction", "collision/entropy growth obstruction", "Measure collisions and entropy growth as the obstruction to propagating regularity through the conductance recursion."]
      ],
      regimes: [
        ["bounded-non-deterministic-surviving-child-law", "bounded non-deterministic surviving-child law", "Offspring law has bounded non-deterministic surviving-child count."],
        ["p1-equals-0", "p1 = 0", "Exclude one-child survival as a simplifying regime for conductance recursion."],
        ["finite-support-finite-moment-variants", "finite support / finite moment variants", "Track finite support, finite moment, and finite exponential moment variants separately."]
      ],
      contract: ["galton-watson-conductance-regularity-under-explicit-offspring-assumptions", "Galton-Watson conductance regularity under explicit offspring assumptions", "Prove an honest conductance regularity theorem under stated offspring assumptions, keeping saturation and mass-loss blockers explicit."],
      spinout: ["nonlinear-smoothing-transform-regularity-via-finite-colour-skeleton-instability", "nonlinear smoothing-transform regularity via finite-colour skeleton instability", "Abstract the finite-colour skeleton mechanism away from Galton-Watson conductance and test it on nonlinear smoothing transforms."],
      snapshot: {
        title: "Galton-Watson conductance frontier after legacy import",
        snapshotMarkdown: "The strongest honest state is a conditional regularity program: finite-colour skeleton and endpoint-packet mechanisms look portable, but saturation and mass-loss remain live blockers.",
        strongestConditionalTheoremMarkdown: "Conductance regularity appears plausible under bounded non-deterministic offspring and additional hypotheses preventing saturation/mass loss.",
        activeBlockersMarkdown: "Saturation/mass-loss blocker; collision and entropy growth not yet fully controlled.",
        recommendedNextMovesMarkdown: "Separate offspring regimes, test endpoint packet control in the p1 = 0 regime, and look for a minimal counterexample to the convolution branch AC bridge."
      }
    }
  }
  if (project.slug === "robust-posterior-gittins-scheduling") {
    return {
      mechanisms: [
        ["signed-outward-drift-no-sliding-at-tie-surfaces", "signed outward drift / no-sliding at tie surfaces", "At policy tie surfaces, prove perturbations drift outward rather than sliding along ambiguous rank boundaries."],
        ["local-rectangular-ambiguity-stability", "local rectangular ambiguity stability", "Local rectangular ambiguity can preserve index/rank stability when perturbations remain confined to finite-support posterior laws."],
        ["robust-survival-envelope-exceptional-window-obstruction", "robust survival-envelope exceptional-window obstruction", "Survival-envelope ambiguity creates exceptional windows where smoothed ranks may fail outward-drift control."]
      ],
      regimes: [
        ["finite-support-posterior-laws", "finite-support posterior laws", "Posterior laws have finite support."],
        ["local-rectangular-ambiguity", "local rectangular ambiguity", "Ambiguity set is local and rectangular around the posterior model."],
        ["survival-envelope-ambiguity", "survival-envelope ambiguity", "Robustness is expressed through survival-envelope ambiguity."]
      ],
      contract: ["local-finite-support-robust-posterior-gittins-stability-theorem", "local finite-support robust posterior-Gittins stability theorem", "Prove local robust posterior-Gittins stability for finite-support posterior laws under explicit local rectangular ambiguity assumptions."],
      spinout: ["general-no-sliding-lemma-for-index-rank-policies", "general no-sliding lemma for index/rank policies", "Extract a general no-sliding lemma for tie surfaces in index/rank policies."],
      snapshot: {
        title: "Robust posterior-Gittins frontier after legacy import",
        snapshotMarkdown: "The strongest honest state is local finite-support stability. Signed outward drift is the central mechanism; robust smoothed rank outward-drift remains the main blocker.",
        strongestConditionalTheoremMarkdown: "Local finite-support robust posterior-Gittins stability looks plausible under local rectangular ambiguity.",
        activeBlockersMarkdown: "Robust smoothed rank outward-drift blocker; survival-envelope exceptional windows.",
        recommendedNextMovesMarkdown: "Prove the no-sliding lemma in the finite-support regime, then test survival-envelope exceptional windows as counterexamples."
      }
    }
  }
  return undefined
}

export async function buildLegacyDistillationPreview(workspaceId: string) {
  const projects = await prisma.project.findMany({ where: { workspaceId }, orderBy: { slug: "asc" } })
  const proposals = projects.flatMap((project) => {
    const seed = legacyProjectSeeds(project)
    if (!seed) return []
    return [{
      project: { id: project.id, slug: project.slug, title: project.title },
      mechanisms: seed.mechanisms.map(([slug, title, descriptionMarkdown]) => ({ slug, title, descriptionMarkdown, status: "active", maturity: "sketched" })),
      assumptionRegimes: seed.regimes.map(([slug, title, descriptionMarkdown]) => ({ slug, title, descriptionMarkdown, status: "active" })),
      theoremContracts: [{ slug: seed.contract[0], title: seed.contract[1], theoremStatementMarkdown: seed.contract[2], status: "active", confidence: "medium" }],
      spinoutCandidates: [{ slug: seed.spinout[0], title: seed.spinout[1], statementSketchMarkdown: seed.spinout[2], status: "plausible" }],
      frontierSnapshots: [{ ...seed.snapshot, source: "legacy_import" }],
      researchDeltas: [{ title: `${project.title}: legacy research delta`, sourceType: "legacy_import", sourceId: project.id, summaryMarkdown: seed.snapshot.snapshotMarkdown, whatChangedMarkdown: "Compressed legacy workstreams and reports into frontier objects without deleting original rows.", confidence: "medium" }]
    }]
  })
  const seedVault = {
    title: "Product condition cutoff in structured Markov chains",
    slug: "product-condition-cutoff-in-structured-markov-chains",
    status: "seed",
    statementSketchMarkdown: "Investigate product-condition cutoffs in structured Markov chains as a separate seed problem preserved from the vault.",
    whyInterestingMarkdown: "Potentially connects cutoff criteria, product chains, and structured stochastic dynamics."
  }
  return { workspaceId, generatedAt: new Date().toISOString(), proposals, seedVault }
}

function previewMarkdown(preview: Awaited<ReturnType<typeof buildLegacyDistillationPreview>>) {
  const sections = preview.proposals.map((item) => [
    `## ${item.project.title}`,
    "### Mechanisms",
    ...item.mechanisms.map((m) => `- ${m.title}: ${m.descriptionMarkdown}`),
    "### Assumption Regimes",
    ...item.assumptionRegimes.map((r) => `- ${r.title}: ${r.descriptionMarkdown}`),
    "### Theorem Contract",
    ...item.theoremContracts.map((c) => `- ${c.title}: ${c.theoremStatementMarkdown}`),
    "### Spinouts",
    ...item.spinoutCandidates.map((s) => `- ${s.title}: ${s.statementSketchMarkdown}`),
    "### Frontier Snapshot",
    item.frontierSnapshots[0]?.snapshotMarkdown ?? ""
  ].join("\n"))
  return [`# Legacy Distillation Preview`, `Generated: ${preview.generatedAt}`, ...sections, "## Seed Vault", `- ${preview.seedVault.title}: ${preview.seedVault.statementSketchMarkdown}`].join("\n\n")
}

export async function runLegacyDistillationPreview(input: { workspaceId: string; outputPath?: string }) {
  const preview = await buildLegacyDistillationPreview(input.workspaceId)
  const out = input.outputPath ?? path.join(process.cwd(), "artifacts", `legacy-distill-preview-${new Date().toISOString().replace(/[:.]/g, "-")}.md`)
  await fs.mkdir(path.dirname(out), { recursive: true })
  await fs.writeFile(out, previewMarkdown(preview), "utf8")
  return { outputPath: out, preview }
}

export async function runLegacyDistillationApply(input: { workspaceId: string; userId?: string }) {
  const preview = await buildLegacyDistillationPreview(input.workspaceId)
  const created: Record<string, number> = { mechanisms: 0, assumptionRegimes: 0, theoremContracts: 0, spinoutCandidates: 0, frontierSnapshots: 0, researchDeltas: 0, researchLinks: 0 }
  for (const item of preview.proposals) {
    for (const m of item.mechanisms) {
      await prisma.mechanism.upsert({ where: { workspaceId_slug: { workspaceId: input.workspaceId, slug: m.slug } }, update: {}, create: { workspaceId: input.workspaceId, projectId: item.project.id, ...m, createdByUserId: input.userId } as any })
      created.mechanisms++
    }
    for (const r of item.assumptionRegimes) {
      await prisma.assumptionRegime.upsert({ where: { workspaceId_slug: { workspaceId: input.workspaceId, slug: r.slug } }, update: {}, create: { workspaceId: input.workspaceId, projectId: item.project.id, ...r, createdByUserId: input.userId } as any })
      created.assumptionRegimes++
    }
    for (const c of item.theoremContracts) {
      await prisma.theoremContract.upsert({ where: { workspaceId_slug: { workspaceId: input.workspaceId, slug: c.slug } }, update: {}, create: { workspaceId: input.workspaceId, projectId: item.project.id, ...c, createdByUserId: input.userId } as any })
      created.theoremContracts++
    }
    for (const s of item.spinoutCandidates) {
      await prisma.spinoutCandidate.upsert({ where: { workspaceId_slug: { workspaceId: input.workspaceId, slug: s.slug } }, update: {}, create: { workspaceId: input.workspaceId, originProjectId: item.project.id, ...s, createdByUserId: input.userId } as any })
      created.spinoutCandidates++
    }
    const existingSnapshot = await prisma.researchFrontierSnapshot.findFirst({ where: { workspaceId: input.workspaceId, projectId: item.project.id, source: "legacy_import", title: item.frontierSnapshots[0].title } })
    if (!existingSnapshot) {
      await prisma.researchFrontierSnapshot.create({ data: { workspaceId: input.workspaceId, projectId: item.project.id, ...item.frontierSnapshots[0], createdByUserId: input.userId } })
      created.frontierSnapshots++
    }
    const existingDelta = await prisma.researchDelta.findFirst({ where: { workspaceId: input.workspaceId, projectId: item.project.id, sourceType: "legacy_import", sourceId: item.project.id, title: item.researchDeltas[0].title } })
    if (!existingDelta) {
      await prisma.researchDelta.create({ data: { workspaceId: input.workspaceId, projectId: item.project.id, ...item.researchDeltas[0], createdByUserId: input.userId } as any })
      created.researchDeltas++
    }
  }
  const seedProject = await prisma.project.findUnique({ where: { workspaceId_slug: { workspaceId: input.workspaceId, slug: preview.seedVault.slug } } })
  if (!seedProject) {
    await prisma.spinoutCandidate.upsert({ where: { workspaceId_slug: { workspaceId: input.workspaceId, slug: preview.seedVault.slug } }, update: {}, create: { workspaceId: input.workspaceId, ...preview.seedVault, createdByUserId: input.userId } as any })
    created.spinoutCandidates++
  }
  return { ok: true, created }
}
