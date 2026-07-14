import path from "node:path"
import { prisma } from "../db/prisma.js"
import type { AuthClaims } from "../auth/oidc.js"
import { requireWorkspaceRole } from "../auth/permissions.js"
import { getPrompt, listPrompts } from "./prompts.js"
import { loadSkill, listMarkdownFiles } from "../skills/skillLoader.js"
import { config } from "../config.js"
import * as runtime from "../research/runtime.js"

type ResourceContext = { userId: string; claims: AuthClaims }

const introText = "Maff is a Co-Mathematician-style mathematical research operating system. Projects have explicit goals; specialist chats claim Workstreams; AgentRuns produce Reports; ReviewRounds gate completion; typed mathematical objects form the durable research graph. When the user says to work on the next part of a named Maff project, start with get_my_maff_context, resolve the project by title, slug, words, or acronym, then claim the next eligible assignment or review from durable state. Never ask the user to carry internal ids or a detailed handoff prompt between chats."

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
      { uri: "maff://intro", name: "Maff v2 introduction", mimeType: "text/plain" },
      { uri: "maff://my-context", name: "My Maff context", mimeType: "application/json" },
      ...workspaces.flatMap((workspace) => [
        { uri: `workspace://${workspace.id}/manifest`, name: `${workspace.name} manifest`, mimeType: "application/json" },
        { uri: `workspace://${workspace.id}/projects`, name: `${workspace.name} projects`, mimeType: "application/json" },
        { uri: `workspace://${workspace.id}/review-queue`, name: `${workspace.name} review queue`, mimeType: "application/json" }
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
  if (scheme === "maff" && rest === "my-context") return runtime.getMyMaffContext({ userId: ctx.userId })
  if (scheme === "workspace") {
    const [workspaceId, kind] = rest.split("/")
    const membership = await requireViewer(ctx, workspaceId)
    if (kind === "manifest") {
      const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } })
      const [projectCount, activeGoalCount, readyWorkstreamCount, needsReviewCount] = await Promise.all([
        prisma.project.count({ where: { workspaceId } }),
        prisma.projectGoal.count({ where: { workspaceId, status: { in: ["approved", "active"] } } }),
        prisma.workstream.count({ where: { workspaceId, status: { in: ["ready", "planned", "revision_required"] } } }),
        prisma.workstream.count({ where: { workspaceId, status: "needs_review" } })
      ])
      return {
        id: workspace.id,
        slug: workspace.slug,
        name: workspace.name,
        type: workspace.type,
        currentUserRole: membership.role,
        counts: { projects: projectCount, activeGoals: activeGoalCount, readyWorkstreams: readyWorkstreamCount, needsReview: needsReviewCount }
      }
    }
    if (kind === "projects") return runtime.listProjects(workspaceId)
    if (kind === "review-queue") return prisma.workstream.findMany({ where: { workspaceId, status: "needs_review" }, orderBy: { updatedAt: "desc" }, take: 50 })
  }
  if (scheme === "project") {
    const [workspaceId, projectId, kind] = rest.split("/")
    await requireViewer(ctx, workspaceId)
    if (kind === "control-room") return runtime.getProjectControlRoom(workspaceId, projectId)
    if (kind === "object-graph") return runtime.getObjectGraph({ workspaceId, projectId })
    return runtime.getProject(workspaceId, projectId)
  }
  if (scheme === "workstream") {
    const [workspaceId, workstreamId, kind] = rest.split("/")
    await requireViewer(ctx, workspaceId)
    if (kind === "briefing") return runtime.getAgentBriefing(workspaceId, workstreamId)
    return runtime.getWorkstream(workspaceId, workstreamId)
  }
  if (scheme === "skill") return loadSkill(rest.split("/"))
  if (scheme === "prompt") return getPrompt(rest)
  throw new Error(`Unsupported resource URI: ${uri}`)
}
