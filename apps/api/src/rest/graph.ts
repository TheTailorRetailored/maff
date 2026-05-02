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
    const showKilled = req.query.showKilled === "true"
    const showRouteNodes = req.query.showRouteNodes === "true"
    const showProofAttempts = req.query.showProofAttempts === "true"
    const showGapNodes = req.query.showGapNodes === "true"
    const showBodyWikilinks = req.query.showBodyWikilinks === "true"
    const showContextEdges = req.query.showContextEdges === "true"
    const graphTypes = ["Problem", "Claim", "Definition", "Paper", "KnownResult", "Experiment", "Draft"]
    if (showRouteNodes) graphTypes.push("ProofRoute")
    if (showProofAttempts) graphTypes.push("ProofAttempt", "FormalizationAttempt")
    if (showGapNodes) graphTypes.push("Gap", "FormalizationGap")
    const edgeTypes = ["problem", "depends_on", "supports", "cites", "related_papers"]
    if (showContextEdges) edgeTypes.push("target", "targets", "formalizes")
    if (showBodyWikilinks) edgeTypes.push("links_to")
    const hiddenStatuses = ["killed", "archived", "cancelled", "completed"]
    const nodes = await prisma.nodeIndex.findMany({ where: { workspaceId: req.params.id, stale: false, type: { in: graphTypes }, ...(showKilled ? {} : { status: { notIn: hiddenStatuses } }) } })
    const nodeIds = new Set(nodes.map((node) => node.nodeId))
    const edges = await prisma.edgeIndex.findMany({ where: { workspaceId: req.params.id, edgeType: { in: edgeTypes } } })
    res.json({
      nodes,
      edges: edges
        .filter((edge) => nodeIds.has(edge.sourceNodeId) && !!edge.targetNodeId && nodeIds.has(edge.targetNodeId))
        .map((edge) => edge.edgeType === "problem" ? { ...edge, id: `${edge.id}-reverse`, sourceNodeId: edge.targetNodeId, targetNodeId: edge.sourceNodeId } : edge)
    })
  }))
  router.get("/workspaces/:id/nodes/:nodeId/neighbors", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    await requireWorkspaceRole(user.id, req.params.id, "viewer")
    res.json(await getNeighbors(req.params.id, req.params.nodeId))
  }))
}
