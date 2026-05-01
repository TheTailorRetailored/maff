import type { Request, Response } from "express"
import { hasScope, scopes } from "../auth/scopes.js"
import { requireWorkspaceRole } from "../auth/permissions.js"
import { readResource, listResources } from "./resources.js"
import { listWorkspaces, startResearchSession, startWorkflow } from "./tools/sessionTools.js"
import { getActiveRoutes, getNeighbors, getOpenGaps, getStaleNodes, searchNodes } from "./tools/graphTools.js"
import { appendToNodeTool, createNodeTool, getNode, linkNodesTool, replaceNodeSectionTool, setNodeStatus, updateNodeMetadataTool } from "./tools/nodeTools.js"
import { claimTask, completeTask, createTask, getNextTask, snoozeTask } from "./tools/taskTools.js"
import { completeWorkflow, createConjecture, createGap, createProblem, createProofRoute, logProofAttempt, researchExtras } from "./tools/researchTools.js"
import { createFormalizationTarget, createLeanProject, createLeanStub, leanCheck, leanExtras, leanGoal } from "./tools/leanTools.js"
import { quartzStatus, rebuildIndex, rebuildQuartz } from "./tools/siteTools.js"
import { getSkillPack } from "../skills/skillRouter.js"
import { getPrompt, listPrompts } from "./prompts.js"

type ToolContext = { userId: string; claimsScope?: string; permissions?: string[] }
type JsonSchema = Record<string, unknown>

