import { prisma } from "../db/prisma.js"
import type { AuthClaims } from "../auth/auth0.js"
import { requireWorkspaceRole } from "../auth/permissions.js"
import { getNode } from "./tools/nodeTools.js"
import { getNeighbors, getOpenGaps, getActiveRoutes, getProblemGraph } from "./tools/graphTools.js"
import { getPrompt } from "./prompts.js"
import { listPrompts } from "./prompts.js"
import { loadSkill } from "../skills/skillLoader.js"
import { listMarkdownFiles } from "../skills/skillLoader.js"
import { config } from "../config.js"
import path from "node:path"

type ResourceContext = { userId: string; claims: AuthClaims }
const introText = "Maff is a tool-first, claim-centric private math research graph. Problems organize projects; Claims represent conjectures, theorems, lemmas, reductions, and counterexample statements; Claims form the recursive proof-dependency graph. Routes, proof attempts, minor gaps, Lean notes, and tasks usually attach to Claim nodes instead of becoming graph nodes."

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
      { uri: "maff://intro", name: "Maff introduction", mimeType: "text/plain" },
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
  if (scheme === "maff" && rest === "intro") return introText
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
    const node = await getNode(workspaceId, nodeId)
    if (kind === "markdown") return node.body
    if (kind === "metadata") return node.metadata
    return node
  }
  if (scheme === "graph") {
    const [workspaceId, kind, id] = rest.split("/")
    await requireViewer(ctx, workspaceId)
    if (kind === "problem" && id) return getProblemGraph({ workspaceId, problemId: id })
    if (kind === "claim" && id) {
      const edges = await prisma.edgeIndex.findMany({ where: { workspaceId, OR: [{ sourceNodeId: id }, { targetNodeId: id }] } })
      const nodeIds = [...new Set([id, ...edges.flatMap((e) => [e.sourceNodeId, e.targetNodeId]).filter(Boolean) as string[]])]
      return { nodes: await prisma.nodeIndex.findMany({ where: { workspaceId, nodeId: { in: nodeIds } } }), edges }
    }
    const nodes = await prisma.nodeIndex.findMany({ where: { workspaceId, stale: false, type: { in: ["Problem", "Claim", "Definition", "Paper", "KnownResult", "Experiment", "Draft"] }, status: { notIn: ["killed", "archived", "cancelled"] } } })
    const nodeIds = new Set(nodes.map((node) => node.nodeId))
    const edges = await prisma.edgeIndex.findMany({ where: { workspaceId, edgeType: { in: ["main_claim", "depends_on", "cites", "related_papers"] } } })
    return {
      nodes,
      edges: edges
        .filter((edge) => nodeIds.has(edge.sourceNodeId) && edge.targetNodeId && nodeIds.has(edge.targetNodeId))
    }
  }
  if (scheme === "skill") return loadSkill(rest.split("/"))
  if (scheme === "prompt") return getPrompt(rest)
  throw new Error(`Unsupported resource URI: ${uri}`)
}
