import type { Router } from "express"
import { requireUser } from "../auth/auth0.js"
import { requireWorkspaceRole } from "../auth/permissions.js"
import { prisma } from "../db/prisma.js"
import { getNeighbors } from "../mcp/tools/graphTools.js"
import { asyncHandler } from "./asyncHandler.js"

export function registerGraphRoutes(router: Router) {
  router.get("/workspaces/:id/graph", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    await requireWorkspaceRole(user.id, req.params.id, "viewer")
    const showAll = req.query.includeOperational === "true"
    const graphTypes = ["Problem", "Claim", "Definition", "Paper", "KnownResult", "Experiment", "Draft"]
    const edgeTypes = ["problem", "depends_on", "supports", "cites", "related_papers"]
    const nodes = await prisma.nodeIndex.findMany({ where: { workspaceId: req.params.id, stale: false, ...(showAll ? {} : { type: { in: graphTypes } }) } })
    const nodeIds = new Set(nodes.map((node) => node.nodeId))
    const edges = await prisma.edgeIndex.findMany({ where: { workspaceId: req.params.id, ...(showAll ? {} : { edgeType: { in: edgeTypes } }) } })
    res.json({ nodes, edges: showAll ? edges : edges.filter((edge) => nodeIds.has(edge.sourceNodeId) && !!edge.targetNodeId && nodeIds.has(edge.targetNodeId)) })
  }))
  router.get("/workspaces/:id/nodes/:nodeId/neighbors", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    await requireWorkspaceRole(user.id, req.params.id, "viewer")
    res.json(await getNeighbors(req.params.id, req.params.nodeId))
  }))
}
