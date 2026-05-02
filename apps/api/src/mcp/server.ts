import type { Request, Response } from "express"
import type { WorkspaceRole } from "@prisma/client"
import { scopes, hasPermission } from "../auth/scopes.js"
import { requireWorkspaceRole } from "../auth/permissions.js"
import { config } from "../config.js"
import { readResource, listResources } from "./resources.js"
import { listWorkspaces, maffBootstrap, startResearchSession, startWorkflow } from "./tools/sessionTools.js"
import { getActiveRoutes, getNeighbors, getOpenGaps, getStaleNodes, searchNodes } from "./tools/graphTools.js"
import { appendToNodeTool, createNodeTool, getNode, linkNodesTool, replaceNodeSectionTool, setNodeStatus, updateNodeMetadataTool } from "./tools/nodeTools.js"
import { claimTask, completeTask, createTask, getNextTask, heartbeatTask, releaseTask, snoozeTask } from "./tools/taskTools.js"
import { addInformalProofToClaim, addInlineGapToClaim, addRouteToClaim, appendProofAttemptToClaim, archiveNode, completeWorkflow, computeClaimReadiness, createClaim, createConjecture, createGap, createProblem, createProofRoute, createRichClaim, decomposeClaim, decomposeClaimRich, logProofAttempt, promoteInlineSubclaimToClaim, promoteInlineSubclaimToClaimRich, promoteRouteToNode, researchExtras, updateClaimLeanStatus, updateClaimLeanStatusWithReason, updateClaimMetadata, updateClaimProofStatus, updateClaimRoute } from "./tools/researchTools.js"
import { createFormalizationTarget, createLeanProject, createLeanStub, leanCheck, leanExtras, leanGoal } from "./tools/leanTools.js"
import { quartzStatus, rebuildIndex, rebuildQuartz } from "./tools/siteTools.js"
import { getSkillPack } from "../skills/skillRouter.js"
import { getPrompt, listPrompts } from "./prompts.js"

type ToolContext = { userId: string; claimsScope?: string; permissions?: string[]; aud?: unknown; sub?: string; azp?: string; clientId?: string }
type JsonSchema = Record<string, unknown>

