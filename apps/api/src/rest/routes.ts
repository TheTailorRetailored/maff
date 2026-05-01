import express from "express"
import path from "node:path"
import { config } from "../config.js"
import { requireAuth, requireUser } from "../auth/auth0.js"
import { scopes } from "../auth/scopes.js"
import { requireWorkspaceRole } from "../auth/permissions.js"
import { prisma } from "../db/prisma.js"
import { assertInsideRoot } from "../vault/paths.js"
import { listMarkdownFiles, loadSkill } from "../skills/skillLoader.js"
import { getPrompt, listPrompts } from "../mcp/prompts.js"
import { rebuildQuartz, quartzStatus } from "../mcp/tools/siteTools.js"
import { registerAuthDebugRoutes } from "./authDebug.js"
import { registerWorkspaceRoutes } from "./workspaces.js"
import { registerNodeRoutes } from "./nodes.js"
import { registerGraphRoutes } from "./graph.js"
import { registerTaskRoutes } from "./tasks.js"
import { registerLeanRoutes } from "./lean.js"
import { asyncHandler } from "./asyncHandler.js"

export function apiRouter() {
  const router = express.Router()
  router.use(requireAuth())
  registerAuthDebugRoutes(router)
  registerWorkspaceRoutes(router)
  registerNodeRoutes(router)
  registerGraphRoutes(router)
  registerTaskRoutes(router)
  registerLeanRoutes(router)

  router.get("/skills", asyncHandler(async (_req, res) => {
    const files = await listMarkdownFiles()
    res.json(files.map((f) => path.relative(config.skillsDir, f).replace(/\\/g, "/")))
  }))
  router.get("/skills/*", asyncHandler(async (req, res) => {
    const wildcard = (req.params as Record<string, string>)[0]
    const text = await loadSkill(wildcard.split("/"))
    if (!text) return res.status(404).json({ error: "not_found" })
    res.type("text/markdown").send(text)
  }))
  router.get("/prompts", asyncHandler(async (_req, res) => res.json(await listPrompts())))
  router.get("/prompts/:name", asyncHandler(async (req, res) => res.type("text/markdown").send(await getPrompt(req.params.name))))

  router.post("/workspaces/:id/quartz/rebuild", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    await requireWorkspaceRole(user.id, req.params.id, "owner")
    res.json(await rebuildQuartz(req.params.id, user.id))
  }))
  router.get("/workspaces/:id/quartz/status", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    await requireWorkspaceRole(user.id, req.params.id, "viewer")
    res.json(await quartzStatus(req.params.id))
  }))

  return router
}

export function oauthProtectedResource() {
  return {
    resource: config.auth0.audience,
    authorization_servers: [`https://${config.auth0.domain}`],
    scopes_supported: Object.values(scopes)
  }
}

export async function serveQuartzSite(req: express.Request, res: express.Response) {
  const user = requireUser(req)
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { slug: req.params.workspaceSlug } })
  await requireWorkspaceRole(user.id, workspace.id, "viewer")
  const rel = req.params[0] || "index.html"
  const root = path.resolve(config.dataDir, "quartz-sites", workspace.slug)
  const file = assertInsideRoot(root, path.resolve(root, rel))
  res.sendFile(file)
}
