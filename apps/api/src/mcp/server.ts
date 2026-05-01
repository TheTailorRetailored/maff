import type { Request, Response } from "express"
import { hasScope, scopes } from "../auth/scopes.js"
import { requireWorkspaceRole } from "../auth/permissions.js"
import { readResource } from "./resources.js"
import { listWorkspaces, startResearchSession, startWorkflow } from "./tools/sessionTools.js"
import { getActiveRoutes, getNeighbors, getOpenGaps, getStaleNodes, searchNodes } from "./tools/graphTools.js"
import { appendToNodeTool, createNodeTool, getNode, linkNodesTool, replaceNodeSectionTool, setNodeStatus, updateNodeMetadataTool } from "./tools/nodeTools.js"
import { claimTask, completeTask, createTask, getNextTask, snoozeTask } from "./tools/taskTools.js"
import { completeWorkflow, createConjecture, createGap, createProblem, createProofRoute, logProofAttempt, researchExtras } from "./tools/researchTools.js"
import { createFormalizationTarget, createLeanProject, createLeanStub, leanCheck, leanExtras, leanGoal } from "./tools/leanTools.js"
import { quartzStatus, rebuildIndex, rebuildQuartz } from "./tools/siteTools.js"
import { getSkillPack } from "../skills/skillRouter.js"

type ToolContext = { userId: string; scope: string; claimsScope?: string }

const toolScopes: Record<string, string> = {
  list_workspaces: scopes.graphRead,
  start_research_session: scopes.graphRead,
  start_workflow: scopes.graphRead,
  get_skill_pack: scopes.graphRead,
  search_nodes: scopes.graphRead,
  get_node: scopes.graphRead,
  get_neighbors: scopes.graphRead,
  get_open_gaps: scopes.graphRead,
  get_active_routes: scopes.graphRead,
  get_stale_nodes: scopes.graphRead,
  create_node: scopes.nodeCreate,
  update_node_metadata: scopes.nodeUpdate,
  append_to_node: scopes.nodeUpdate,
  replace_node_section: scopes.nodeUpdate,
  link_nodes: scopes.graphWrite,
  set_node_status: scopes.nodeUpdate,
  create_problem: scopes.graphWrite,
  create_conjecture: scopes.graphWrite,
  create_proof_route: scopes.graphWrite,
  log_proof_attempt: scopes.attemptWrite,
  create_gap: scopes.graphWrite,
  create_task: scopes.graphWrite,
  get_next_task: scopes.graphRead,
  claim_task: scopes.graphWrite,
  complete_task: scopes.graphWrite,
  snooze_task: scopes.graphWrite,
  complete_workflow: scopes.graphWrite,
  rebuild_index: scopes.graphWrite,
  rebuild_quartz_site: scopes.publishRun,
  get_quartz_site_status: scopes.graphRead,
  create_formalization_target: scopes.formalizationRun,
  create_lean_project: scopes.formalizationRun,
  create_lean_stub: scopes.formalizationRun,
  lean_check: scopes.formalizationRun,
  lean_goal: scopes.formalizationRun
}

async function authorize(ctx: ToolContext, tool: string, workspaceId?: string) {
  const required = toolScopes[tool] ?? scopes.graphWrite
  if (!hasScope(ctx.claimsScope, required)) throw Object.assign(new Error(`Missing scope ${required}`), { status: 403 })
  if (workspaceId) await requireWorkspaceRole(ctx.userId, workspaceId, required === scopes.graphRead ? "viewer" : "editor")
}

async function callTool(tool: string, args: any, ctx: ToolContext) {
  await authorize(ctx, tool, args?.workspace_id ?? args?.workspaceId)
  const workspaceId = args?.workspace_id ?? args?.workspaceId
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
    default:
      if ((researchExtras as any)[tool]) return (researchExtras as any)[tool]({ ...args, workspaceId, userId })
      if ((leanExtras as any)[tool]) return (leanExtras as any)[tool]({ ...args, workspaceId, userId })
      throw new Error(`Unknown tool: ${tool}`)
  }
}

export async function mcpHandler(req: Request, res: Response) {
  try {
    if (!req.auth) return res.status(401).json({ error: "missing_token" })
    const { id, method, params } = req.body ?? {}
    if (method === "resources/read") return res.json({ jsonrpc: "2.0", id, result: await readResource(params.uri) })
    if (method === "tools/call") return res.json({ jsonrpc: "2.0", id, result: await callTool(params.name, params.arguments ?? {}, { userId: req.auth.user.id, scope: "", claimsScope: req.auth.claims.scope }) })
    return res.json({ jsonrpc: "2.0", id, result: { name: "Maff MCP", tools: Object.keys(toolScopes) } })
  } catch (error) {
    res.status((error as any).status ?? 400).json({ jsonrpc: "2.0", id: req.body?.id, error: { message: error instanceof Error ? error.message : String(error) } })
  }
}
