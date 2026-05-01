import type { Router } from "express"
import { requireUser } from "../auth/auth0.js"
import { requireWorkspaceRole } from "../auth/permissions.js"
import { prisma } from "../db/prisma.js"
import { completeTask, createTask, snoozeTask } from "../mcp/tools/taskTools.js"
import { asyncHandler } from "./asyncHandler.js"

export function registerTaskRoutes(router: Router) {
  router.get("/workspaces/:id/tasks", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    await requireWorkspaceRole(user.id, req.params.id, "viewer")
    res.json(await prisma.taskIndex.findMany({ where: { workspaceId: req.params.id, ...(req.query.targetNodeId ? { targetNodeId: String(req.query.targetNodeId) } : {}) }, orderBy: [{ priority: "desc" }, { createdAt: "asc" }] }))
  }))
  router.post("/workspaces/:id/tasks", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    await requireWorkspaceRole(user.id, req.params.id, "editor")
    res.status(201).json(await createTask({ workspaceId: req.params.id, targetNodeId: req.body.targetNodeId, targetSection: req.body.targetSection, workflowType: req.body.workflowType ?? req.body.workflow, title: req.body.title, priority: Number(req.body.priority ?? 0), instructions: req.body.instructions, userId: user.id }))
  }))
  router.post("/workspaces/:id/tasks/:taskId/complete", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    await requireWorkspaceRole(user.id, req.params.id, "editor")
    res.json(await completeTask(req.params.id, req.params.taskId, req.body.outcomeSummary))
  }))
  router.post("/workspaces/:id/tasks/:taskId/snooze", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    await requireWorkspaceRole(user.id, req.params.id, "editor")
    res.json(await snoozeTask(req.params.id, req.params.taskId, req.body.reason))
  }))
}
