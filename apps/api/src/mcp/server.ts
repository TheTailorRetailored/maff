import type { Request, Response } from "express"
import type { WorkspaceRole } from "@prisma/client"
import { scopes, hasPermission } from "../auth/scopes.js"
import { requireWorkspaceRole } from "../auth/permissions.js"
import { config } from "../config.js"
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

type ToolContext = { userId: string; claimsScope?: string; permissions?: string[]; aud?: unknown; sub?: string; azp?: string; clientId?: string }
type JsonSchema = Record<string, unknown>

const objectSchema = (properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema => ({ type: "object", properties, required, additionalProperties: false })
const s = { type: "string" } as const
const n = { type: "number" } as const
const anyObj = { type: "object", additionalProperties: true } as const
const strArray = { type: "array", items: s } as const

type ToolDef = { name: string; description: string; scope: string; role: WorkspaceRole; inputSchema: JsonSchema }
const tool = (name: string, description: string, role: WorkspaceRole, inputSchema: JsonSchema, scope = scopes.maffAccess): ToolDef => ({ name, description, scope, role, inputSchema })

export const toolDefinitions: ToolDef[] = [
  tool("list_workspaces", "List workspaces visible to the authenticated user.", "viewer", objectSchema({})),
  tool("start_research_session", "Resolve a node or task and return recommended workflow context.", "viewer", objectSchema({ workspace_id: s, node_ref: s, user_goal: s }, ["workspace_id"])),
  tool("start_workflow", "Start a named workflow for a node.", "viewer", objectSchema({ workspace_id: s, workflow_type: s, node_id: s }, ["workspace_id", "workflow_type", "node_id"])),
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
  tool("update_node_metadata", "Patch YAML metadata.", "editor", objectSchema({ workspace_id: s, node_id: s, patch: anyObj }, ["workspace_id", "node_id", "patch"])),
  tool("link_nodes", "Add a typed link between nodes.", "editor", objectSchema({ workspace_id: s, source_node_id: s, target_node_id: s, edge_type: s, note: s }, ["workspace_id", "source_node_id", "target_node_id", "edge_type"])),
  tool("set_node_status", "Set node status and append a decision log entry.", "editor", objectSchema({ workspace_id: s, node_id: s, status: s, reason: s }, ["workspace_id", "node_id", "status", "reason"])),
  tool("create_problem", "Create a Problem node.", "editor", objectSchema({ workspace_id: s, title: s, area: s, rough_statement: s, motivation: s, initial_sources: strArray }, ["workspace_id", "title", "area", "rough_statement", "motivation"])),
  tool("create_conjecture", "Create a Conjecture node linked to a problem.", "editor", objectSchema({ workspace_id: s, problem_id: s, statement: s, motivation: s, confidence: n }, ["workspace_id", "problem_id", "statement", "motivation", "confidence"])),
  tool("create_proof_route", "Create a ProofRoute node.", "editor", objectSchema({ workspace_id: s, target_node_id: s, method: s, plan: s, kill_condition: s }, ["workspace_id", "target_node_id", "method", "plan", "kill_condition"])),
  tool("log_proof_attempt", "Create a ProofAttempt node and optional new gaps.", "editor", objectSchema({ workspace_id: s, target_node_id: s, route_node_id: s, summary: s, result: s, failure_reason: s, new_gaps: strArray }, ["workspace_id", "target_node_id", "summary", "result"])),
  tool("create_gap", "Create a Gap node for a target.", "editor", objectSchema({ workspace_id: s, target_node_id: s, statement: s, severity: s, possible_resolutions: strArray }, ["workspace_id", "target_node_id", "statement", "severity"])),
  tool("create_task", "Create a Task node.", "editor", objectSchema({ workspace_id: s, target_node_id: s, workflow_type: s, priority: n, instructions: s }, ["workspace_id", "target_node_id", "workflow_type", "priority", "instructions"])),
  tool("get_next_task", "Read the next queued task.", "viewer", objectSchema({ workspace_id: s }, ["workspace_id"])),
  tool("claim_task", "Claim a task.", "editor", objectSchema({ workspace_id: s, task_id: s }, ["workspace_id", "task_id"])),
  tool("complete_task", "Complete a task.", "editor", objectSchema({ workspace_id: s, task_id: s, outcome_summary: s }, ["workspace_id", "task_id", "outcome_summary"])),
  tool("snooze_task", "Snooze a task.", "editor", objectSchema({ workspace_id: s, task_id: s, reason: s }, ["workspace_id", "task_id", "reason"])),
  tool("complete_workflow", "Append workflow result and create appropriate follow-up tasks.", "editor", objectSchema({ workspace_id: s, node_id: s, workflow_type: s, summary: s, graph_updates: anyObj }, ["workspace_id", "node_id", "workflow_type", "summary"])),
  tool("rebuild_index", "Rebuild a workspace index.", "editor", objectSchema({ workspace_id: s }, ["workspace_id"])),
  tool("rebuild_quartz_site", "Build a workspace Quartz site.", "editor", objectSchema({ workspace_id: s }, ["workspace_id"])),
  tool("get_quartz_site_status", "Read latest Quartz build status.", "viewer", objectSchema({ workspace_id: s }, ["workspace_id"])),
  tool("create_formalization_target", "Create a FormalizationTarget node.", "editor", objectSchema({ workspace_id: s, informal_proof_id: s, lean_feasibility: s, required_definitions: strArray, theorem_stub: s }, ["workspace_id", "informal_proof_id", "lean_feasibility", "required_definitions"])),
  tool("create_lean_project", "Create a Lean project.", "editor", objectSchema({ workspace_id: s, project_name: s }, ["workspace_id", "project_name"])),
  tool("create_lean_stub", "Create a Lean theorem file and LeanTheorem node.", "editor", objectSchema({ workspace_id: s, formalization_target_id: s, theorem_statement: s, imports: strArray }, ["workspace_id", "formalization_target_id", "theorem_statement"])),
  tool("lean_check", "Run the Lean worker check for a LeanTheorem node.", "editor", objectSchema({ workspace_id: s, lean_file_id: s }, ["workspace_id", "lean_file_id"])),
  tool("lean_goal", "Read a Lean goal if supported.", "editor", objectSchema({ workspace_id: s, lean_file_id: s, position: anyObj }, ["workspace_id", "lean_file_id", "position"])),
  tool("lean_search_mathlib", "Search Mathlib or local notes for formalization hints.", "viewer", objectSchema({ workspace_id: s, query: s }, ["workspace_id", "query"])),
  tool("mark_lean_verified", "Conservatively mark a Lean theorem verified if latest check permits it.", "editor", objectSchema({ workspace_id: s, lean_theorem_node_id: s, file_ref: s, theorem_name: s }, ["workspace_id", "lean_theorem_node_id", "file_ref", "theorem_name"]))
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
