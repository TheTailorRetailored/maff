import type { Router } from "express"
import { requireUser } from "../auth/auth0.js"
import { requireWorkspaceRole } from "../auth/permissions.js"
import { prisma } from "../db/prisma.js"
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

}
