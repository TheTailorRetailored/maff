import { prisma } from "../../db/prisma.js"

const hiddenStatuses = ["killed", "archived", "cancelled", "completed"]
const defaultGraphTypes = ["Problem", "Claim", "Definition", "Paper", "KnownResult", "Experiment", "Draft"]
const optionalGraphTypes = ["Task", "ProofRoute", "ProofAttempt", "FormalizationAttempt", "Gap", "FormalizationGap"]
const defaultEdgeTypes = ["main_claim", "depends_on", "supports", "cites", "related_papers", "uses_definition"]

function metadataOf(node: { metadata: unknown }) {
  return (node.metadata ?? {}) as Record<string, unknown>
}

function normalizeRef(value: unknown) {
  return String(value ?? "").replace(/^\[\[/, "").replace(/\]\]$/, "").toLowerCase().replace(/\.md$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
}

function nodeShortTitle(node: { title: string; metadata: unknown }) {
  const md = metadataOf(node)
  return String(md.short_title ?? md.shortTitle ?? node.title)
}

export async function searchNodes(workspaceId: string, query = "", filters: Record<string, unknown> = {}) {
  const where: Record<string, unknown> = { workspaceId, stale: false }
  if (!filters.includeArchived) where.status = { notIn: ["killed", "archived", "cancelled"] }
  if (query) where.OR = [{ title: { contains: query, mode: "insensitive" } }, { bodyPreview: { contains: query, mode: "insensitive" } }]
  if (Array.isArray(filters.type)) where.type = { in: filters.type }
  if (Array.isArray(filters.status)) where.status = { in: filters.status }
  if (Array.isArray(filters.area)) where.area = { in: filters.area }
  return prisma.nodeIndex.findMany({ where, take: Number(filters.limit ?? 50), orderBy: { updatedAtFromFrontmatter: "desc" } })
}

export async function getNeighbors(workspaceId: string, nodeId: string, depth = 1, edgeTypes?: string[]) {
  const edges = await prisma.edgeIndex.findMany({
    where: { workspaceId, OR: [{ sourceNodeId: nodeId }, { targetNodeId: nodeId }], ...(edgeTypes?.length ? { edgeType: { in: edgeTypes } } : {}) }
  })
  const ids = [...new Set(edges.flatMap((e) => [e.sourceNodeId, e.targetNodeId]).filter(Boolean) as string[])]
  const nodes = await prisma.nodeIndex.findMany({ where: { workspaceId, nodeId: { in: ids } } })
  return { depth, nodes, edges }
}

export async function getOpenGaps(workspaceId: string, problemId?: string) {
  const gaps = await prisma.nodeIndex.findMany({ where: { workspaceId, type: { in: ["Gap", "FormalizationGap"] }, status: { in: ["open", "active", "seed"] } }, orderBy: { updatedAtFromFrontmatter: "desc" } })
  if (!problemId) return gaps
  const edges = await prisma.edgeIndex.findMany({
    where: {
      workspaceId,
      OR: [
        { targetNodeId: problemId },
        { sourceNodeId: problemId }
      ]
    }
  })
  const related = new Set<string>([problemId])
  for (const edge of edges) {
    related.add(edge.sourceNodeId)
    if (edge.targetNodeId) related.add(edge.targetNodeId)
  }
  const gapEdges = await prisma.edgeIndex.findMany({ where: { workspaceId, sourceNodeId: { in: gaps.map((g) => g.nodeId) }, targetNodeId: { in: [...related] } } })
  const allowed = new Set(gapEdges.map((e) => e.sourceNodeId))
  return gaps.filter((g) => allowed.has(g.nodeId))
}

export async function getActiveRoutes(workspaceId: string, problemId?: string) {
  const routes = await prisma.nodeIndex.findMany({ where: { workspaceId, type: "ProofRoute", status: { in: ["active", "route_active", "seed"] } }, orderBy: { updatedAtFromFrontmatter: "desc" } })
  if (!problemId) return routes
  const edges = await prisma.edgeIndex.findMany({ where: { workspaceId, targetNodeId: problemId } })
  const allowed = new Set(edges.map((e) => e.sourceNodeId))
  return routes.filter((r) => allowed.has(r.nodeId))
}

export async function getStaleNodes(workspaceId: string, days: number) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  return prisma.nodeIndex.findMany({ where: { workspaceId, OR: [{ updatedAtFromFrontmatter: { lt: cutoff } }, { updatedAtFromFrontmatter: null }] }, take: 100 })
}

