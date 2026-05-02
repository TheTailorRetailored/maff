import type { Router } from "express"
import { requireUser } from "../auth/auth0.js"
import { requireWorkspaceRole } from "../auth/permissions.js"
import { prisma } from "../db/prisma.js"
import { getNeighbors, getProblemGraph, listProblemGraphs } from "../mcp/tools/graphTools.js"
import { asyncHandler } from "./asyncHandler.js"

export function registerGraphRoutes(router: Router) {
  router.get("/workspaces/:id/problems", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    await requireWorkspaceRole(user.id, req.params.id, "viewer")
    const statusFilter = typeof req.query.status === "string" ? req.query.status.split(",").filter(Boolean) : undefined
    res.json(await listProblemGraphs(req.params.id, statusFilter))
  }))

  router.get("/workspaces/:id/problems/:problemId/graph", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    await requireWorkspaceRole(user.id, req.params.id, "viewer")
    res.json(await getProblemGraph({
      workspaceId: req.params.id,
      problemId: req.params.problemId,
      mode: String(req.query.mode ?? "claim_graph"),
      selectedNodeId: typeof req.query.selectedNodeId === "string" ? req.query.selectedNodeId : undefined,
      depth: req.query.depth ? Number(req.query.depth) : undefined,
      includeArchived: req.query.includeArchived === "true" || req.query.showKilled === "true",
      includeTasks: req.query.includeTasks === "true",
      includeRoutes: req.query.includeRoutes === "true" || req.query.showRouteNodes === "true",
      includeAttempts: req.query.includeAttempts === "true" || req.query.showProofAttempts === "true",
      includeGaps: req.query.includeGaps === "true" || req.query.showGapNodes === "true",
      includeBodyWikilinks: req.query.includeBodyWikilinks === "true" || req.query.showBodyWikilinks === "true"
    }))
  }))

  router.get("/workspaces/:id/graph", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    await requireWorkspaceRole(user.id, req.params.id, "viewer")
    if (req.query.mode === "workspace_overview") {
      return res.json({ problems: await listProblemGraphs(req.params.id) })
    }
    if (typeof req.query.problemId === "string" || typeof req.query.problem_id === "string") {
      return res.json(await getProblemGraph({
        workspaceId: req.params.id,
        problemId: String(req.query.problemId ?? req.query.problem_id),
        mode: String(req.query.mode ?? "claim_graph"),
        selectedNodeId: typeof req.query.selectedNodeId === "string" ? req.query.selectedNodeId : undefined,
        depth: req.query.depth ? Number(req.query.depth) : undefined,
        includeArchived: req.query.includeArchived === "true" || req.query.showKilled === "true",
        includeTasks: req.query.includeTasks === "true",
        includeRoutes: req.query.includeRoutes === "true" || req.query.showRouteNodes === "true",
        includeAttempts: req.query.includeAttempts === "true" || req.query.showProofAttempts === "true",
        includeGaps: req.query.includeGaps === "true" || req.query.showGapNodes === "true",
        includeBodyWikilinks: req.query.includeBodyWikilinks === "true" || req.query.showBodyWikilinks === "true"
      }))
    }
    const [firstProblem] = await listProblemGraphs(req.params.id)
    if (firstProblem) return res.json(await getProblemGraph({ workspaceId: req.params.id, problemId: firstProblem.id }))
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
    const edgeTypes = ["main_claim", "depends_on", "cites", "related_papers"]
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
    })
  }))
  router.get("/workspaces/:id/nodes/:nodeId/neighbors", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    await requireWorkspaceRole(user.id, req.params.id, "viewer")
    res.json(await getNeighbors(req.params.id, req.params.nodeId))
  }))
}
