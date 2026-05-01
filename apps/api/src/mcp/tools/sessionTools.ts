import { prisma } from "../../db/prisma.js"
import { requireWorkspaceRole } from "../../auth/permissions.js"
import { getSkillPack } from "../../skills/skillRouter.js"
import { getPrompt } from "../prompts.js"
import { createProblem } from "./researchTools.js"

const maffIntro = "Maff is a private math research graph. Use tools first, resources as read-only references, and write durable progress back to Markdown nodes, gaps, attempts, and tasks."

export const chatOutputContract = `When using Maff, keep the user informed.

At the start, say:
"I'm using the <workflow_name> workflow on <node_title> to <goal>."

During the workflow, briefly mention major tool actions: found/resolved node; checked gaps/routes/tasks; created or updated a node; logged a proof attempt; created a follow-up task.

At the end, summarize: what was done; which node(s) were created or updated; the main mathematical content; what the next task is.

Do not dump raw JSON, full metadata, or the entire graph unless the user asks.`

function workflowForNode(node: { type: string; status: string; metadata: unknown; updatedAtFromFrontmatter?: Date | null }, hasRoutes: boolean, hasGaps: boolean) {
  const md = node.metadata as Record<string, unknown>
  if (node.type === "Problem" && node.status === "seed") return ["triage_problem", "Seed problem needs triage"] as const
  if (node.type === "Problem" && node.status === "active" && !hasRoutes) return ["refine_statement", "Active problem needs a precise claim"] as const
  if (node.type === "Conjecture" && (md.novelty_status ?? "unknown") === "unknown") return ["literature_check", "Novelty is unknown"] as const
  if (node.type === "Conjecture" && !hasRoutes) return ["generate_routes", "No active proof route is indexed"] as const
  if (node.type === "ProofRoute" && node.status === "active") return ["attack_route", "Active route should be attacked"] as const
  if (node.type === "TheoremCandidate" && hasGaps) return ["gap_analysis", "Candidate has open gaps"] as const
  if (node.type === "TheoremCandidate" && node.status === "proof_candidate") return ["hostile_review", "Proof candidate needs skeptical review"] as const
  if (node.type === "InformalProof" && node.status === "informally_proved") return ["lean_handoff", "Informal proof is ready for formalization planning"] as const
  if (node.type === "FormalizationTarget" && node.status === "created") return ["lean_stub_generation", "Formalization target needs a Lean stub"] as const
  if (node.type === "LeanTheorem" && String(md.diagnostics ?? "")) return ["lean_proof_repair", "Lean diagnostics are present"] as const
  return ["triage_problem", "Default routing"] as const
}

export async function listWorkspaces(userId: string) {
  return prisma.workspace.findMany({ where: { members: { some: { userId } } }, include: { members: true }, orderBy: { createdAt: "asc" } })
}

async function sessionContext(input: { userId: string; workspaceId: string; nodeRef?: string; userGoal?: string; workflowType?: string; useQueue?: boolean }) {
  const queued = input.useQueue ? await prisma.taskIndex.findFirst({ where: { workspaceId: input.workspaceId, OR: [{ status: "open" }, { status: "claimed", leaseExpiresAt: { lt: new Date() } }] }, orderBy: [{ priority: "desc" }, { createdAt: "asc" }] }) : null
  const node = input.nodeRef
    ? await prisma.nodeIndex.findFirst({ where: { workspaceId: input.workspaceId, OR: [{ nodeId: input.nodeRef }, { title: { contains: input.nodeRef, mode: "insensitive" } }] } })
    : queued?.targetNodeId
      ? await prisma.nodeIndex.findUnique({ where: { workspaceId_nodeId: { workspaceId: input.workspaceId, nodeId: queued.targetNodeId } } })
      : await prisma.nodeIndex.findFirst({ where: { workspaceId: input.workspaceId, stale: false }, orderBy: { updatedAtFromFrontmatter: "desc" } })

  if (!node) return { node: null, queued, workflow: input.workflowType ?? "capture_new_problem", reason: "No node resolved", neighbors: [], openGaps: [], recentAttempts: [] }
  const neighbors = await prisma.edgeIndex.findMany({ where: { workspaceId: input.workspaceId, OR: [{ sourceNodeId: node.nodeId }, { targetNodeId: node.nodeId }] }, take: 50 })
  const scopedGapEdges = await prisma.edgeIndex.findMany({ where: { workspaceId: input.workspaceId, targetNodeId: node.nodeId, edgeType: { in: ["target", "targets", "blocked_by", "problem"] } } })
  const openGaps = await prisma.nodeIndex.findMany({ where: { workspaceId: input.workspaceId, nodeId: { in: scopedGapEdges.map((e) => e.sourceNodeId) }, type: { in: ["Gap", "FormalizationGap"] }, status: { in: ["open", "active", "seed"] } }, take: 10 })
  const recentAttempts = await prisma.nodeIndex.findMany({ where: { workspaceId: input.workspaceId, type: { in: ["ProofAttempt", "FormalizationAttempt"] } }, orderBy: { updatedAtFromFrontmatter: "desc" }, take: 5 })
  const proofRouteCount = await prisma.nodeIndex.count({ where: { workspaceId: input.workspaceId, type: "ProofRoute", OR: [{ metadata: { path: ["target"], equals: node.nodeId } }, { metadata: { path: ["target"], equals: `[[${node.title}]]` } }] } })
  const routeEdgeTypes = new Set(["route", "routes", "target", "targets"])
  const hasRoutes = proofRouteCount > 0 || neighbors.some((e) => routeEdgeTypes.has(e.edgeType))
  const [routedWorkflow, routedReason] = input.userGoal?.toLowerCase().includes("lean")
    ? ["lean_handoff", "User goal mentions Lean"] as const
    : workflowForNode(node, hasRoutes, openGaps.length > 0)
  return { node, queued, workflow: queued?.workflow ?? input.workflowType ?? routedWorkflow, reason: queued ? "Highest priority queued task" : routedReason, neighbors, openGaps, recentAttempts }
}