export async function listProblemGraphs(workspaceId: string, statusFilter?: string[]) {
  const statuses = statusFilter?.length ? statusFilter : ["active", "seed", "paused", "lit_checked", "route_active", "proof_candidate"]
  const problems = await prisma.nodeIndex.findMany({
    where: { workspaceId, stale: false, type: "Problem", status: { in: statuses, notIn: hiddenStatuses } },
    orderBy: { updatedAtFromFrontmatter: "desc" }
  })
  const tasks = await prisma.taskIndex.groupBy({
    by: ["targetNodeId"],
    where: { workspaceId, status: { in: ["open", "claimed"] } },
    _count: { _all: true }
  })
  const taskCounts = new Map(tasks.map((task) => [task.targetNodeId ?? "", task._count._all]))
  const summaries = []
  for (const problem of problems) {
    const claims = await getProblemClaimNodes(workspaceId, problem.nodeId, false)
    summaries.push({
      id: problem.nodeId,
      title: problem.title,
      short_title: nodeShortTitle(problem),
      status: problem.status,
      active_claim_count: claims.filter((node) => node.type === "Claim").length,
      open_task_count: taskCounts.get(problem.nodeId) ?? 0,
      updated_at: problem.updatedAtFromFrontmatter ?? problem.indexedAt,
      next_recommended_workflow: problem.status === "seed" ? "triage_problem" : "refine_statement"
    })
  }
  return summaries
}

async function getProblemClaimNodes(workspaceId: string, problemId: string, includeArchived: boolean) {
  const problem = await prisma.nodeIndex.findUniqueOrThrow({ where: { workspaceId_nodeId: { workspaceId, nodeId: problemId } } })
  const problemRefs = new Set([problem.nodeId, problem.slug, normalizeRef(problem.title), `[[${problem.title}]]`].map(normalizeRef))
  const baseTypes = [...defaultGraphTypes]
  const nodes = await prisma.nodeIndex.findMany({
    where: { workspaceId, stale: false, type: { in: baseTypes }, ...(includeArchived ? {} : { status: { notIn: hiddenStatuses } }) }
  })
  const problemMd = metadataOf(problem)
  const mainClaimRefs = new Set((Array.isArray(problemMd.main_claims) ? problemMd.main_claims : []).map(normalizeRef))
  const direct = nodes.filter((node) => {
    if (node.nodeId === problemId) return true
    const md = metadataOf(node)
    return problemRefs.has(normalizeRef(md.problem)) || mainClaimRefs.has(normalizeRef(node.nodeId)) || mainClaimRefs.has(normalizeRef(node.title))
  })
  const included = new Map(direct.map((node) => [node.nodeId, node]))
  let changed = true
  while (changed) {
    changed = false
    const edges = await prisma.edgeIndex.findMany({ where: { workspaceId, edgeType: { in: ["depends_on", "supports"] }, OR: [{ sourceNodeId: { in: [...included.keys()] } }, { targetNodeId: { in: [...included.keys()] } }] } })
    for (const edge of edges) {
      for (const id of [edge.sourceNodeId, edge.targetNodeId].filter(Boolean) as string[]) {
        if (!included.has(id)) {
          const node = nodes.find((candidate) => candidate.nodeId === id)
          if (node) {
            included.set(id, node)
            changed = true
          }
        }
      }
    }
  }
  return [...included.values()]
}

