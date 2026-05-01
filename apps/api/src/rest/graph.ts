import type { Router } from "express"
import { requireUser } from "../auth/auth0.js"
import { requireWorkspaceRole } from "../auth/permissions.js"
import { prisma } from "../db/prisma.js"
import { getNeighbors } from "../mcp/tools/graphTools.js"

export function registerGraphRoutes(router: Router) {
  router.get("/workspaces/:id/graph", async (req, res) => {
    const user = requireUser(req)
    await requireWorkspaceRole(user.id, req.params.id, "viewer")
    res.json({ nodes: await prisma.nodeIndex.findMany({ where: { workspaceId: req.params.id, stale: false } }), edges: await prisma.edgeIndex.findMany({ where: { workspaceId: req.params.id } }) })
  })
  router.get("/workspaces/:id/nodes/:nodeId/neighbors", async (req, res) => {
    const user = requireUser(req)
    await requireWorkspaceRole(user.id, req.params.id, "viewer")
    res.json(await getNeighbors(req.params.id, req.params.nodeId))
  })
}