const objectSchema = (properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema => ({ type: "object", properties, required, additionalProperties: false })
const s = { type: "string" } as const
const n = { type: "number" } as const
const anyObj = { type: "object", additionalProperties: true } as const
const strArray = { type: "array", items: s } as const
const strOrArray = { oneOf: [s, strArray] } as const

type ToolDef = { name: string; description: string; scope: string; role: WorkspaceRole; inputSchema: JsonSchema }
const tool = (name: string, description: string, role: WorkspaceRole, inputSchema: JsonSchema, scope = scopes.maffAccess): ToolDef => ({ name, description, scope, role, inputSchema })

export const toolDefinitions: ToolDef[] = [
  tool("list_workspaces", "List workspaces visible to the authenticated user.", "viewer", objectSchema({})),
  tool("maff_bootstrap", "Use this first whenever the user wants to create, save, resume, or work on anything in Maff. This tool resolves the workspace/problem/task, detects the scenario, chooses the workflow, returns the relevant prompt, skills, graph context, queue decision, and suggested next tools.", "viewer", objectSchema({ workspace_id: s, node_ref: s, user_goal: s, workflow_type: s, mode: s, create_if_missing: { type: "boolean" }, title: s, area: s, rough_statement: s }, [])),
  tool("start_research_session", "Resolve a node or task and return recommended workflow context.", "viewer", objectSchema({ workspace_id: s, node_ref: s, user_goal: s }, ["workspace_id"])),
  tool("start_workflow", "Start a named workflow for a node.", "viewer", objectSchema({ workspace_id: s, workflow_type: s, node_id: s }, ["workspace_id", "workflow_type", "node_id"])),
  tool("list_prompts", "List available Maff workflow prompts. Normally call maff_bootstrap first unless the user explicitly asks for prompt names.", "viewer", objectSchema({})),
  tool("get_prompt", "Read a Maff workflow prompt by name. Normally call maff_bootstrap first unless the user explicitly asks for this exact prompt.", "viewer", objectSchema({ name: s }, ["name"])),
  tool("get_skill_pack", "Return compact skills relevant to a workflow and node.", "viewer", objectSchema({ workspace_id: s, node_id: s, workflow_type: s }, ["workspace_id", "workflow_type"])),
  tool("search_nodes", "Search indexed research nodes.", "viewer", objectSchema({ workspace_id: s, query: s, filters: anyObj }, ["workspace_id"])),
  tool("get_node", "Read a parsed Markdown node.", "viewer", objectSchema({ workspace_id: s, node_id: s }, ["workspace_id", "node_id"])),
  tool("get_neighbors", "Read local graph neighbors for a node.", "viewer", objectSchema({ workspace_id: s, node_id: s, depth: n, edge_types: strArray }, ["workspace_id", "node_id"])),
  tool("get_open_gaps", "Read open gaps, optionally scoped to a problem or target.", "viewer", objectSchema({ workspace_id: s, problem_id: s }, ["workspace_id"])),
  tool("get_active_routes", "Read active proof routes.", "viewer", objectSchema({ workspace_id: s, problem_id: s }, ["workspace_id"])),
  tool("get_stale_nodes", "Read stale indexed nodes.", "viewer", objectSchema({ workspace_id: s, days: n }, ["workspace_id", "days"])),
  tool("create_node", "Create a safe Markdown node.", "editor", objectSchema({ workspace_id: s, type: s, title: s, metadata: anyObj, body: s }, ["workspace_id", "type", "title"])),
  tool("append_to_node", "Append content to a Markdown section.", "editor", objectSchema({ workspace_id: s, node_id: s, section: s, content: s }, ["workspace_id", "node_id", "section", "content"])),
  tool("replace_node_section", "Replace one Markdown section after backing up the file.", "editor", objectSchema({ workspace_id: s, node_id: s, section: s, content: s }, ["workspace_id", "node_id", "section", "content"])),
  tool("update_node_metadata", "Patch YAML/frontmatter metadata for a node, then reindex it.", "editor", objectSchema({ workspace_id: s, node_id: s, patch: anyObj }, ["workspace_id", "node_id", "patch"])),
  tool("link_nodes", "Add a typed link between nodes.", "editor", objectSchema({ workspace_id: s, source_node_id: s, target_node_id: s, edge_type: s, note: s }, ["workspace_id", "source_node_id", "target_node_id", "edge_type"])),
  tool("set_node_status", "Set node status and append a decision log entry.", "editor", objectSchema({ workspace_id: s, node_id: s, status: s, reason: s }, ["workspace_id", "node_id", "status", "reason"])),
  tool("create_problem", "Create a Problem node.", "editor", objectSchema({ workspace_id: s, title: s, area: s, rough_statement: s, motivation: s, initial_sources: strArray }, ["workspace_id", "title", "area", "rough_statement", "motivation"])),
  tool("create_claim", "Create a rich Claim node for a theorem, conjecture, lemma, proposition, reduction, or counterexample statement. Normally call maff_bootstrap first unless the user explicitly supplied a workspace_id and requested this exact operation.", "editor", objectSchema({ workspace_id: s, problem_id: s, title: s, statement: s, motivation: s, claim_kind: s, role: s, claim_status: s, proof_status: s, lean_status: s, depends_on: strArray, supports: strArray, blocked_by: strArray, area: s, short_title: s, body_sections: anyObj, confidence: n }, ["workspace_id", "title", "statement", "claim_kind", "role"])),
  tool("create_conjecture", "Alias for create_claim with claim_kind=conjecture.", "editor", objectSchema({ workspace_id: s, problem_id: s, statement: s, motivation: s, confidence: n }, ["workspace_id", "problem_id", "statement", "motivation", "confidence"])),
  tool("create_theorem_candidate", "Alias for create_claim with claim_kind=theorem.", "editor", objectSchema({ workspace_id: s, problem_id: s, statement: s, motivation: s, confidence: n }, ["workspace_id", "statement"])),
  tool("create_lemma_candidate", "Alias for create_claim with claim_kind=lemma.", "editor", objectSchema({ workspace_id: s, problem_id: s, statement: s, motivation: s, confidence: n }, ["workspace_id", "statement"])),
  tool("add_route_to_claim", "Add a structured proof route inside a Claim note. Routes stay inline by default and do not become graph nodes.", "editor", objectSchema({ workspace_id: s, claim_id: s, route_title: s, status: s, confidence: s, method: s, strategy: s, proposed_decomposition: strOrArray, blockers: strOrArray }, ["workspace_id", "claim_id", "route_title", "status", "strategy"])),
  tool("update_claim_route", "Append an update to a structured route inside a Claim note.", "editor", objectSchema({ workspace_id: s, claim_id: s, route_title_or_id: s, patch: anyObj }, ["workspace_id", "claim_id", "route_title_or_id", "patch"])),
  tool("promote_route_to_node", "Promote an inline route to a standalone ProofRoute node only when it is substantial or explicitly requested.", "editor", objectSchema({ workspace_id: s, claim_id: s, route_title_or_id: s, reason: s }, ["workspace_id", "claim_id", "route_title_or_id"])),
  tool("update_claim_metadata", "Patch Claim frontmatter and append a decision-log entry.", "editor", objectSchema({ workspace_id: s, claim_id: s, patch: anyObj }, ["workspace_id", "claim_id", "patch"])),
  tool("update_claim_proof_status", "Update proof_status and optionally claim_status on a Claim, with a decision-log reason.", "editor", objectSchema({ workspace_id: s, claim_id: s, proof_status: s, claim_status: s, reason: s }, ["workspace_id", "claim_id", "proof_status", "reason"])),
  tool("add_informal_proof_to_claim", "Replace the Claim's Informal proof section and update proof status.", "editor", objectSchema({ workspace_id: s, claim_id: s, proof: s, remaining_caveats: strArray }, ["workspace_id", "claim_id", "proof"])),
  tool("update_claim_lean_status", "Update the Claim's Lean formalization section and Lean metadata.", "editor", objectSchema({ workspace_id: s, claim_id: s, lean_status: s, lean_file: s, lean_name: s, diagnostics: s, notes: s, reason: s }, ["workspace_id", "claim_id", "lean_status"])),
  tool("decompose_claim", "Decompose a Claim into inline subclaims and/or new supporting Claim nodes.", "editor", objectSchema({ workspace_id: s, claim_id: s, route_title_or_id: s, subclaims: { type: "array", items: anyObj } }, ["workspace_id", "claim_id", "subclaims"])),
  tool("promote_inline_subclaim_to_claim", "Promote a nontrivial inline subclaim to its own Claim node and link it as a dependency.", "editor", objectSchema({ workspace_id: s, parent_claim_id: s, section: s, item_text: s, title: s, statement: s, claim_kind: s, role: s, reason: s }, ["workspace_id", "parent_claim_id", "title", "statement"])),
  tool("append_proof_attempt_to_claim", "Append a proof attempt inside a Claim or route section. ProofAttempt nodes are not created by default.", "editor", objectSchema({ workspace_id: s, claim_id: s, route_title_or_id: s, summary: s, result: s, details: s, next_steps: strArray }, ["workspace_id", "claim_id", "summary", "result"])),
  tool("add_inline_gap_to_claim", "Append a minor or local gap inside a Claim. Major blockers should become Claim nodes when they are clean mathematical statements.", "editor", objectSchema({ workspace_id: s, claim_id: s, route_title_or_id: s, severity: s, statement: s, possible_resolutions: strArray }, ["workspace_id", "claim_id", "severity", "statement"])),
  tool("compute_claim_readiness", "Compute proof/Lean readiness for a Claim.", "viewer", objectSchema({ workspace_id: s, claim_id: s }, ["workspace_id", "claim_id"])),
  tool("create_proof_route", "Compatibility alias: add a route inside the target Claim instead of creating a ProofRoute node by default.", "editor", objectSchema({ workspace_id: s, target_node_id: s, method: s, plan: s, kill_condition: s }, ["workspace_id", "target_node_id", "method", "plan", "kill_condition"])),
  tool("log_proof_attempt", "Append a proof attempt to the target Claim instead of creating a ProofAttempt node by default.", "editor", objectSchema({ workspace_id: s, target_node_id: s, route_node_id: s, summary: s, result: s, failure_reason: s, new_gaps: strArray }, ["workspace_id", "target_node_id", "summary", "result"])),
  tool("create_gap", "Append a gap to the target Claim instead of creating a Gap node by default.", "editor", objectSchema({ workspace_id: s, target_node_id: s, statement: s, severity: s, possible_resolutions: strArray }, ["workspace_id", "target_node_id", "statement", "severity"])),
  tool("create_task", "Create an operational queue task attached to a target node or section. Tasks do not appear as graph nodes.", "editor", objectSchema({ workspace_id: s, target_node_id: s, target_section: s, workflow: s, workflow_type: s, title: s, priority: n, instructions: s }, ["workspace_id", "target_node_id", "priority", "instructions"])),
  tool("get_next_task", "Read the next queued task, optionally scoped to a target node.", "viewer", objectSchema({ workspace_id: s, target_node_id: s }, ["workspace_id"])),
  tool("claim_task", "Claim a task with a lease. Normally call maff_bootstrap first unless the user explicitly supplied a workspace_id/task_id and requested this exact operation.", "editor", objectSchema({ workspace_id: s, task_id: s, claimed_session_id: s, workflow: s }, ["workspace_id"])),
  tool("heartbeat_task", "Extend a claimed task lease. Normally call maff_bootstrap first unless the user explicitly supplied a workspace_id/task_id and requested this exact operation.", "editor", objectSchema({ workspace_id: s, task_id: s, claimed_session_id: s, workflow: s }, ["workspace_id", "task_id"])),
  tool("complete_task", "Complete a task.", "editor", objectSchema({ workspace_id: s, task_id: s, claimed_session_id: s, outcome_summary: s }, ["workspace_id", "task_id", "outcome_summary"])),
  tool("release_task", "Release a claimed task back to the open queue. Normally call maff_bootstrap first unless the user explicitly supplied a workspace_id/task_id and requested this exact operation.", "editor", objectSchema({ workspace_id: s, task_id: s, claimed_session_id: s, reason: s }, ["workspace_id", "task_id"])),
  tool("snooze_task", "Snooze a task.", "editor", objectSchema({ workspace_id: s, task_id: s, reason: s, until: s }, ["workspace_id", "task_id", "reason"])),
  tool("archive_node", "Safely archive a node by marking it archived/killed and appending a decision-log entry. This is not a hard delete.", "editor", objectSchema({ workspace_id: s, node_id: s, reason: s }, ["workspace_id", "node_id", "reason"])),
  tool("complete_workflow", "Append workflow result and create appropriate follow-up tasks.", "editor", objectSchema({ workspace_id: s, node_id: s, workflow_type: s, summary: s, graph_updates: anyObj }, ["workspace_id", "node_id", "workflow_type", "summary"])),
  tool("create_counterexample", "Create a Counterexample node. Normally call maff_bootstrap first unless the user explicitly supplied a workspace_id/node_id and requested this exact operation.", "editor", objectSchema({ workspace_id: s, target_node_id: s, construction: s, explanation: s, artifacts: strArray }, ["workspace_id", "target_node_id", "construction", "explanation"])),
  tool("create_experiment", "Create an Experiment node. Normally call maff_bootstrap first unless the user explicitly supplied a workspace_id/node_id and requested this exact operation.", "editor", objectSchema({ workspace_id: s, problem_id: s, title: s, hypothesis: s, code_ref: s, parameters: anyObj }, ["workspace_id", "problem_id", "title", "hypothesis"])),
  tool("log_experiment_result", "Log an Experiment result. Normally call maff_bootstrap first unless the user explicitly supplied a workspace_id/experiment_id and requested this exact operation.", "editor", objectSchema({ workspace_id: s, experiment_id: s, result_summary: s, artifacts: strArray, implications: s }, ["workspace_id", "experiment_id", "result_summary"])),
  tool("create_literature_source", "Create a Paper literature source node. Normally call maff_bootstrap first unless the user explicitly supplied a workspace_id and requested this exact operation.", "editor", objectSchema({ workspace_id: s, title: s, authors: strArray, year: n, citation: s, relevance: s, notes: s }, ["workspace_id", "title", "authors", "year", "citation", "relevance", "notes"])),
  tool("mark_claim_novelty", "Append a novelty verdict to a claim. Normally call maff_bootstrap first unless the user explicitly supplied a workspace_id/claim_id and requested this exact operation.", "editor", objectSchema({ workspace_id: s, claim_id: s, novelty_status: s, evidence: s }, ["workspace_id", "claim_id", "novelty_status", "evidence"])),
  tool("promote_to_theorem_candidate", "Promote a conjecture toward theorem-candidate status. Normally call maff_bootstrap first unless the user explicitly supplied ids and requested this exact operation.", "editor", objectSchema({ workspace_id: s, conjecture_id: s, theorem_statement: s, reason: s }, ["workspace_id", "conjecture_id", "reason"])),
  tool("promote_to_informal_proof", "Create an InformalProof node from a proof candidate. Normally call maff_bootstrap first unless the user explicitly supplied ids and requested this exact operation.", "editor", objectSchema({ workspace_id: s, claim_id: s, proof_node_body: s, remaining_caveats: strArray }, ["workspace_id", "claim_id", "proof_node_body"])),
  tool("pause_project", "Pause a project without deleting it. Normally call maff_bootstrap first unless the user explicitly supplied ids and requested this exact operation.", "owner", objectSchema({ workspace_id: s, node_id: s, reason: s, revival_trigger: s }, ["workspace_id", "node_id", "reason", "revival_trigger"])),
  tool("kill_project", "Mark a project killed without deleting it. Normally call maff_bootstrap first unless the user explicitly supplied ids and requested this exact operation.", "owner", objectSchema({ workspace_id: s, node_id: s, reason: s, salvage_value: s }, ["workspace_id", "node_id", "reason", "salvage_value"])),
  tool("rebuild_index", "Rebuild a workspace index.", "editor", objectSchema({ workspace_id: s }, ["workspace_id"])),
  tool("rebuild_quartz_site", "Build a workspace Quartz site.", "editor", objectSchema({ workspace_id: s }, ["workspace_id"])),
  tool("get_quartz_site_status", "Read latest Quartz build status.", "viewer", objectSchema({ workspace_id: s }, ["workspace_id"])),
  tool("create_formalization_target", "Create a FormalizationTarget node.", "editor", objectSchema({ workspace_id: s, informal_proof_id: s, lean_feasibility: s, required_definitions: strArray, theorem_stub: s }, ["workspace_id", "informal_proof_id", "lean_feasibility", "required_definitions"])),
  tool("create_lean_project", "Create a Lean project.", "editor", objectSchema({ workspace_id: s, project_name: s }, ["workspace_id", "project_name"])),
  tool("create_lean_stub", "Create a Lean theorem file and LeanTheorem node.", "editor", objectSchema({ workspace_id: s, formalization_target_id: s, theorem_statement: s, imports: strArray }, ["workspace_id", "formalization_target_id", "theorem_statement"])),
  tool("lean_check", "Run the Lean worker check for a LeanTheorem node.", "editor", objectSchema({ workspace_id: s, lean_file_id: s }, ["workspace_id", "lean_file_id"])),
  tool("lean_goal", "Read a Lean goal if supported.", "editor", objectSchema({ workspace_id: s, lean_file_id: s, position: anyObj }, ["workspace_id", "lean_file_id", "position"])),
  tool("lean_search_mathlib", "Search Mathlib or local notes for formalization hints.", "viewer", objectSchema({ workspace_id: s, query: s }, ["workspace_id", "query"])),
  tool("lean_multi_attempt", "Try multiple Lean tactics if supported by the worker. Normally call maff_bootstrap first unless the user explicitly supplied Lean ids.", "editor", objectSchema({ workspace_id: s, lean_file_id: s, position: anyObj, tactics: strArray }, ["workspace_id", "lean_file_id", "position", "tactics"])),
  tool("log_lean_attempt", "Log a Lean formalization attempt. Normally call maff_bootstrap first unless the user explicitly supplied formalization ids.", "editor", objectSchema({ workspace_id: s, formalization_target_id: s, result: s, diagnostics: anyObj, next_gap: s }, ["workspace_id", "formalization_target_id", "result", "diagnostics"])),
  tool("mark_lean_verified", "Conservatively mark a Lean theorem verified if latest check permits it.", "editor", objectSchema({ workspace_id: s, lean_theorem_node_id: s, file_ref: s, theorem_name: s }, ["workspace_id", "lean_theorem_node_id", "file_ref", "theorem_name"])),
  tool("create_assumption_entry", "Create a formalization assumption or axiom hygiene entry. Normally call maff_bootstrap first unless the user explicitly requested this exact operation.", "editor", objectSchema({ workspace_id: s, statement: s, reason: s, status: s }, ["workspace_id", "statement", "reason", "status"])),
  tool("create_local_theorem_library_entry", "Create a local Lean theorem library entry. Normally call maff_bootstrap first unless the user explicitly requested this exact operation.", "editor", objectSchema({ workspace_id: s, lean_theorem_name: s, statement: s, proof_file: s }, ["workspace_id", "lean_theorem_name", "statement", "proof_file"]))
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
  const required = definition?.scope ?? scopes.maffAccess
  if (!hasPermission({ scopeText: ctx.claimsScope, permissions: ctx.permissions, required })) {
    throw insufficientScopeError(required, ctx, toolName)
  }
  if (workspaceId) await requireWorkspaceRole(ctx.userId, workspaceId, definition?.role ?? "viewer")
}

function workspaceIdFrom(args: any) {
  return args?.workspace_id ?? args?.workspaceId
}

async function callTool(toolName: string, args: any, ctx: ToolContext) {
  await authorize(ctx, toolName, workspaceIdFrom(args))
  const workspaceId = workspaceIdFrom(args)
  const userId = ctx.userId
  switch (toolName) {
    case "list_workspaces": return listWorkspaces(userId)
    case "maff_bootstrap": return maffBootstrap({ userId, workspaceId, nodeRef: args.node_ref, userGoal: args.user_goal, workflowType: args.workflow_type, mode: args.mode, createIfMissing: args.create_if_missing, title: args.title, area: args.area, roughStatement: args.rough_statement })
    case "start_research_session": return startResearchSession({ userId, workspaceId, nodeRef: args.node_ref, userGoal: args.user_goal })
    case "start_workflow": return startWorkflow(workspaceId, args.node_id, args.workflow_type)
    case "list_prompts": return { prompts: await listPrompts() }
    case "get_prompt": return { name: args.name, text: await getPrompt(args.name) }
    case "get_skill_pack": return getSkillPack(workspaceId, args.node_id, args.workflow_type)
    case "search_nodes": return searchNodes(workspaceId, args.query, args.filters)
    case "get_node": return getNode(workspaceId, args.node_id)
    case "get_neighbors": return getNeighbors(workspaceId, args.node_id, args.depth, args.edge_types)
    case "get_open_gaps": return getOpenGaps(workspaceId, args.problem_id)
    case "get_active_routes": return getActiveRoutes(workspaceId, args.problem_id)
    case "get_stale_nodes": return getStaleNodes(workspaceId, args.days)
    case "create_node": return createNodeTool({ workspaceId, type: args.type, title: args.title, metadata: args.metadata, body: args.body, userId })
    case "update_node_metadata": return updateNodeMetadataTool({ workspaceId, nodeId: args.node_id, patch: args.patch, userId })
    case "append_to_node": return appendToNodeTool({ workspaceId, nodeId: args.node_id, section: args.section, content: args.content, userId })
    case "replace_node_section": return replaceNodeSectionTool({ workspaceId, nodeId: args.node_id, section: args.section, content: args.content, userId })
    case "link_nodes": return linkNodesTool({ workspaceId, sourceNodeId: args.source_node_id, targetNodeId: args.target_node_id, edgeType: args.edge_type, note: args.note, userId })
    case "set_node_status": return setNodeStatus({ workspaceId, nodeId: args.node_id, status: args.status, reason: args.reason, userId })
    case "create_problem": return createProblem({ workspaceId, title: args.title, area: args.area, roughStatement: args.rough_statement, motivation: args.motivation, initialSources: args.initial_sources, userId })
    case "create_claim": return createRichClaim({ workspaceId, problemId: args.problem_id, title: args.title, statement: args.statement, claimKind: args.claim_kind, role: args.role, claimStatus: args.claim_status, proofStatus: args.proof_status, leanStatus: args.lean_status, dependsOn: args.depends_on, supports: args.supports, blockedBy: args.blocked_by, area: args.area, shortTitle: args.short_title, bodySections: args.body_sections, userId })
    case "create_conjecture": return createConjecture({ workspaceId, problemId: args.problem_id, statement: args.statement, motivation: args.motivation, confidence: args.confidence, userId })
    case "create_theorem_candidate": return createClaim({ workspaceId, problemId: args.problem_id, statement: args.statement, motivation: args.motivation, claimKind: "theorem", role: "main_result", confidence: args.confidence, userId })
    case "create_lemma_candidate": return createClaim({ workspaceId, problemId: args.problem_id, statement: args.statement, motivation: args.motivation, claimKind: "lemma", role: "supporting_lemma", confidence: args.confidence, userId })
    case "add_route_to_claim": return addRouteToClaim({ workspaceId, claimId: args.claim_id, routeTitle: args.route_title, status: args.status, confidence: args.confidence, method: args.method, strategy: args.strategy, proposedDecomposition: args.proposed_decomposition, blockers: args.blockers, userId })
    case "update_claim_route": return updateClaimRoute({ workspaceId, claimId: args.claim_id, routeTitleOrId: args.route_title_or_id, patch: args.patch, userId })
    case "promote_route_to_node": return promoteRouteToNode({ workspaceId, claimId: args.claim_id, routeTitleOrId: args.route_title_or_id, reason: args.reason, userId })
    case "update_claim_metadata": return updateClaimMetadata({ workspaceId, claimId: args.claim_id, patch: args.patch, userId })
    case "update_claim_proof_status": return updateClaimProofStatus({ workspaceId, claimId: args.claim_id, proofStatus: args.proof_status, claimStatus: args.claim_status, reason: args.reason, userId })
    case "add_informal_proof_to_claim": return addInformalProofToClaim({ workspaceId, claimId: args.claim_id, proof: args.proof, remainingCaveats: args.remaining_caveats, userId })
    case "update_claim_lean_status": return args.reason && !args.diagnostics && !args.notes ? updateClaimLeanStatusWithReason({ workspaceId, claimId: args.claim_id, leanStatus: args.lean_status, leanFile: args.lean_file, leanName: args.lean_name, reason: args.reason, userId }) : updateClaimLeanStatus({ workspaceId, claimId: args.claim_id, leanStatus: args.lean_status, leanFile: args.lean_file, leanName: args.lean_name, diagnostics: args.diagnostics, notes: args.notes ?? args.reason, userId })
    case "decompose_claim": return Array.isArray(args.subclaims) && args.subclaims.some((item: unknown) => typeof item === "object") ? decomposeClaimRich({ workspaceId, claimId: args.claim_id, routeTitleOrId: args.route_title_or_id, subclaims: args.subclaims, userId }) : decomposeClaim({ workspaceId, claimId: args.claim_id, subclaims: args.subclaims, userId })
    case "promote_inline_subclaim_to_claim": return args.title ? promoteInlineSubclaimToClaimRich({ workspaceId, parentClaimId: args.parent_claim_id, section: args.section, itemText: args.item_text, title: args.title, statement: args.statement, claimKind: args.claim_kind, role: args.role, reason: args.reason, userId }) : promoteInlineSubclaimToClaim({ workspaceId, parentClaimId: args.parent_claim_id, statement: args.statement, role: args.role, userId })
    case "append_proof_attempt_to_claim": return appendProofAttemptToClaim({ workspaceId, claimId: args.claim_id, routeTitleOrId: args.route_title_or_id, summary: args.summary, result: args.result, details: args.details, nextSteps: args.next_steps, userId })
    case "add_inline_gap_to_claim": return addInlineGapToClaim({ workspaceId, claimId: args.claim_id, routeTitleOrId: args.route_title_or_id, severity: args.severity, statement: args.statement, possibleResolutions: args.possible_resolutions, userId })
    case "compute_claim_readiness": return computeClaimReadiness({ workspaceId, claimId: args.claim_id })
    case "create_proof_route": return createProofRoute({ workspaceId, targetNodeId: args.target_node_id, method: args.method, plan: args.plan, killCondition: args.kill_condition, userId })
    case "log_proof_attempt": return logProofAttempt({ workspaceId, targetNodeId: args.target_node_id, routeNodeId: args.route_node_id, summary: args.summary, result: args.result, failureReason: args.failure_reason, newGaps: args.new_gaps, userId })
    case "create_gap": return createGap({ workspaceId, targetNodeId: args.target_node_id, statement: args.statement, severity: args.severity, possibleResolutions: args.possible_resolutions ?? [], userId })
    case "create_task": return createTask({ workspaceId, targetNodeId: args.target_node_id, targetSection: args.target_section, workflowType: args.workflow_type ?? args.workflow, title: args.title, priority: args.priority, instructions: args.instructions, userId })
    case "get_next_task": return getNextTask(workspaceId, args.target_node_id)
    case "claim_task": return claimTask(workspaceId, args.task_id, userId, args.claimed_session_id, args.workflow)
    case "heartbeat_task": return heartbeatTask(workspaceId, args.task_id, args.workflow, args.claimed_session_id)
    case "complete_task": return completeTask(workspaceId, args.task_id, args.outcome_summary, args.claimed_session_id)
    case "release_task": return releaseTask(workspaceId, args.task_id, args.claimed_session_id)
    case "snooze_task": return snoozeTask(workspaceId, args.task_id, args.reason, args.until)
    case "archive_node": return archiveNode({ workspaceId, nodeId: args.node_id, reason: args.reason, userId })
    case "complete_workflow": return completeWorkflow({ workspaceId, nodeId: args.node_id, workflowType: args.workflow_type, summary: args.summary, graphUpdates: args.graph_updates, userId })
    case "rebuild_index": return rebuildIndex(workspaceId, userId)
    case "rebuild_quartz_site": return rebuildQuartz(workspaceId, userId)
    case "get_quartz_site_status": return quartzStatus(workspaceId)
    case "create_formalization_target": return createFormalizationTarget({ workspaceId, informalProofId: args.informal_proof_id, leanFeasibility: args.lean_feasibility, requiredDefinitions: args.required_definitions, theoremStub: args.theorem_stub, userId })
    case "create_lean_project": return createLeanProject({ workspaceId, projectName: args.project_name })
    case "create_lean_stub": return createLeanStub({ workspaceId, formalizationTargetId: args.formalization_target_id, theoremStatement: args.theorem_statement, imports: args.imports, userId })
    case "lean_check": return leanCheck({ workspaceId, leanFileId: args.lean_file_id })
    case "lean_goal": return leanGoal({ workspaceId, leanFileId: args.lean_file_id, position: args.position })
    case "create_counterexample": return researchExtras.create_counterexample({ workspaceId, targetNodeId: args.target_node_id, construction: args.construction, explanation: args.explanation, artifacts: args.artifacts, userId })
    case "create_experiment": return researchExtras.create_experiment({ workspaceId, problemId: args.problem_id, title: args.title, hypothesis: args.hypothesis, codeRef: args.code_ref, parameters: args.parameters, userId })
    case "log_experiment_result": return researchExtras.log_experiment_result({ workspaceId, experimentId: args.experiment_id, resultSummary: args.result_summary, artifacts: args.artifacts, implications: args.implications, userId })
    case "create_literature_source": return researchExtras.create_literature_source({ workspaceId, title: args.title, authors: args.authors, year: args.year, citation: args.citation, relevance: args.relevance, notes: args.notes, userId })
    case "mark_claim_novelty": return researchExtras.mark_claim_novelty({ workspaceId, claimId: args.claim_id, noveltyStatus: args.novelty_status, evidence: args.evidence, userId })
    case "promote_to_theorem_candidate": return researchExtras.promote_to_theorem_candidate({ workspaceId, conjectureId: args.conjecture_id, theoremStatement: args.theorem_statement, reason: args.reason, userId })
    case "promote_to_informal_proof": return researchExtras.promote_to_informal_proof({ workspaceId, claimId: args.claim_id, proofNodeBody: args.proof_node_body, remainingCaveats: args.remaining_caveats, userId })
    case "pause_project": return researchExtras.pause_project({ workspaceId, nodeId: args.node_id, reason: args.reason, revivalTrigger: args.revival_trigger, userId })
    case "kill_project": return researchExtras.kill_project({ workspaceId, nodeId: args.node_id, reason: args.reason, salvageValue: args.salvage_value, userId })
    case "lean_search_mathlib": return leanExtras.lean_search_mathlib({ workspaceId, query: args.query })
    case "lean_multi_attempt": return leanExtras.lean_multi_attempt()
    case "log_lean_attempt": return leanExtras.log_lean_attempt({ workspaceId, formalizationTargetId: args.formalization_target_id, result: args.result, diagnostics: args.diagnostics, nextGap: args.next_gap, userId })
    case "mark_lean_verified": return leanExtras.mark_lean_verified({ workspaceId, leanTheoremNodeId: args.lean_theorem_node_id, fileRef: args.file_ref, theoremName: args.theorem_name, userId })
    case "create_assumption_entry": return leanExtras.create_assumption_entry({ workspaceId, statement: args.statement, reason: args.reason, status: args.status, userId })
    case "create_local_theorem_library_entry": return leanExtras.create_local_theorem_library_entry({ workspaceId, leanTheoremName: args.lean_theorem_name, statement: args.statement, proofFile: args.proof_file, userId })
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
  return { name: definition.name, description: definition.description, inputSchema: definition.inputSchema, securitySchemes, _meta: { securitySchemes } }
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
    if (method === "initialize") return res.json({ jsonrpc: "2.0", id, result: { protocolVersion: "2024-11-05", serverInfo: { name: "Maff", version: "0.1.0" }, capabilities: { tools: {}, resources: {}, prompts: {} } } })
    if (method === "tools/list") return res.json({ jsonrpc: "2.0", id, result: { tools: toolDefinitions.map(toolForList) } })
    if (method === "tools/call") return res.json({ jsonrpc: "2.0", id, result: contentResult(await callTool(params.name, params.arguments ?? {}, ctx)) })
    if (method === "resources/list") return res.json({ jsonrpc: "2.0", id, result: await listResources(resourceCtx) })
    if (method === "resources/read") return res.json({ jsonrpc: "2.0", id, result: resourceResult(params.uri, await readResource(params.uri, resourceCtx)) })
    if (method === "prompts/list") {
      const prompts = await listPrompts()
      return res.json({ jsonrpc: "2.0", id, result: { prompts: prompts.map((name) => ({ name, description: `Maff workflow prompt: ${name}` })) } })
    }
    if (method === "prompts/get") {
      const text = await getPrompt(params.name)
      return res.json({ jsonrpc: "2.0", id, result: { description: `Maff workflow prompt: ${params.name}`, messages: [{ role: "user", content: { type: "text", text } }] } })
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
