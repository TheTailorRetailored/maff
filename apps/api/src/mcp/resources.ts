import { prisma } from "../db/prisma.js"
import type { AuthClaims } from "../auth/auth0.js"
import { requireWorkspaceRole } from "../auth/permissions.js"
import { getNode } from "./tools/nodeTools.js"
import { getNeighbors, getOpenGaps, getActiveRoutes } from "./tools/graphTools.js"
import { getPrompt } from "./prompts.js"
import { listPrompts } from "./prompts.js"
import { loadSkill } from "../skills/skillLoader.js"
import { listMarkdownFiles } from "../skills/skillLoader.js"
import { config } from "../config.js"
import path from "node:path"

type ResourceContext = { userId: string; claims: AuthClaims }

async function requireViewer(ctx: ResourceContext, workspaceId: string) {
  return requireWorkspaceRole(ctx.userId, workspaceId, "viewer")
}

export async function listResources(ctx: ResourceContext) {
  const workspaces = await prisma.workspace.findMany({
    where: { members: { some: { userId: ctx.userId } } },
    include: { members: { where: { userId: ctx.userId } } }
  })
  const [prompts, skills] = await Promise.all([listPrompts(), listMarkdownFiles()])
  return {
    resources: [
      ...workspaces.flatMap((workspace) => [
      { uri: `workspace://${workspace.id}/manifest`, name: `${workspace.name} manifest`, mimeType: "application/json" },
      { uri: `workspace://${workspace.id}/recent`, name: `${workspace.name} recent nodes`, mimeType: "application/json" },
      { uri: `workspace://${workspace.id}/open-gaps`, name: `${workspace.name} open gaps`, mimeType: "application/json" },
      { uri: `workspace://${workspace.id}/tasks`, name: `${workspace.name} tasks`, mimeType: "application/json" },
      { uri: `graph://${workspace.id}/full`, name: `${workspace.name} graph`, mimeType: "application/json" }
      ]),
      ...prompts.map((name) => ({ uri: `prompt://${name}`, name: `Prompt: ${name}`, mimeType: "text/markdown" })),
      ...skills.map((file) => {
        const rel = path.relative(config.skillsDir, file).replace(/\\/g, "/")
        return { uri: `skill://${rel}`, name: `Skill: ${rel}`, mimeType: "text/markdown" }
      })
    ]
  }
}

export async function readResource(uri: string, ctx: ResourceContext) {
  const [scheme, rest] = uri.split("://")
  if (scheme === "workspace") {
    const [workspaceId, kind] = rest.split("/")
    const membership = await requireViewer(ctx, workspaceId)
    if (kind === "manifest") {
      const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } })
      const [nodeCount, taskCount, openGapCount] = await Promise.all([
        prisma.nodeIndex.count({ where: { workspaceId, stale: false } }),
        prisma.taskIndex.count({ where: { workspaceId, status: { in: ["open", "queued", "running"] } } }),
        prisma.nodeIndex.count({ where: { workspaceId, type: { in: ["Gap", "FormalizationGap"] }, status: { in: ["open", "active", "seed"] } } })
      ])
      return { id: workspace.id, slug: workspace.slug, name: workspace.name, type: workspace.type, currentUserRole: membership.role, counts: { nodes: nodeCount, tasks: taskCount, openGaps: openGapCount } }
    }
    if (kind === "recent") return prisma.nodeIndex.findMany({ where: { workspaceId }, orderBy: { updatedAtFromFrontmatter: "desc" }, take: 20 })
    if (kind === "open-gaps") return getOpenGaps(workspaceId)
    if (kind === "active-routes") return getActiveRoutes(workspaceId)
    if (kind === "tasks") return prisma.taskIndex.findMany({ where: { workspaceId }, orderBy: [{ priority: "desc" }, { createdAt: "asc" }] })
  }
  if (scheme === "node") {
    const [workspaceId, nodeId, kind] = rest.split("/")
    await requireViewer(ctx, workspaceId)
    if (kind === "neighbors") return getNeighbors(workspaceId, nodeId)
    return getNode(workspaceId, nodeId)
  }
  if (scheme === "graph") {
    const [workspaceId] = rest.split("/")
    await requireViewer(ctx, workspaceId)
    return { nodes: await prisma.nodeIndex.findMany({ where: { workspaceId } }), edges: await prisma.edgeIndex.findMany({ where: { workspaceId } }) }
  }
  if (scheme === "skill") return loadSkill(rest.split("/"))
  if (scheme === "prompt") return getPrompt(rest)
  throw new Error(`Unsupported resource URI: ${uri}`)
}
