import type { Router } from "express"
import { scopes } from "../auth/scopes.js"
import { requireUser } from "../auth/auth0.js"
import { requireWorkspaceRole } from "../auth/permissions.js"
import { prisma } from "../db/prisma.js"
import { reindexWorkspace } from "../vault/indexer.js"
import { asyncHandler } from "./asyncHandler.js"

export function registerWorkspaceRoutes(router: Router) {
  router.get("/workspaces", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    res.json(await prisma.workspace.findMany({ where: { members: { some: { userId: user.id } } }, orderBy: { createdAt: "asc" } }))
  }))

  router.post("/workspaces", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    const slug = String(req.body.slug ?? req.body.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
    const workspace = await prisma.workspace.create({ data: { slug, name: req.body.name, type: req.body.type ?? "private", ownerUserId: user.id } })
    await prisma.workspaceMember.create({ data: { workspaceId: workspace.id, userId: user.id, role: "owner" } })
    res.status(201).json(workspace)
  }))

  router.get("/workspaces/:id", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    await requireWorkspaceRole(user.id, req.params.id, "viewer")
    res.json(await prisma.workspace.findUniqueOrThrow({ where: { id: req.params.id } }))
  }))

  router.get("/workspaces/:id/summary", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    await requireWorkspaceRole(user.id, req.params.id, "viewer")
    const [nodes, tasks, gaps, routes] = await Promise.all([
      prisma.nodeIndex.count({ where: { workspaceId: req.params.id, stale: false } }),
      prisma.taskIndex.findMany({ where: { workspaceId: req.params.id, status: "open" }, orderBy: [{ priority: "desc" }, { createdAt: "asc" }], take: 10 }),
      prisma.nodeIndex.findMany({ where: { workspaceId: req.params.id, type: { in: ["Gap", "FormalizationGap"] }, status: { in: ["open", "active", "seed"] } }, take: 10 }),
      prisma.nodeIndex.findMany({ where: { workspaceId: req.params.id, type: "ProofRoute", status: { in: ["active", "route_active"] } }, take: 10 })
    ])
    res.json({ nodes, tasks, gaps, routes })
  }))

  router.post("/workspaces/:id/reindex", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    await requireWorkspaceRole(user.id, req.params.id, "editor")
    res.json(await reindexWorkspace(req.params.id, user.id))
  }))
}
