import type { Router } from "express"
import { requireUser } from "../auth/auth0.js"
import { requireWorkspaceRole } from "../auth/permissions.js"
import { createLeanProject, createLeanStub, leanCheck, leanExtras, leanGoal } from "../mcp/tools/leanTools.js"
import * as runtime from "../research/runtime.js"
import { asyncHandler } from "./asyncHandler.js"

export function registerLeanRoutes(router: Router) {
  router.post("/workspaces/:id/lean/project", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    await requireWorkspaceRole(user.id, req.params.id, "editor")
    res.json(await createLeanProject({ workspaceId: req.params.id, projectName: req.body.projectName ?? "ResearchGraph" }))
  }))
  router.post("/workspaces/:id/lean/stub", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    await requireWorkspaceRole(user.id, req.params.id, "editor")
    res.json(await createLeanStub({ workspaceId: req.params.id, formalizationTargetId: req.body.formalizationTargetId, theoremStatement: req.body.theoremStatement, imports: req.body.imports, userId: user.id }))
  }))
  router.post("/workspaces/:id/lean/check", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    await requireWorkspaceRole(user.id, req.params.id, "editor")
    res.json(await leanCheck({ workspaceId: req.params.id, leanFileId: req.body.leanFileId, leanTheoremId: req.body.leanTheoremId, userId: user.id }))
  }))
  router.post("/workspaces/:id/lean/goal", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    await requireWorkspaceRole(user.id, req.params.id, "editor")
    res.json(await leanGoal({ workspaceId: req.params.id, leanFileId: req.body.leanFileId, position: req.body.position }))
  }))
  router.post("/workspaces/:id/lean/verify", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    await requireWorkspaceRole(user.id, req.params.id, "editor")
    res.json(await runtime.markLeanVerified({ workspaceId: req.params.id, leanTheoremId: req.body.leanTheoremId }))
  }))
  router.post("/workspaces/:id/lean/search", asyncHandler(async (req, res) => res.json(await leanExtras.lean_search_mathlib({ workspaceId: req.params.id, query: req.body.query }))))
}
