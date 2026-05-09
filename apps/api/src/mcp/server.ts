import type { Request, Response } from "express"
import type { WorkspaceRole } from "@prisma/client"
import { scopes, hasPermission } from "../auth/scopes.js"
import { requireWorkspaceRole } from "../auth/permissions.js"
import { config } from "../config.js"
import { readResource, listResources } from "./resources.js"
import { createLeanProject, createLeanStub, leanCheck, leanGoal } from "./tools/leanTools.js"
import { quartzStatus, rebuildQuartz } from "./tools/siteTools.js"
import { getPrompt, listPrompts } from "./prompts.js"
import * as runtime from "../research/runtime.js"

type ToolContext = { userId: string; claimsScope?: string; permissions?: string[]; aud?: unknown; sub?: string; azp?: string; clientId?: string }
type JsonSchema = Record<string, unknown>

const objectSchema = (properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema => ({ type: "object", properties, required, additionalProperties: false })
const s = { type: "string" } as const
const n = { type: "number" } as const
const anyObj = { type: "object", additionalProperties: true } as const
const strArray = { type: "array", items: s } as const

type ToolDef = { name: string; description: string; scope: string; role: WorkspaceRole; inputSchema: JsonSchema }
const tool = (name: string, description: string, role: WorkspaceRole, inputSchema: JsonSchema, scope = scopes.maffAccess): ToolDef => ({ name, description, scope, role, inputSchema })
export const mcpServerVersion = "0.4.0-co-mathematician-runtime"

export const toolDefinitions: ToolDef[] = [
  tool("get_my_maff_context", "Recover where the user is up to. Infers the user's workspace, summarizes active projects, ready assignments, reports needing review, and suggested simple chat prompts.", "viewer", objectSchema({ workspace: s, project: s })),
  tool("claim_next_assignment", "No-id specialist entrypoint. Infers workspace and project, claims the next ready assignment by natural project name and optional role/kind, starts an AgentRun by default, and returns the briefing.", "editor", objectSchema({ workspace: s, project: s, role: s, kind: s, session_id: s, model: s, lease_minutes: n, start_run: { type: "boolean" } })),
  tool("claim_next_review", "No-id reviewer entrypoint. Infers workspace and project, finds the next report needing review, starts a HostileReviewer AgentRun by default, and returns a review-only briefing.", "editor", objectSchema({ workspace: s, project: s, session_id: s, model: s, lease_minutes: n, start_run: { type: "boolean" } })),

  tool("list_workspaces", "List workspaces visible to the authenticated user.", "viewer", objectSchema({})),
  tool("create_project", "Create a Maff research project. Projects coordinate approved goals and workstreams.", "editor", objectSchema({ workspace_id: s, title: s, area: s, statement: s, slug: s }, ["workspace_id", "title", "statement"])),
  tool("get_project", "Read a Maff project.", "viewer", objectSchema({ workspace_id: s, project_id: s }, ["workspace_id", "project_id"])),
  tool("list_projects", "List Maff projects in a workspace.", "viewer", objectSchema({ workspace_id: s }, ["workspace_id"])),
  tool("get_project_control_room", "Read the project control room: goals, workstreams, reviews, recent agent runs, key claims, gaps, and suggested next assignment.", "viewer", objectSchema({ workspace_id: s, project_id: s }, ["workspace_id", "project_id"])),
  tool("update_project_summary", "Update the Project Coordinator summary.", "editor", objectSchema({ workspace_id: s, project_id: s, coordinator_summary: s }, ["workspace_id", "project_id", "coordinator_summary"])),

  tool("propose_project_goal", "Propose an explicit project goal for user approval.", "editor", objectSchema({ workspace_id: s, project_id: s, title: s, statement: s, priority: n, success_criteria: strArray, dependencies: strArray }, ["workspace_id", "project_id", "title", "statement"])),
  tool("approve_project_goal", "Approve a proposed project goal so specialist workstreams may attach to it.", "editor", objectSchema({ workspace_id: s, goal_id: s }, ["workspace_id", "goal_id"])),
  tool("update_project_goal", "Patch a project goal.", "editor", objectSchema({ workspace_id: s, goal_id: s, patch: anyObj }, ["workspace_id", "goal_id", "patch"])),
  tool("list_project_goals", "List project goals.", "viewer", objectSchema({ workspace_id: s, project_id: s }, ["workspace_id", "project_id"])),

  tool("create_workstream", "Create a first-class role-bound workstream under an approved goal.", "editor", objectSchema({ workspace_id: s, project_id: s, goal_id: s, parent_workstream_id: s, title: s, kind: s, coordinator_role: s, priority: n, target_object_type: s, target_object_id: s, instructions: s, allowed_writes: strArray, forbidden_actions: strArray, success_criteria: strArray, review_policy: anyObj }, ["workspace_id", "project_id", "title", "kind", "instructions"])),
  tool("list_workstreams", "List workstreams.", "viewer", objectSchema({ workspace_id: s, project_id: s, status: s }, ["workspace_id"])),
  tool("get_workstream", "Read a workstream with reports, reviews, agent runs, messages, and artifacts.", "viewer", objectSchema({ workspace_id: s, workstream_id: s }, ["workspace_id", "workstream_id"])),
  tool("claim_agent_assignment", "Claim the next role-bound workstream assignment and receive a structured agent briefing.", "editor", objectSchema({ workspace_id: s, project_id: s, workstream_id: s, session_id: s, lease_minutes: n }, ["workspace_id", "session_id"])),
  tool("start_agent_run", "Start an AgentRun for a claimed workstream and return the exact briefing.", "editor", objectSchema({ workspace_id: s, workstream_id: s, session_id: s, model: s }, ["workspace_id", "workstream_id", "session_id"])),
  tool("get_agent_briefing", "Return the structured role briefing for a workstream.", "viewer", objectSchema({ workspace_id: s, workstream_id: s }, ["workspace_id", "workstream_id"])),
  tool("write_agent_observation", "Write a durable AgentMessage observation, blocker, handoff, or escalation.", "editor", objectSchema({ workspace_id: s, project_id: s, workstream_id: s, from_role: s, to_role: s, kind: s, body: s, artifact_refs: strArray }, ["workspace_id", "project_id", "from_role", "body"])),
  tool("mark_workstream_blocked", "Mark a workstream blocked with a durable blocker message.", "editor", objectSchema({ workspace_id: s, workstream_id: s, message: s }, ["workspace_id", "workstream_id", "message"])),
  tool("escalate_workstream", "Escalate a workstream to the Project Coordinator.", "editor", objectSchema({ workspace_id: s, workstream_id: s, message: s }, ["workspace_id", "workstream_id", "message"])),
  tool("request_workstream_revision", "Move a reviewed workstream to revision_required.", "editor", objectSchema({ workspace_id: s, workstream_id: s, message: s }, ["workspace_id", "workstream_id", "message"])),
  tool("approve_workstream", "Approve a workstream only after an approved ReviewRound exists.", "editor", objectSchema({ workspace_id: s, workstream_id: s }, ["workspace_id", "workstream_id"])),
  tool("complete_workstream", "Complete a workstream only after its review policy is satisfied.", "editor", objectSchema({ workspace_id: s, workstream_id: s }, ["workspace_id", "workstream_id"])),

  tool("create_or_update_workstream_report", "Create or update the primary report for a workstream.", "editor", objectSchema({ workspace_id: s, workstream_id: s, title: s, body_markdown: s, uncertainty_notes: strArray, linked_object_refs: strArray, artifact_refs: strArray }, ["workspace_id", "workstream_id", "title", "body_markdown"])),
  tool("submit_workstream_report", "Create/update a WorkstreamReport and submit it for mandatory review.", "editor", objectSchema({ workspace_id: s, workstream_id: s, title: s, body_markdown: s, uncertainty_notes: strArray, linked_object_refs: strArray, artifact_refs: strArray }, ["workspace_id", "workstream_id", "title", "body_markdown"])),
  tool("submit_report_for_review", "Submit an existing report for review.", "editor", {
    type: "object",
    properties: { workspace_id: s, report_id: s, workstream_id: s },
    required: ["workspace_id"],
    anyOf: [{ required: ["report_id"] }, { required: ["workstream_id"] }],
    additionalProperties: false
  }),
  tool("record_review_round", "Record a mandatory review verdict. Reviewer agents may create ReviewRound records only.", "editor", objectSchema({ workspace_id: s, workstream_id: s, report_id: s, target_object_type: s, target_object_id: s, reviewer_role: s, verdict: s, issues: strArray, required_changes: strArray, checked_refs: strArray, body_markdown: s, created_by_agent_run_id: s }, ["workspace_id", "workstream_id", "verdict", "body_markdown"])),
  tool("list_review_rounds", "List ReviewRound records for a workstream.", "viewer", objectSchema({ workspace_id: s, workstream_id: s }, ["workspace_id", "workstream_id"])),
  tool("get_report", "Read a WorkstreamReport with review history.", "viewer", objectSchema({ workspace_id: s, report_id: s }, ["workspace_id", "report_id"])),

  tool("create_math_object", "Create a typed mathematical object: definition, object, construction, or notation.", "editor", objectSchema({ workspace_id: s, project_id: s, type: s, title: s, statement_markdown: s, status: s, metadata: anyObj }, ["workspace_id", "project_id", "type", "title", "statement_markdown"])),
  tool("create_claim", "Create a typed Claim object in a project.", "editor", objectSchema({ workspace_id: s, project_id: s, title: s, statement: s, statement_markdown: s, kind: s, claim_kind: s, status: s, actor_role: s, metadata: anyObj, confidence: n }, ["workspace_id", "project_id", "title"])),
  tool("update_claim_status", "Update a typed Claim status, enforcing role restrictions such as ProofAttemptAgent cannot mark claims proved.", "editor", objectSchema({ workspace_id: s, claim_id: s, status: s, actor_role: s, reason: s }, ["workspace_id", "claim_id", "status"])),
  tool("create_proof_route", "Create a typed ProofRoute for a Claim.", "editor", objectSchema({ workspace_id: s, project_id: s, claim_id: s, title: s, strategy_markdown: s, required_lemmas: strArray, first_testable_step: s, kill_condition: s, status: s, created_by_workstream_id: s, workstream_id: s }, ["workspace_id", "project_id", "claim_id", "kill_condition"])),
  tool("create_proof_attempt", "Create a typed ProofAttempt object. Failed attempts are durable first-class records.", "editor", objectSchema({ workspace_id: s, project_id: s, claim_id: s, route_id: s, workstream_id: s, body_markdown: s, status: s, gap_summary: s }, ["workspace_id", "project_id", "claim_id", "body_markdown"])),
  tool("create_gap", "Create a typed Gap object.", "editor", objectSchema({ workspace_id: s, project_id: s, claim_id: s, proof_attempt_id: s, route_id: s, title: s, description_markdown: s, severity: s, status: s, suggested_resolution: s }, ["workspace_id", "project_id", "severity"])),
  tool("resolve_gap", "Resolve a typed Gap object.", "editor", objectSchema({ workspace_id: s, gap_id: s, suggested_resolution: s }, ["workspace_id", "gap_id"])),
  tool("create_counterexample", "Create a typed Counterexample object.", "editor", objectSchema({ workspace_id: s, project_id: s, claim_id: s, title: s, construction_markdown: s, status: s, verification_artifact_id: s }, ["workspace_id", "project_id", "claim_id", "title", "construction_markdown"])),
  tool("create_experiment", "Create a typed Experiment object.", "editor", objectSchema({ workspace_id: s, project_id: s, workstream_id: s, title: s, hypothesis_markdown: s, method_markdown: s, result_markdown: s, reproducibility: anyObj, status: s }, ["workspace_id", "project_id", "title", "hypothesis_markdown", "method_markdown"])),
  tool("create_paper", "Create a Paper literature object.", "editor", objectSchema({ workspace_id: s, project_id: s, title: s, authors: strArray, year: n, venue: s, url: s, arxiv_id: s, doi: s, notes_markdown: s }, ["workspace_id", "title"])),
  tool("create_known_result", "Create a KnownResult linked to a paper or project.", "editor", objectSchema({ workspace_id: s, project_id: s, paper_id: s, title: s, statement_markdown: s, applicability_markdown: s, status: s }, ["workspace_id", "title", "statement_markdown", "applicability_markdown"])),
  tool("create_assumption", "Create a typed Assumption object.", "editor", objectSchema({ workspace_id: s, project_id: s, statement_markdown: s, status: s, reason: s, owner: s, discharge_plan: s }, ["workspace_id", "project_id", "statement_markdown", "status", "reason"])),
  tool("create_formalization_target", "Create a typed FormalizationTarget.", "editor", objectSchema({ workspace_id: s, project_id: s, claim_id: s, proof_attempt_id: s, statement_markdown: s, feasibility: s, required_definitions: strArray, theorem_stub: s, status: s }, ["workspace_id", "project_id"])),
  tool("create_lean_theorem", "Create a typed LeanTheorem object.", "editor", objectSchema({ workspace_id: s, project_id: s, formalization_target_id: s, lean_name: s, proof_file: s, statement_markdown: s, status: s, has_sorry: { type: "boolean" }, has_axiom: { type: "boolean" } }, ["workspace_id", "project_id", "lean_name", "proof_file", "statement_markdown"])),
  tool("link_objects", "Create a typed GraphEdge between mathematical or coordination objects.", "editor", objectSchema({ workspace_id: s, project_id: s, source_type: s, source_id: s, target_type: s, target_id: s, edge_type: s, metadata: anyObj }, ["workspace_id", "source_type", "source_id", "target_type", "target_id", "edge_type"])),
  tool("get_object_graph", "Read the typed mathematical object graph.", "viewer", objectSchema({ workspace_id: s, project_id: s, source_type: s, source_id: s }, ["workspace_id"])),
  tool("search_research_objects", "Search typed Maff research objects.", "viewer", objectSchema({ workspace_id: s, project_id: s, query: s, type: s }, ["workspace_id"])),
  tool("create_artifact", "Register a durable artifact without arbitrary file writes.", "editor", objectSchema({ workspace_id: s, project_id: s, workstream_id: s, kind: s, title: s, uri: s, path: s, content_hash: s, metadata: anyObj, created_by_agent_run_id: s }, ["workspace_id", "project_id", "title"])),

  tool("create_lean_project", "Create a Lean project.", "editor", objectSchema({ workspace_id: s, project_name: s }, ["workspace_id", "project_name"])),
  tool("create_lean_stub", "Create a Lean theorem file and LeanTheorem record.", "editor", objectSchema({ workspace_id: s, formalization_target_id: s, theorem_statement: s, imports: strArray }, ["workspace_id", "formalization_target_id", "theorem_statement"])),
  tool("lean_check", "Run the Lean worker check for a typed LeanTheorem.", "editor", objectSchema({ workspace_id: s, lean_theorem_id: s }, ["workspace_id", "lean_theorem_id"])),
  tool("lean_goal", "Read a Lean goal if supported.", "editor", objectSchema({ workspace_id: s, lean_file_id: s, position: anyObj }, ["workspace_id", "lean_file_id", "position"])),
  tool("mark_lean_verified", "Conservatively mark a typed LeanTheorem verified only if latest check succeeds and no sorry/axiom/unproved assumptions remain.", "editor", objectSchema({ workspace_id: s, lean_theorem_id: s }, ["workspace_id", "lean_theorem_id"])),

  tool("rebuild_quartz_site", "Build a workspace Quartz site from current rendered research artifacts.", "editor", objectSchema({ workspace_id: s }, ["workspace_id"])),
  tool("get_quartz_site_status", "Read latest Quartz build status.", "viewer", objectSchema({ workspace_id: s }, ["workspace_id"]))
]

const toolByName = new Map(toolDefinitions.map((definition) => [definition.name, definition]))

function wwwAuthenticate(required: string) {
  return `Bearer resource_metadata="${config.publicBaseUrl}/.well-known/oauth-protected-resource", error="insufficient_scope", error_description="Missing required scope ${required}", scope="${required}"`
}

function insufficientScopeError(required: string, ctx: ToolContext, toolName: string) {
  console.warn("MCP missing scope", { required, scope: ctx.claimsScope, permissions: ctx.permissions, aud: ctx.aud, sub: ctx.sub, azp: ctx.azp, client_id: ctx.clientId, tool: toolName })
  return Object.assign(new Error(`Missing required scope ${required}`), { status: 403, required, wwwAuthenticate: wwwAuthenticate(required) })
}

async function authorize(ctx: ToolContext, toolName: string, workspaceId?: string) {
  const definition = toolByName.get(toolName)
  if (!definition) throw new Error(`Unknown tool: ${toolName}`)
  if (!hasPermission({ scopeText: ctx.claimsScope, permissions: ctx.permissions, required: definition.scope })) {
    throw insufficientScopeError(definition.scope, ctx, toolName)
  }
  if (workspaceId) await requireWorkspaceRole(ctx.userId, workspaceId, definition.role)
}

function workspaceIdFrom(args: any) {
  return args?.workspace_id ?? args?.workspaceId
}

async function callTool(toolName: string, args: any, ctx: ToolContext) {
  await authorize(ctx, toolName, workspaceIdFrom(args))
  const workspaceId = workspaceIdFrom(args)
  const userId = ctx.userId
  switch (toolName) {
    case "get_my_maff_context": return runtime.getMyMaffContext({ userId, workspaceRef: args.workspace, project: args.project })
    case "claim_next_assignment": return runtime.claimNextAssignment({ userId, workspaceRef: args.workspace, project: args.project, role: args.role, kind: args.kind, sessionId: args.session_id, model: args.model, leaseMinutes: args.lease_minutes, startRun: args.start_run })
    case "claim_next_review": return runtime.claimNextReview({ userId, workspaceRef: args.workspace, project: args.project, sessionId: args.session_id, model: args.model, leaseMinutes: args.lease_minutes, startRun: args.start_run })
    case "list_workspaces": return runtime.listWorkspacesForUser(userId)
    case "create_project": return runtime.createProject({ workspaceId, slug: args.slug, title: args.title, area: args.area, statement: args.statement, userId })
    case "get_project": return runtime.getProject(workspaceId, args.project_id)
    case "list_projects": return runtime.listProjects(workspaceId)
    case "get_project_control_room": return runtime.getProjectControlRoom(workspaceId, args.project_id)
    case "update_project_summary": return runtime.updateProjectSummary({ workspaceId, projectId: args.project_id, coordinatorSummary: args.coordinator_summary })
    case "propose_project_goal": return runtime.proposeProjectGoal({ workspaceId, projectId: args.project_id, title: args.title, statement: args.statement, priority: args.priority, successCriteria: args.success_criteria, dependencies: args.dependencies })
    case "approve_project_goal": return runtime.approveProjectGoal({ workspaceId, goalId: args.goal_id, userId })
    case "update_project_goal": return runtime.updateProjectGoal({ workspaceId, goalId: args.goal_id, patch: args.patch })
    case "list_project_goals": return runtime.listProjectGoals(workspaceId, args.project_id)
    case "create_workstream": return runtime.createWorkstream({ workspaceId, projectId: args.project_id, goalId: args.goal_id, parentWorkstreamId: args.parent_workstream_id, title: args.title, kind: args.kind, coordinatorRole: args.coordinator_role, priority: args.priority, targetObjectType: args.target_object_type, targetObjectId: args.target_object_id, instructions: args.instructions, allowedWrites: args.allowed_writes, forbiddenActions: args.forbidden_actions, successCriteria: args.success_criteria, reviewPolicy: args.review_policy })
    case "list_workstreams": return runtime.listWorkstreams({ workspaceId, projectId: args.project_id, status: args.status })
    case "get_workstream": return runtime.getWorkstream(workspaceId, args.workstream_id)
    case "claim_agent_assignment": return runtime.claimAgentAssignment({ workspaceId, projectId: args.project_id, workstreamId: args.workstream_id, sessionId: args.session_id, userId, leaseMinutes: args.lease_minutes })
    case "start_agent_run": return runtime.startAgentRun({ workspaceId, workstreamId: args.workstream_id, sessionId: args.session_id, model: args.model })
    case "get_agent_briefing": return runtime.getAgentBriefing(workspaceId, args.workstream_id)
    case "write_agent_observation": return runtime.writeAgentObservation({ workspaceId, projectId: args.project_id, workstreamId: args.workstream_id, fromRole: args.from_role, toRole: args.to_role, kind: args.kind, body: args.body, artifactRefs: args.artifact_refs })
    case "create_or_update_workstream_report": return runtime.createOrUpdateWorkstreamReport({ workspaceId, workstreamId: args.workstream_id, title: args.title, bodyMarkdown: args.body_markdown, uncertaintyNotes: args.uncertainty_notes, linkedObjectRefs: args.linked_object_refs, artifactRefs: args.artifact_refs })
    case "submit_workstream_report": return runtime.submitWorkstreamReport({ workspaceId, workstreamId: args.workstream_id, title: args.title, bodyMarkdown: args.body_markdown, uncertaintyNotes: args.uncertainty_notes, linkedObjectRefs: args.linked_object_refs, artifactRefs: args.artifact_refs })
    case "mark_workstream_blocked": return runtime.markWorkstreamBlocked({ workspaceId, workstreamId: args.workstream_id, message: args.message })
    case "escalate_workstream": return runtime.escalateWorkstream({ workspaceId, workstreamId: args.workstream_id, message: args.message })
    case "request_workstream_revision": return runtime.requestWorkstreamRevision({ workspaceId, workstreamId: args.workstream_id, message: args.message })
    case "approve_workstream": return runtime.approveWorkstream({ workspaceId, workstreamId: args.workstream_id })
    case "complete_workstream": return runtime.completeWorkstream({ workspaceId, workstreamId: args.workstream_id })
    case "submit_report_for_review": return runtime.submitReportForReview({ workspaceId, reportId: args.report_id, workstreamId: args.workstream_id })
    case "record_review_round": return runtime.recordReviewRound({ workspaceId, workstreamId: args.workstream_id, reportId: args.report_id, targetObjectType: args.target_object_type, targetObjectId: args.target_object_id, reviewerRole: args.reviewer_role, verdict: args.verdict, issues: args.issues, requiredChanges: args.required_changes, checkedRefs: args.checked_refs, bodyMarkdown: args.body_markdown, createdByAgentRunId: args.created_by_agent_run_id })
    case "list_review_rounds": return runtime.listReviewRounds(workspaceId, args.workstream_id)
    case "get_report": return runtime.getReport(workspaceId, args.report_id)
    case "create_math_object": return runtime.createMathObject({ workspaceId, projectId: args.project_id, type: args.type, title: args.title, statementMarkdown: args.statement_markdown, status: args.status, metadata: args.metadata })
    case "create_claim": return runtime.createClaim({ workspaceId, projectId: args.project_id, title: args.title, statementMarkdown: args.statement_markdown ?? args.statement, kind: args.claim_kind ?? args.kind, status: args.status, confidence: args.confidence, metadata: args.metadata, actorRole: args.actor_role })
    case "update_claim_status": return runtime.updateClaimStatus({ workspaceId, claimId: args.claim_id, status: args.status, actorRole: args.actor_role, reason: args.reason })
    case "create_proof_route": return runtime.createProofRoute({ workspaceId, projectId: args.project_id, claimId: args.claim_id, title: args.title, strategyMarkdown: args.strategy_markdown, requiredLemmas: args.required_lemmas, firstTestableStep: args.first_testable_step, killCondition: args.kill_condition, status: args.status, createdByWorkstreamId: args.created_by_workstream_id ?? args.workstream_id })
    case "create_proof_attempt": return runtime.createProofAttempt({ workspaceId, projectId: args.project_id, claimId: args.claim_id, routeId: args.route_id, workstreamId: args.workstream_id, bodyMarkdown: args.body_markdown, status: args.status, gapSummary: args.gap_summary })
    case "create_gap": return runtime.createGap({ workspaceId, projectId: args.project_id, claimId: args.claim_id, proofAttemptId: args.proof_attempt_id, routeId: args.route_id, title: args.title, descriptionMarkdown: args.description_markdown, severity: args.severity, status: args.status, suggestedResolution: args.suggested_resolution })
    case "resolve_gap": return runtime.resolveGap({ workspaceId, gapId: args.gap_id, suggestedResolution: args.suggested_resolution })
    case "create_counterexample": return runtime.createCounterexample({ workspaceId, projectId: args.project_id, claimId: args.claim_id, title: args.title, constructionMarkdown: args.construction_markdown, status: args.status, verificationArtifactId: args.verification_artifact_id })
    case "create_experiment": return runtime.createExperiment({ workspaceId, projectId: args.project_id, workstreamId: args.workstream_id, title: args.title, hypothesisMarkdown: args.hypothesis_markdown, methodMarkdown: args.method_markdown, resultMarkdown: args.result_markdown, reproducibility: args.reproducibility, status: args.status })
    case "create_paper": return runtime.createPaper({ workspaceId, projectId: args.project_id, title: args.title, authors: args.authors, year: args.year, venue: args.venue, url: args.url, arxivId: args.arxiv_id, doi: args.doi, notesMarkdown: args.notes_markdown })
    case "create_known_result": return runtime.createKnownResult({ workspaceId, projectId: args.project_id, paperId: args.paper_id, title: args.title, statementMarkdown: args.statement_markdown, applicabilityMarkdown: args.applicability_markdown, status: args.status })
    case "create_assumption": return runtime.createAssumption({ workspaceId, projectId: args.project_id, statementMarkdown: args.statement_markdown, status: args.status, reason: args.reason, owner: args.owner, dischargePlan: args.discharge_plan })
    case "create_formalization_target": return runtime.createFormalizationTarget({ workspaceId, projectId: args.project_id, claimId: args.claim_id, proofAttemptId: args.proof_attempt_id, statementMarkdown: args.statement_markdown, theoremStub: args.theorem_stub, requiredDefinitions: args.required_definitions, feasibility: args.feasibility, status: args.status })
    case "create_lean_theorem": return runtime.createLeanTheorem({ workspaceId, projectId: args.project_id, formalizationTargetId: args.formalization_target_id, leanName: args.lean_name, proofFile: args.proof_file, statementMarkdown: args.statement_markdown, status: args.status, hasSorry: args.has_sorry, hasAxiom: args.has_axiom })
    case "link_objects": return runtime.linkObjects({ workspaceId, projectId: args.project_id, sourceType: args.source_type, sourceId: args.source_id, targetType: args.target_type, targetId: args.target_id, edgeType: args.edge_type, metadata: args.metadata })
    case "get_object_graph": return runtime.getObjectGraph({ workspaceId, projectId: args.project_id, sourceType: args.source_type, sourceId: args.source_id })
    case "search_research_objects": return runtime.searchResearchObjects({ workspaceId, projectId: args.project_id, query: args.query, type: args.type })
    case "create_artifact": return runtime.createArtifact({ workspaceId, projectId: args.project_id, workstreamId: args.workstream_id, kind: args.kind, title: args.title, uri: args.uri, path: args.path, contentHash: args.content_hash, metadata: args.metadata, createdByAgentRunId: args.created_by_agent_run_id })
    case "create_lean_project": return createLeanProject({ workspaceId, projectName: args.project_name })
    case "create_lean_stub": return createLeanStub({ workspaceId, formalizationTargetId: args.formalization_target_id, theoremStatement: args.theorem_statement, imports: args.imports, userId })
    case "lean_check": return leanCheck({ workspaceId, leanTheoremId: args.lean_theorem_id, userId })
    case "lean_goal": return leanGoal({ workspaceId, leanFileId: args.lean_file_id, position: args.position })
    case "mark_lean_verified": return runtime.markLeanVerified({ workspaceId, leanTheoremId: args.lean_theorem_id })
    case "rebuild_quartz_site": return rebuildQuartz(workspaceId, userId)
    case "get_quartz_site_status": return quartzStatus(workspaceId)
    default: throw new Error(`Unknown tool: ${toolName}`)
  }
}

function contentResult(value: unknown) {
  return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] }
}

