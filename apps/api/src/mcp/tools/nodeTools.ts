import { prisma } from "../../db/prisma.js"
import { reindexWorkspace } from "../../vault/indexer.js"
import { parseMarkdown } from "../../vault/parser.js"
import { appendToSection, createNode, readNodeFile, replaceSection, updateMetadata, linkNodes, } from "../../vault/writer.js"

export async function getNode(workspaceId: string, nodeId: string) {
  const file = await readNodeFile(workspaceId, nodeId)
  const parsed = parseMarkdown(file.raw)
  return { metadata: parsed.metadata, body: parsed.body, path: file.node.path }
}

export async function createNodeTool(input: { workspaceId: string; type: string; title: string; metadata?: Record<string, unknown>; body?: string; userId?: string }) {
  const created = await createNode(input)
  await reindexWorkspace(input.workspaceId, input.userId)
  return created
}

export async function updateNodeMetadataTool(input: { workspaceId: string; nodeId: string; patch: Record<string, unknown>; userId?: string }) {
  const result = await updateMetadata(input)
  await reindexWorkspace(input.workspaceId, input.userId)
  return result
}

export async function appendToNodeTool(input: { workspaceId: string; nodeId: string; section: string; content: string; userId?: string }) {
  await appendToSection(input)
  await reindexWorkspace(input.workspaceId, input.userId)
  return { ok: true }
}

export async function replaceNodeSectionTool(input: { workspaceId: string; nodeId: string; section: string; content: string; userId?: string }) {
  await replaceSection(input)
  await reindexWorkspace(input.workspaceId, input.userId)
  return { ok: true }
}

export async function linkNodesTool(input: { workspaceId: string; sourceNodeId: string; targetNodeId: string; edgeType: string; note?: string; userId?: string }) {
  await linkNodes(input)
  await reindexWorkspace(input.workspaceId, input.userId)
  return { ok: true }
}

export async function setNodeStatus(input: { workspaceId: string; nodeId: string; status: string; reason: string; userId?: string }) {
  await updateMetadata({ workspaceId: input.workspaceId, nodeId: input.nodeId, patch: { status: input.status }, userId: input.userId })
  await appendToSection({ workspaceId: input.workspaceId, nodeId: input.nodeId, section: "Decision log", content: `${new Date().toISOString().slice(0, 10)}: Status set to ${input.status}. ${input.reason}`, userId: input.userId })
  await reindexWorkspace(input.workspaceId, input.userId)
  return prisma.nodeIndex.findUnique({ where: { workspaceId_nodeId: { workspaceId: input.workspaceId, nodeId: input.nodeId } } })
}

