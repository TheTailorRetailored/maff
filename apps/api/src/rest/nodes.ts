import type { Router } from "express"
import { requireUser } from "../auth/auth0.js"
import { requireWorkspaceRole } from "../auth/permissions.js"
import { prisma } from "../db/prisma.js"
import { searchNodes } from "../mcp/tools/graphTools.js"
import { appendToNodeTool, createNodeTool, getNode, replaceNodeSectionTool, setNodeStatus, updateNodeMetadataTool } from "../mcp/tools/nodeTools.js"

export function registerNodeRoutes(router: Router) {
  router.get("/workspaces/:id/nodes", async (req, res) => {
    const user = requireUser(req)
    await requireWorkspaceRole(user.id, req.params.id, "viewer")
    res.json(await searchNodes(req.params.id, String(req.query.q ?? ""), { type: req.query.type ? [String(req.query.type)] : undefined, limit: Number(req.query.limit ?? 100) }))
  })
  router.get("/workspaces/:id/nodes/:nodeId", async (req, res) => {
    const user = requireUser(req)
    await requireWorkspaceRole(user.id, req.params.id, "viewer")
    res.json(await getNode(req.params.id, req.params.nodeId))
  })
  router.post("/workspaces/:id/nodes", async (req, res) => {
    const user = requireUser(req)
    await requireWorkspaceRole(user.id, req.params.id, "editor")
    res.status(201).json(await createNodeTool({ workspaceId: req.params.id, type: req.body.type, title: req.body.title, metadata: req.body.metadata, body: req.body.body, userId: user.id }))
  })
  router.patch("/workspaces/:id/nodes/:nodeId/metadata", async (req, res) => {
    const user = requireUser(req)
    await requireWorkspaceRole(user.id, req.params.id, "editor")
    res.json(await updateNodeMetadataTool({ workspaceId: req.params.id, nodeId: req.params.nodeId, patch: req.body, userId: user.id }))
  })
  router.post("/workspaces/:id/nodes/:nodeId/append", async (req, res) => {
    const user = requireUser(req)
    await requireWorkspaceRole(user.id, req.params.id, "editor")
    res.json(await appendToNodeTool({ workspaceId: req.params.id, nodeId: req.params.nodeId, section: req.body.section, content: req.body.content, userId: user.id }))
  })
  router.post("/workspaces/:id/nodes/:nodeId/replace-section", async (req, res) => {
    const user = requireUser(req)
    await requireWorkspaceRole(user.id, req.params.id, "editor")
    res.json(await replaceNodeSectionTool({ workspaceId: req.params.id, nodeId: req.params.nodeId, section: req.body.section, content: req.body.content, userId: user.id }))
  })
  router.post("/workspaces/:id/nodes/:nodeId/status", async (req, res) => {
    const user = requireUser(req)
    await requireWorkspaceRole(user.id, req.params.id, "editor")
    res.json(await setNodeStatus({ workspaceId: req.params.id, nodeId: req.params.nodeId, status: req.body.status, reason: req.body.reason, userId: user.id }))
  })
  router.get("/workspaces/:id/node-index/:nodeId", async (req, res) => {
    res.json(await prisma.nodeIndex.findUnique({ where: { workspaceId_nodeId: { workspaceId: req.params.id, nodeId: req.params.nodeId } } }))
  })
}

