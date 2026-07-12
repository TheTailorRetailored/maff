import express from "express"
import path from "node:path"
import { config } from "../config.js"
import { requireAuth, requirePermission, requireUser } from "../auth/oidc.js"
import { advertisedScopes, scopes } from "../auth/scopes.js"
import { requireWorkspaceRole } from "../auth/permissions.js"
import { prisma } from "../db/prisma.js"
import { assertInsideRoot } from "../vault/paths.js"
import { listMarkdownFiles, loadSkill } from "../skills/skillLoader.js"
import { getPrompt, listPrompts } from "../mcp/prompts.js"
import { mcpServerVersion, mcpToolsListResult } from "../mcp/server.js"
import { rebuildQuartz, quartzStatus } from "../mcp/tools/siteTools.js"
import { registerAuthDebugRoutes } from "./authDebug.js"
import { registerWorkspaceRoutes } from "./workspaces.js"
import { registerLeanRoutes } from "./lean.js"
import { registerResearchRuntimeRoutes } from "./research.js"
import { asyncHandler } from "./asyncHandler.js"
import { restAuthorizationRequirement } from "../auth/authorizationMatrix.js"

export function apiRouter() {
  const router = express.Router()
  router.use(requireAuth(scopes.maffRead))
  router.use((req, res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next()
    return requirePermission(restAuthorizationRequirement(req.method, req.path).scope)(req, res, next)
  })
  registerAuthDebugRoutes(router)
  registerWorkspaceRoutes(router)
  registerLeanRoutes(router)
  registerResearchRuntimeRoutes(router)

  router.get("/mcp/debug-tools", asyncHandler(async (_req, res) => {
    const result = mcpToolsListResult()
    res.json({
      serverVersion: mcpServerVersion,
      toolCount: result.tools.length,
      toolNames: result.tools.map((tool) => tool.name),
      tools: result.tools
    })
  }))

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
    resource: config.oidc.audience,
    authorization_servers: [config.oidc.issuer],
    scopes_supported: advertisedScopes,
    resource_documentation: config.publicBaseUrl
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
