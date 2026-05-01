import { prisma } from "../../db/prisma.js"
import { getSkillPack } from "../../skills/skillRouter.js"

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

export async function startResearchSession(input: { userId: string; workspaceId: string; nodeRef?: string; userGoal?: string }) {
  const queued = await prisma.taskIndex.findFirst({ where: { workspaceId: input.workspaceId, status: "open" }, orderBy: [{ priority: "desc" }, { createdAt: "asc" }] })
  const node = input.nodeRef
    ? await prisma.nodeIndex.findFirst({ where: { workspaceId: input.workspaceId, OR: [{ nodeId: input.nodeRef }, { title: { contains: input.nodeRef, mode: "insensitive" } }] } })
    : queued?.targetNodeId
      ? await prisma.nodeIndex.findUnique({ where: { workspaceId_nodeId: { workspaceId: input.workspaceId, nodeId: queued.targetNodeId } } })
      : await prisma.nodeIndex.findFirst({ where: { workspaceId: input.workspaceId, stale: false }, orderBy: { updatedAtFromFrontmatter: "desc" } })

  if (!node) return { resolved_node: null, recommended_workflow: "triage_problem", reason: "No node resolved", queued_task: queued }
  const neighbors = await prisma.edgeIndex.findMany({ where: { workspaceId: input.workspaceId, OR: [{ sourceNodeId: node.nodeId }, { targetNodeId: node.nodeId }] }, take: 50 })
  const scopedGapEdges = await prisma.edgeIndex.findMany({ where: { workspaceId: input.workspaceId, targetNodeId: node.nodeId, edgeType: { in: ["target", "targets", "blocked_by", "problem"] } } })
  const openGaps = await prisma.nodeIndex.findMany({ where: { workspaceId: input.workspaceId, nodeId: { in: scopedGapEdges.map((e) => e.sourceNodeId) }, type: { in: ["Gap", "FormalizationGap"] }, status: { in: ["open", "active", "seed"] } }, take: 10 })
  const recentAttempts = await prisma.nodeIndex.findMany({ where: { workspaceId: input.workspaceId, type: { in: ["ProofAttempt", "FormalizationAttempt"] } }, orderBy: { updatedAtFromFrontmatter: "desc" }, take: 5 })
  const proofRouteCount = await prisma.nodeIndex.count({ where: { workspaceId: input.workspaceId, type: "ProofRoute", OR: [{ metadata: { path: ["target"], equals: node.nodeId } }, { metadata: { path: ["target"], equals: `[[${node.title}]]` } }] } })
  const routeEdgeTypes = new Set(["route", "routes", "target", "targets"])
  const hasRoutes = proofRouteCount > 0 || neighbors.some((e) => routeEdgeTypes.has(e.edgeType))
  const [workflow, reason] = input.userGoal?.toLowerCase().includes("lean")
    ? ["lean_handoff", "User goal mentions Lean"] as const
    : workflowForNode(node, hasRoutes, openGaps.length > 0)
  return {
    resolved_node: node,
    recommended_workflow: queued?.workflow ?? workflow,
    reason: queued ? "Highest priority queued task" : reason,
    current_status: node.status,
    relevant_neighboring_nodes: neighbors,
    open_gaps: openGaps,
    recent_attempts: recentAttempts,
    queued_tasks: queued ? [queued] : [],
    relevant_skills: await getSkillPack(input.workspaceId, node.nodeId, queued?.workflow ?? workflow),
    suggested_tools: ["get_node", "get_neighbors", "complete_workflow", "create_gap", "log_proof_attempt"],
    instruction: "If the user did not specify a workflow, follow recommended_workflow."
  }
}

export async function startWorkflow(workspaceId: string, nodeId: string, workflowType: string) {
  const node = await prisma.nodeIndex.findUniqueOrThrow({ where: { workspaceId_nodeId: { workspaceId, nodeId } } })
  return { node, skills: await getSkillPack(workspaceId, nodeId, workflowType), expected_completion_format: "summary plus graph_updates", allowed_tools: ["complete_workflow", "create_node", "create_gap", "log_proof_attempt"] }
}
