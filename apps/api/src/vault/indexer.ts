import fs from "node:fs/promises"
import path from "node:path"
import { Prisma } from "@prisma/client"
import { auditLog } from "../audit/auditLog.js"
import { prisma } from "../db/prisma.js"
import { bodyPreview } from "./markdown.js"
import { parseMarkdownFile } from "./parser.js"
import { vaultRoot } from "./paths.js"

async function walkMarkdown(root: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true })
    const nested = await Promise.all(entries.map(async (entry) => {
      const p = path.join(root, entry.name)
      if (entry.isDirectory()) return walkMarkdown(p)
      return entry.isFile() && entry.name.endsWith(".md") ? [p] : []
    }))
    return nested.flat()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
    throw error
  }
}

function dateOrNull(value: unknown) {
  if (!value) return null
  const d = new Date(String(value))
  return Number.isNaN(d.getTime()) ? null : d
}

function refKey(ref: string) {
  return ref.toLowerCase().replace(/\.md$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
}

export async function reindexWorkspace(workspaceId: string, userId?: string) {
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } })
  const root = vaultRoot(workspace.slug)
  await fs.mkdir(root, { recursive: true })
  const files = await walkMarkdown(root)
  const seen = new Set<string>()
  const seenTasks = new Set<string>()
  const parsedFiles = []

  for (const file of files) {
    const parsed = await parseMarkdownFile(file)
    const nodeId = String(parsed.metadata.id ?? refKey(parsed.title))
    const rel = path.relative(root, file).replace(/\\/g, "/")
    seen.add(nodeId)
    parsedFiles.push({ file, parsed, nodeId, rel })
    await prisma.nodeIndex.upsert({
      where: { workspaceId_nodeId: { workspaceId, nodeId } },
      update: {
        slug: refKey(parsed.title),
        title: parsed.title,
        type: String(parsed.metadata.type ?? "Note"),
        status: String(parsed.metadata.status ?? "seed"),
        area: parsed.metadata.area ? String(parsed.metadata.area) : null,
        path: rel,
        metadata: parsed.metadata as Prisma.InputJsonValue,
        bodyPreview: bodyPreview(parsed.body),
        createdAtFromFrontmatter: dateOrNull(parsed.metadata.created),
        updatedAtFromFrontmatter: dateOrNull(parsed.metadata.updated),
        indexedAt: new Date(),
        stale: false
      },
      create: {
        workspaceId,
        nodeId,
        slug: refKey(parsed.title),
        title: parsed.title,
        type: String(parsed.metadata.type ?? "Note"),
        status: String(parsed.metadata.status ?? "seed"),
        area: parsed.metadata.area ? String(parsed.metadata.area) : null,
        path: rel,
        metadata: parsed.metadata as Prisma.InputJsonValue,
        bodyPreview: bodyPreview(parsed.body),
        createdAtFromFrontmatter: dateOrNull(parsed.metadata.created),
        updatedAtFromFrontmatter: dateOrNull(parsed.metadata.updated)
      }
    })

    if (String(parsed.metadata.type) === "Task") {
      seenTasks.add(nodeId)
      await prisma.taskIndex.upsert({
        where: { workspaceId_nodeId: { workspaceId, nodeId } },
        update: {
          targetNodeId: typeof parsed.metadata.target === "string" ? refKey(parsed.metadata.target) : null,
          targetSection: typeof parsed.metadata.target_section === "string" ? parsed.metadata.target_section : null,
          workflow: String(parsed.metadata.workflow ?? "triage_problem"),
          title: String(parsed.metadata.title ?? parsed.title ?? "Task"),
          instructions: String(parsed.metadata.instructions ?? ""),
          priority: Number(parsed.metadata.priority ?? 0),
          status: String(parsed.metadata.status ?? "open"),
          claimedSessionId: typeof parsed.metadata.claimed_session_id === "string" ? parsed.metadata.claimed_session_id : null,
          leaseExpiresAt: dateOrNull(parsed.metadata.lease_expires_at),
          completedAt: dateOrNull(parsed.metadata.completed_at)
        },
        create: {
          workspaceId,
          nodeId,
          targetNodeId: typeof parsed.metadata.target === "string" ? refKey(parsed.metadata.target) : null,
          targetSection: typeof parsed.metadata.target_section === "string" ? parsed.metadata.target_section : null,
          workflow: String(parsed.metadata.workflow ?? "triage_problem"),
          title: String(parsed.metadata.title ?? parsed.title ?? "Task"),
          instructions: String(parsed.metadata.instructions ?? ""),
          priority: Number(parsed.metadata.priority ?? 0),
          status: String(parsed.metadata.status ?? "open"),
          claimedSessionId: typeof parsed.metadata.claimed_session_id === "string" ? parsed.metadata.claimed_session_id : null,
          leaseExpiresAt: dateOrNull(parsed.metadata.lease_expires_at),
          completedAt: dateOrNull(parsed.metadata.completed_at)
        }
      })
    }
  }

  const nodeLookup = new Map((await prisma.nodeIndex.findMany({ where: { workspaceId } })).flatMap((n) => [[refKey(n.title), n.nodeId], [refKey(n.nodeId), n.nodeId]]))
  await prisma.edgeIndex.deleteMany({ where: { workspaceId } })
  for (const { parsed, nodeId } of parsedFiles) {
    for (const edge of parsed.edges) {
      const targetNodeId = nodeLookup.get(refKey(edge.targetRef)) ?? null
      await prisma.edgeIndex.upsert({
        where: { workspaceId_sourceNodeId_targetNodeRef_edgeType: { workspaceId, sourceNodeId: nodeId, targetNodeRef: edge.targetRef, edgeType: edge.edgeType } },
        update: { targetNodeId, sourceField: edge.sourceField ?? null },
        create: { workspaceId, sourceNodeId: nodeId, targetNodeRef: edge.targetRef, targetNodeId, edgeType: edge.edgeType, sourceField: edge.sourceField ?? null }
      })
    }
  }

  await prisma.nodeIndex.updateMany({ where: { workspaceId, nodeId: { notIn: [...seen] } }, data: { stale: true } })
  if (seenTasks.size) await prisma.taskIndex.updateMany({ where: { workspaceId, nodeId: { notIn: [...seenTasks] }, status: { notIn: ["completed", "cancelled"] } }, data: { status: "cancelled", leaseExpiresAt: null } })
  await auditLog({ userId, workspaceId, action: "workspace.reindex", targetType: "Workspace", targetId: workspaceId, details: { files: files.length } })
  return { files: files.length, nodes: seen.size }
}
