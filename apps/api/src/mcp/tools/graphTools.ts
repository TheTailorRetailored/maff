import { prisma } from "../../db/prisma.js"

export async function searchNodes(workspaceId: string, query = "", filters: Record<string, unknown> = {}) {
  const where: Record<string, unknown> = { workspaceId, stale: false }
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