function computeDepths(rootNodeId: string, nodes: { nodeId: string }[], edges: { sourceNodeId: string; targetNodeId: string | null; edgeType: string }[]) {
  const adjacency = new Map<string, string[]>()
  for (const node of nodes) adjacency.set(node.nodeId, [])
  for (const edge of edges) {
    if (!edge.targetNodeId) continue
    const source = edge.edgeType === "problem" ? edge.targetNodeId : edge.sourceNodeId
    const target = edge.edgeType === "problem" ? edge.sourceNodeId : edge.targetNodeId
    adjacency.get(source)?.push(target)
  }
  const depths = new Map<string, number>([[rootNodeId, 0]])
  const queue = [rootNodeId]
  while (queue.length) {
    const current = queue.shift()!
    const nextDepth = (depths.get(current) ?? 0) + 1
    for (const next of adjacency.get(current) ?? []) {
      if (!depths.has(next) || nextDepth < depths.get(next)!) {
        depths.set(next, nextDepth)
        queue.push(next)
      }
    }
  }
  return depths
}

export async function getProblemGraph(input: {
  workspaceId: string
  problemId: string
  mode?: string
  selectedNodeId?: string
  depth?: number
  includeArchived?: boolean
  includeTasks?: boolean
  includeRoutes?: boolean
  includeAttempts?: boolean
  includeGaps?: boolean
  includeBodyWikilinks?: boolean
}) {
  const problem = await prisma.nodeIndex.findUniqueOrThrow({ where: { workspaceId_nodeId: { workspaceId: input.workspaceId, nodeId: input.problemId } } })
  const graphTypes = [...defaultGraphTypes]
  if (input.includeTasks) graphTypes.push("Task")
  if (input.includeRoutes) graphTypes.push("ProofRoute")
  if (input.includeAttempts) graphTypes.push("ProofAttempt", "FormalizationAttempt")
  if (input.includeGaps) graphTypes.push("Gap", "FormalizationGap")
  const baseNodes = input.mode === "neighborhood" && input.selectedNodeId
    ? (await getNeighbors(input.workspaceId, input.selectedNodeId, input.depth ?? 1)).nodes
    : await getProblemClaimNodes(input.workspaceId, input.problemId, Boolean(input.includeArchived))
  const nodes = baseNodes.filter((node) => graphTypes.includes(node.type) && (input.includeArchived || !hiddenStatuses.includes(node.status)))
  const nodeIds = new Set(nodes.map((node) => node.nodeId))
  const edgeTypes = [...defaultEdgeTypes, "problem"]
  if (input.includeBodyWikilinks) edgeTypes.push("links_to")
  const rawEdges = await prisma.edgeIndex.findMany({ where: { workspaceId: input.workspaceId, edgeType: { in: edgeTypes } } })
  const edges = rawEdges
    .filter((edge) => nodeIds.has(edge.sourceNodeId) && edge.targetNodeId && nodeIds.has(edge.targetNodeId))
    .map((edge) => edge.edgeType === "problem"
      ? { source: edge.targetNodeId!, target: edge.sourceNodeId, edge_type: "main_claim", label: "main claim", visibility: "default", weight: 2 }
      : { source: edge.sourceNodeId, target: edge.targetNodeId!, edge_type: edge.edgeType, label: edge.edgeType.replace(/_/g, " "), visibility: "default", weight: edge.edgeType === "depends_on" ? 3 : 1 })
  const depths = computeDepths(problem.nodeId, nodes, rawEdges)
  return {
    problem: { id: problem.nodeId, title: problem.title, short_title: nodeShortTitle(problem), status: problem.status },
    nodes: nodes.map((node) => {
      const md = metadataOf(node)
      return {
        id: node.nodeId,
        nodeId: node.nodeId,
        title: node.title,
        short_title: nodeShortTitle(node),
        type: node.type,
        status: node.status,
        claim_kind: md.claim_kind ?? null,
        claim_status: md.claim_status ?? null,
        role: md.role ?? null,
        proof_status: md.proof_status ?? null,
        lean_status: md.lean_status ?? null,
        depth: depths.get(node.nodeId) ?? (node.nodeId === problem.nodeId ? 0 : 2),
        importance: node.type === "Problem" ? 100 : md.role === "main_result" ? 80 : 50,
        metadata: md
      }
    }),
    edges,
    layout_hint: {
      mode: input.mode === "neighborhood" ? "radial" : input.mode === "exploratory" ? "force" : "dag",
      root_node_id: problem.nodeId,
      selected_node_id: input.selectedNodeId ?? null
    }
  }
}