export async function startResearchSession(input: { userId: string; workspaceId: string; nodeRef?: string; userGoal?: string }) {
  const context = await sessionContext({ ...input, useQueue: true })
  if (!context.node) return { resolved_node: null, recommended_workflow: context.workflow, reason: context.reason, queued_task: context.queued }
  return {
    resolved_node: context.node,
    recommended_workflow: context.workflow,
    reason: context.reason,
    current_status: context.node.status,
    relevant_neighboring_nodes: context.neighbors,
    open_gaps: context.openGaps,
    recent_attempts: context.recentAttempts,
    queued_tasks: context.queued ? [context.queued] : [],
    relevant_skills: await getSkillPack(input.workspaceId, context.node.nodeId, context.workflow),
    workflow_prompt_text: await getPrompt(context.workflow).catch(() => ""),
    chat_output_contract: chatOutputContract,
    suggested_tools: ["get_node", "get_neighbors", "complete_workflow", "create_gap", "log_proof_attempt"],
    instruction: "If the user did not specify a workflow, follow recommended_workflow."
  }
}

export async function startWorkflow(workspaceId: string, nodeId: string, workflowType: string) {
  const node = await prisma.nodeIndex.findUniqueOrThrow({ where: { workspaceId_nodeId: { workspaceId, nodeId } } })
  return {
    node,
    skills: await getSkillPack(workspaceId, nodeId, workflowType),
    workflow_prompt_text: await getPrompt(workflowType).catch(() => ""),
    chat_output_contract: chatOutputContract,
    expected_completion_format: "summary plus graph_updates",
    allowed_tools: ["complete_workflow", "create_node", "create_gap", "log_proof_attempt"]
  }
}

export async function maffBootstrap(input: {
  userId: string
  workspaceId?: string
  nodeRef?: string
  userGoal?: string
  workflowType?: string
  mode?: string
  createIfMissing?: boolean
  title?: string
  area?: string
  roughStatement?: string
}) {
  const workspaces = await listWorkspaces(input.userId)
  const workspace = input.workspaceId ? workspaces.find((w) => w.id === input.workspaceId) : workspaces[0]
  if (!workspace) throw Object.assign(new Error("No accessible Maff workspace"), { status: 404 })
  const mode = input.mode ?? (input.createIfMissing || input.title ? "capture_new_problem" : input.nodeRef ? "resume_existing_problem" : "resume_existing_problem")
  const useQueue = mode === "resume_existing_problem" && !input.userGoal && !input.workflowType && !input.nodeRef
  let createdNode = null
  if (input.createIfMissing && input.title) {
    await requireWorkspaceRole(input.userId, workspace.id, "editor")
    createdNode = await createProblem({ workspaceId: workspace.id, title: input.title, area: input.area ?? "general", roughStatement: input.roughStatement ?? input.userGoal ?? input.title, motivation: input.userGoal ?? "Captured from chat.", userId: input.userId })
  }
  const context = await sessionContext({ userId: input.userId, workspaceId: workspace.id, nodeRef: createdNode?.id ?? input.nodeRef, userGoal: input.userGoal, workflowType: input.workflowType, useQueue })
  const workflow = context.workflow
  const nodeId = context.node?.nodeId ?? createdNode?.id
  const skills = await getSkillPack(workspace.id, nodeId, workflow)
  const promptText = await getPrompt(workflow).catch(() => "")
  return {
    mode,
    resolved_workspace: { id: workspace.id, slug: workspace.slug, name: workspace.name, type: workspace.type },
    resolved_node: context.node,
    created_node_if_any: createdNode,
    recommended_workflow: workflow,
    reason: context.reason,
    queue_decision: useQueue ? { used_queue: Boolean(context.queued), task: context.queued } : { used_queue: false, reason: "Queue bypassed because the user supplied a specific idea, node, or workflow." },
    maff_intro: maffIntro,
    workflow_prompt_text: promptText,
    relevant_skills: skills,
    context_bundle: { neighbors: context.neighbors, open_gaps: context.openGaps, recent_attempts: context.recentAttempts, resources: { workspace: `workspace://${workspace.id}/manifest`, node: nodeId ? `node://${workspace.id}/${nodeId}` : null } },
    suggested_tools: ["get_node", "create_node", "create_proof_route", "log_proof_attempt", "create_gap", "create_task", "complete_workflow"],
    writeback_plan: ["Run one focused workflow.", "Write durable progress with create/update/log tools.", "Create or complete a follow-up task."],
    chat_output_contract: chatOutputContract,
    completion_instruction: "Do one focused workflow, write back durable progress, then summarize the changed nodes and next task."
  }
}