function resourceResult(uri: string, value: unknown) {
  return { contents: [{ uri, mimeType: "application/json", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] }
}

function toolForList(definition: ToolDef) {
  const securitySchemes = [{ type: "oauth2", scopes: [definition.scope] }]
  return {
    name: definition.name,
    description: definition.description,
    inputSchema: definition.inputSchema,
    input_schema: definition.inputSchema,
    securitySchemes,
    _meta: { securitySchemes }
  }
}

export function mcpToolsListResult() {
  return { tools: toolDefinitions.map(toolForList) }
}

export async function mcpHandler(req: Request, res: Response) {
  try {
    if (!req.auth) return res.status(401).json({ error: "missing_token" })
    const { id, method, params } = req.body ?? {}
    const ctx: ToolContext = {
      userId: req.auth.user.id,
      claimsScope: req.auth.claims.scope,
      permissions: req.auth.claims.permissions,
      aud: req.auth.claims.aud,
      sub: req.auth.claims.sub,
      azp: typeof req.auth.claims.azp === "string" ? req.auth.claims.azp : undefined,
      clientId: typeof req.auth.claims.client_id === "string" ? req.auth.claims.client_id : undefined
    }
    const resourceCtx = { userId: req.auth.user.id, claims: req.auth.claims }
    if (method === "initialize") return res.json({ jsonrpc: "2.0", id, result: { protocolVersion: "2024-11-05", serverInfo: { name: "Maff", version: mcpServerVersion }, capabilities: { tools: { listChanged: true }, resources: {}, prompts: {} } } })
    if (method === "tools/list") return res.json({ jsonrpc: "2.0", id, result: mcpToolsListResult() })
    if (method === "tools/call") return res.json({ jsonrpc: "2.0", id, result: contentResult(await callTool(params.name, params.arguments ?? {}, ctx)) })
    if (method === "resources/list") return res.json({ jsonrpc: "2.0", id, result: await listResources(resourceCtx) })
    if (method === "resources/read") return res.json({ jsonrpc: "2.0", id, result: resourceResult(params.uri, await readResource(params.uri, resourceCtx)) })
    if (method === "prompts/list") {
      const prompts = await listPrompts()
      return res.json({ jsonrpc: "2.0", id, result: { prompts: prompts.map((name) => ({ name, description: `Maff role recipe or prompt: ${name}` })) } })
    }
    if (method === "prompts/get") {
      const text = await getPrompt(params.name)
      return res.json({ jsonrpc: "2.0", id, result: { description: `Maff role recipe or prompt: ${params.name}`, messages: [{ role: "user", content: { type: "text", text } }] } })
    }
    return res.json({ jsonrpc: "2.0", id, result: { ok: true } })
  } catch (error) {
    const err = error as Error & { status?: number; wwwAuthenticate?: string }
    if (err.wwwAuthenticate) res.setHeader("WWW-Authenticate", err.wwwAuthenticate)
    res.status(err.status ?? 400).json({
      jsonrpc: "2.0",
      id: req.body?.id,
      error: {
        message: err.message,
        data: err.wwwAuthenticate ? { _meta: { "mcp/www_authenticate": err.wwwAuthenticate } } : undefined
      }
    })
  }
}
