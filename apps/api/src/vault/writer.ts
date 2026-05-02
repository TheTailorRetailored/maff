import fs from "node:fs/promises"
import path from "node:path"
import { auditLog } from "../audit/auditLog.js"
import { prisma } from "../db/prisma.js"
import { appendToSection as appendSectionText, replaceSection as replaceSectionText } from "./markdown.js"
import { dumpMarkdown, parseMarkdown } from "./parser.js"
import { backupPath, nodePath, slugify, vaultRoot } from "./paths.js"
import { defaultBody } from "./templates.js"
import { asWikilink } from "./wikilinks.js"

async function getWorkspace(workspaceId: string) {
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } })
  await fs.mkdir(vaultRoot(workspace.slug), { recursive: true })
  return workspace
}

export async function readNodeFile(workspaceId: string, nodeId: string) {
  const workspace = await getWorkspace(workspaceId)
  const node = await prisma.nodeIndex.findUniqueOrThrow({ where: { workspaceId_nodeId: { workspaceId, nodeId } } })
  const abs = path.join(vaultRoot(workspace.slug), node.path)
  return { workspace, node, abs, raw: await fs.readFile(abs, "utf8") }
}

async function writeBackup(workspaceSlug: string, relative: string, raw: string) {
  const backup = backupPath(workspaceSlug, relative)
  await fs.mkdir(path.dirname(backup), { recursive: true })
  await fs.writeFile(backup, raw)
}

export async function createNode(input: {
  workspaceId: string
  type: string
  title: string
  metadata?: Record<string, unknown>
  body?: string
  userId?: string
}) {
  const workspace = await getWorkspace(input.workspaceId)
  const id = String(input.metadata?.id ?? `${slugify(input.type)}-${slugify(input.title)}`)
  const now = new Date().toISOString().slice(0, 10)
  const metadata = {
    id,
    type: input.type,
    status: input.metadata?.status ?? (input.type === "Task" ? "open" : "seed"),
    workspace: workspace.slug,
    workspace_id: input.workspaceId,
    created: input.metadata?.created ?? now,
    updated: now,
    title: input.title,
    ...(input.metadata ?? {})
  }
  const file = nodePath(workspace.slug, input.type, input.title)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, dumpMarkdown(metadata, defaultBody(input.type, input.title, input.body)))
  await auditLog({ userId: input.userId, workspaceId: input.workspaceId, action: "node.create", targetType: input.type, targetId: id, details: { title: input.title } })
  return { id, path: path.relative(vaultRoot(workspace.slug), file).replace(/\\/g, "/"), metadata }
}

export async function updateMetadata(input: { workspaceId: string; nodeId: string; patch: Record<string, unknown>; userId?: string }) {
  const { workspace, node, abs, raw } = await readNodeFile(input.workspaceId, input.nodeId)
  await writeBackup(workspace.slug, node.path, raw)
  const parsed = parseMarkdown(raw)
  const metadata = { ...parsed.metadata, ...input.patch, updated: new Date().toISOString().slice(0, 10) }
  await fs.writeFile(abs, dumpMarkdown(metadata, parsed.body))
  await auditLog({ userId: input.userId, workspaceId: input.workspaceId, action: "node.metadata.update", targetType: "Node", targetId: input.nodeId, details: input.patch })
  return metadata
}

export async function appendToSection(input: { workspaceId: string; nodeId: string; section: string; content: string; userId?: string }) {
  const { workspace, node, abs, raw } = await readNodeFile(input.workspaceId, input.nodeId)
  await writeBackup(workspace.slug, node.path, raw)
  const parsed = parseMarkdown(raw)
  const body = appendSectionText(parsed.body, input.section, input.content)
  await fs.writeFile(abs, dumpMarkdown({ ...parsed.metadata, updated: new Date().toISOString().slice(0, 10) }, body))
  await auditLog({ userId: input.userId, workspaceId: input.workspaceId, action: "node.section.append", targetType: "Node", targetId: input.nodeId, details: { section: input.section } })
}

export async function replaceSection(input: { workspaceId: string; nodeId: string; section: string; content: string; userId?: string }) {
  const { workspace, node, abs, raw } = await readNodeFile(input.workspaceId, input.nodeId)
  await writeBackup(workspace.slug, node.path, raw)
  const parsed = parseMarkdown(raw)
  const body = replaceSectionText(parsed.body, input.section, input.content)
  await fs.writeFile(abs, dumpMarkdown({ ...parsed.metadata, updated: new Date().toISOString().slice(0, 10) }, body))
  await auditLog({ userId: input.userId, workspaceId: input.workspaceId, action: "node.section.replace", targetType: "Node", targetId: input.nodeId, details: { section: input.section } })
}

export async function linkNodes(input: { workspaceId: string; sourceNodeId: string; targetNodeId: string; edgeType: string; note?: string; userId?: string }) {
  const target = await prisma.nodeIndex.findUniqueOrThrow({ where: { workspaceId_nodeId: { workspaceId: input.workspaceId, nodeId: input.targetNodeId } } })
  await appendToSection({
    workspaceId: input.workspaceId,
    nodeId: input.sourceNodeId,
    section: "Related",
    content: `- ${input.edgeType}: ${asWikilink(target.title)}${input.note ? ` - ${input.note}` : ""}`,
    userId: input.userId
  })
}
