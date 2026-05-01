import { prisma } from "../db/prisma.js"
import { getNode } from "./tools/nodeTools.js"
import { getNeighbors, getOpenGaps, getActiveRoutes } from "./tools/graphTools.js"
import { getPrompt } from "./prompts.js"
import { loadSkill } from "../skills/skillLoader.js"

export async function readResource(uri: string) {
  const [scheme, rest] = uri.split("://")
  if (scheme === "workspace") {
    const [workspaceId, kind] = rest.split("/")
    if (kind === "manifest") return prisma.workspace.findUnique({ where: { id: workspaceId }, include: { members: true } })
    if (kind === "recent") return prisma.nodeIndex.findMany({ where: { workspaceId }, orderBy: { updatedAtFromFrontmatter: "desc" }, take: 20 })
    if (kind === "open-gaps") return getOpenGaps(workspaceId)
    if (kind === "active-routes") return getActiveRoutes(workspaceId)
    if (kind === "tasks") return prisma.taskIndex.findMany({ where: { workspaceId }, orderBy: [{ priority: "desc" }, { createdAt: "asc" }] })
  }
  if (scheme === "node") {
    const [workspaceId, nodeId, kind] = rest.split("/")
    if (kind === "neighbors") return getNeighbors(workspaceId, nodeId)
    return getNode(workspaceId, nodeId)
  }
  if (scheme === "graph") {
    const [workspaceId] = rest.split("/")
    return { nodes: await prisma.nodeIndex.findMany({ where: { workspaceId } }), edges: await prisma.edgeIndex.findMany({ where: { workspaceId } }) }
  }
  if (scheme === "skill") return loadSkill(rest.split("/"))
  if (scheme === "prompt") return getPrompt(rest)
  throw new Error(`Unsupported resource URI: ${uri}`)
}

