import type { Router } from "express"
import { requireUser } from "../auth/auth0.js"
import { requireWorkspaceRole } from "../auth/permissions.js"
import { prisma } from "../db/prisma.js"
import { completeTask, createTask, snoozeTask } from "../mcp/tools/taskTools.js"

export function registerTaskRoutes(router: Router) {
  router.get("/workspaces/:id/tasks", async (req, res) => {
    const user = requireUser(req)
    await requireWorkspaceRole(user.id, req.params.id, "viewer")
    res.json(await prisma.taskIndex.findMany({ where: { workspaceId: req.params.id }, orderBy: [{ priority: "desc" }, { createdAt: "asc" }] }))
  })
  router.post("/workspaces/:id/tasks", async (req, res) => {
    const user = requireUser(req)
    await requireWorkspaceRole(user.id, req.params.id, "editor")
    res.status(201).json(await createTask({ workspaceId: req.params.id, targetNodeId: req.body.targetNodeId, workflowType: req.body.workflowType, priority: Number(req.body.priority ?? 0), instructions: req.body.instructions, userId: user.id }))
  })
  router.post("/workspaces/:id/tasks/:taskId/complete", async (req, res) => {
    const user = requireUser(req)
    await requireWorkspaceRole(user.id, req.params.id, "editor")
    res.json(await completeTask(req.params.id, req.params.taskId, req.body.outcomeSummary))
  })
  router.post("/workspaces/:id/tasks/:taskId/snooze", async (req, res) => {
    const user = requireUser(req)
    await requireWorkspaceRole(user.id, req.params.id, "editor")
    res.json(await snoozeTask(req.params.id, req.params.taskId, req.body.reason))
  })
}