const objectSchema = (properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema => ({
  type: "object",
  properties,
  required,
  additionalProperties: false
})

const s = { type: "string" } as const
const n = { type: "number" } as const
const b = { type: "boolean" } as const
const anyObj = { type: "object", additionalProperties: true } as const
const strArray = { type: "array", items: s } as const

export const toolDefinitions = [
  { name: "list_workspaces", description: "List workspaces visible to the authenticated user.", scope: scopes.graphRead, inputSchema: objectSchema({}) },
  { name: "start_research_session", description: "Resolve a node or task and return recommended workflow context.", scope: scopes.graphRead, inputSchema: objectSchema({ workspace_id: s, node_ref: s, user_goal: s }, ["workspace_id"]) },
  { name: "start_workflow", description: "Start a named workflow for a node.", scope: scopes.graphRead, inputSchema: objectSchema({ workspace_id: s, workflow_type: s, node_id: s }, ["workspace_id", "workflow_type", "node_id"]) },
  { name: "get_skill_pack", description: "Return compact skills relevant to a workflow and node.", scope: scopes.graphRead, inputSchema: objectSchema({ workspace_id: s, node_id: s, workflow_type: s }, ["workspace_id", "workflow_type"]) },
  { name: "search_nodes", description: "Search indexed research nodes.", scope: scopes.graphRead, inputSchema: objectSchema({ workspace_id: s, query: s, filters: anyObj }, ["workspace_id"]) },
  { name: "get_node", description: "Read a parsed Markdown node.", scope: scopes.graphRead, inputSchema: objectSchema({ workspace_id: s, node_id: s }, ["workspace_id", "node_id"]) },
  { name: "get_neighbors", description: "Read local graph neighbors for a node.", scope: scopes.graphRead, inputSchema: objectSchema({ workspace_id: s, node_id: s, depth: n, edge_types: strArray }, ["workspace_id", "node_id"]) },
  { name: "get_open_gaps", description: "Read open gaps, optionally scoped to a problem or target.", scope: scopes.graphRead, inputSchema: objectSchema({ workspace_id: s, problem_id: s }, ["workspace_id"]) },
  { name: "get_active_routes", description: "Read active proof routes.", scope: scopes.graphRead, inputSchema: objectSchema({ workspace_id: s, problem_id: s }, ["workspace_id"]) },
  { name: "create_node", description: "Create a safe Markdown node.", scope: scopes.nodeCreate, inputSchema: objectSchema({ workspace_id: s, type: s, title: s, metadata: anyObj, body: s }, ["workspace_id", "type", "title"]) },
  { name: "append_to_node", description: "Append content to a Markdown section.", scope: scopes.nodeUpdate, inputSchema: objectSchema({ workspace_id: s, node_id: s, section: s, content: s }, ["workspace_id", "node_id", "section", "content"]) },
  { name: "replace_node_section", description: "Replace one Markdown section after backing up the file.", scope: scopes.nodeUpdate, inputSchema: objectSchema({ workspace_id: s, node_id: s, section: s, content: s }, ["workspace_id", "node_id", "section", "content"]) },
  { name: "update_node_metadata", description: "Patch YAML metadata.", scope: scopes.nodeUpdate, inputSchema: objectSchema({ workspace_id: s, node_id: s, patch: anyObj }, ["workspace_id", "node_id", "patch"]) },
  { name: "link_nodes", description: "Add a typed link between nodes.", scope: scopes.graphWrite, inputSchema: objectSchema({ workspace_id: s, source_node_id: s, target_node_id: s, edge_type: s, note: s }, ["workspace_id", "source_node_id", "target_node_id", "edge_type"]) },
  { name: "create_conjecture", description: "Create a Conjecture node linked to a problem.", scope: scopes.graphWrite, inputSchema: objectSchema({ workspace_id: s, problem_id: s, statement: s, motivation: s, confidence: n }, ["workspace_id", "problem_id", "statement", "motivation", "confidence"]) },
  { name: "create_proof_route", description: "Create a ProofRoute node.", scope: scopes.graphWrite, inputSchema: objectSchema({ workspace_id: s, target_node_id: s, method: s, plan: s, kill_condition: s }, ["workspace_id", "target_node_id", "method", "plan", "kill_condition"]) },
  { name: "log_proof_attempt", description: "Create a ProofAttempt node and optional new gaps.", scope: scopes.attemptWrite, inputSchema: objectSchema({ workspace_id: s, target_node_id: s, route_node_id: s, summary: s, result: s, failure_reason: s, new_gaps: strArray }, ["workspace_id", "target_node_id", "summary", "result"]) },
  { name: "create_gap", description: "Create a Gap node for a target.", scope: scopes.graphWrite, inputSchema: objectSchema({ workspace_id: s, target_node_id: s, statement: s, severity: s, possible_resolutions: strArray }, ["workspace_id", "target_node_id", "statement", "severity"]) },
  { name: "create_task", description: "Create a Task node.", scope: scopes.graphWrite, inputSchema: objectSchema({ workspace_id: s, target_node_id: s, workflow_type: s, priority: n, instructions: s }, ["workspace_id", "target_node_id", "workflow_type", "priority", "instructions"]) },
  { name: "complete_workflow", description: "Append workflow result and create appropriate follow-up tasks.", scope: scopes.graphWrite, inputSchema: objectSchema({ workspace_id: s, node_id: s, workflow_type: s, summary: s, graph_updates: anyObj }, ["workspace_id", "node_id", "workflow_type", "summary"]) },
  { name: "create_formalization_target", description: "Create a FormalizationTarget node.", scope: scopes.formalizationRun, inputSchema: objectSchema({ workspace_id: s, informal_proof_id: s, lean_feasibility: s, required_definitions: strArray, theorem_stub: s }, ["workspace_id", "informal_proof_id", "lean_feasibility", "required_definitions"]) },
  { name: "create_lean_stub", description: "Create a Lean theorem file and LeanTheorem node.", scope: scopes.formalizationRun, inputSchema: objectSchema({ workspace_id: s, formalization_target_id: s, theorem_statement: s, imports: strArray }, ["workspace_id", "formalization_target_id", "theorem_statement"]) },
  { name: "lean_check", description: "Run the Lean worker check for a LeanTheorem node.", scope: scopes.formalizationRun, inputSchema: objectSchema({ workspace_id: s, lean_file_id: s }, ["workspace_id", "lean_file_id"]) },
  { name: "rebuild_quartz_site", description: "Build a workspace Quartz site.", scope: scopes.publishRun, inputSchema: objectSchema({ workspace_id: s }, ["workspace_id"]) },
  { name: "get_quartz_site_status", description: "Read latest Quartz build status.", scope: scopes.graphRead, inputSchema: objectSchema({ workspace_id: s }, ["workspace_id"]) },
  { name: "set_node_status", description: "Set node status and append a decision log entry.", scope: scopes.nodeUpdate, inputSchema: objectSchema({ workspace_id: s, node_id: s, status: s, reason: s }, ["workspace_id", "node_id", "status", "reason"]) }
]

const toolScopes = Object.fromEntries(toolDefinitions.map((tool) => [tool.name, tool.scope])) as Record<string, string>

function hasRequiredPermission(ctx: ToolContext, required: string) {
  return hasScope(ctx.claimsScope, required) || (ctx.permissions ?? []).includes(required)
}

async function authorize(ctx: ToolContext, tool: string, workspaceId?: string) {
  const required = toolScopes[tool] ?? scopes.graphWrite
  if (!hasRequiredPermission(ctx, required)) throw Object.assign(new Error(`Missing scope ${required}`), { status: 403 })
  if (workspaceId) await requireWorkspaceRole(ctx.userId, workspaceId, required === scopes.graphRead ? "viewer" : "editor")
}

function workspaceIdFrom(args: any) {
  return args?.workspace_id ?? args?.workspaceId
}

async function callTool(tool: string, args: any, ctx: ToolContext) {
  await authorize(ctx, tool, workspaceIdFrom(args))
  const workspaceId = workspaceIdFrom(args)
  const userId = ctx.userId
  switch (tool) {
    case "list_workspaces": return listWorkspaces(userId)
    case "start_research_session": return startResearchSession({ userId, workspaceId, nodeRef: args.node_ref, userGoal: args.user_goal })
    case "start_workflow": return startWorkflow(workspaceId, args.node_id, args.workflow_type)
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
    case "create_conjecture": return createConjecture({ workspaceId, problemId: args.problem_id, statement: args.statement, motivation: args.motivation, confidence: args.confidence, userId })
    case "create_proof_route": return createProofRoute({ workspaceId, targetNodeId: args.target_node_id, method: args.method, plan: args.plan, killCondition: args.kill_condition, userId })
    case "log_proof_attempt": return logProofAttempt({ workspaceId, targetNodeId: args.target_node_id, routeNodeId: args.route_node_id, summary: args.summary, result: args.result, failureReason: args.failure_reason, newGaps: args.new_gaps, userId })
    case "create_gap": return createGap({ workspaceId, targetNodeId: args.target_node_id, statement: args.statement, severity: args.severity, possibleResolutions: args.possible_resolutions ?? [], userId })
    case "create_task": return createTask({ workspaceId, targetNodeId: args.target_node_id, workflowType: args.workflow_type, priority: args.priority, instructions: args.instructions, userId })
    case "get_next_task": return getNextTask(workspaceId)
    case "claim_task": return claimTask(workspaceId, args.task_id, userId)
    case "complete_task": return completeTask(workspaceId, args.task_id, args.outcome_summary)
    case "snooze_task": return snoozeTask(workspaceId, args.task_id, args.reason)
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
    case "lean_search_mathlib": return leanExtras.lean_search_mathlib({ workspaceId, query: args.query })
    case "mark_lean_verified": return leanExtras.mark_lean_verified({ workspaceId, leanTheoremNodeId: args.lean_theorem_node_id, fileRef: args.file_ref, theoremName: args.theorem_name, userId })
    default: throw new Error(`Unknown tool: ${tool}`)
  }
}

function contentResult(value: unknown) {
  return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] }
}

function resourceResult(uri: string, value: unknown) {
  return { contents: [{ uri, mimeType: "application/json", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] }
}

export async function mcpHandler(req: Request, res: Response) {
  try {
    if (!req.auth) return res.status(401).json({ error: "missing_token" })
    const { id, method, params } = req.body ?? {}
    const ctx: ToolContext = { userId: req.auth.user.id, claimsScope: req.auth.claims.scope, permissions: req.auth.claims.permissions }
    const resourceCtx = { userId: req.auth.user.id, claims: req.auth.claims }
    if (method === "initialize") {
      return res.json({ jsonrpc: "2.0", id, result: { protocolVersion: "2024-11-05", serverInfo: { name: "Maff", version: "0.1.0" }, capabilities: { tools: {}, resources: {}, prompts: {} } } })
    }
    if (method === "tools/list") return res.json({ jsonrpc: "2.0", id, result: { tools: toolDefinitions.map(({ scope: _scope, ...tool }) => tool) } })
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
    res.status((error as any).status ?? 400).json({ jsonrpc: "2.0", id: req.body?.id, error: { message: error instanceof Error ? error.message : String(error) } })
  }
}
