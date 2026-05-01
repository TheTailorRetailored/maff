import type { WorkspaceRole } from "@prisma/client"
import { prisma } from "../db/prisma.js"

const rank: Record<WorkspaceRole, number> = {
  viewer: 1,
  editor: 2,
  owner: 3,
  admin: 4
}

export async function getMembership(userId: string, workspaceId: string) {
  return prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId } } })
}

export async function requireWorkspaceRole(userId: string, workspaceId: string, minimum: WorkspaceRole) {
  const membership = await getMembership(userId, workspaceId)
  if (!membership || rank[membership.role] < rank[minimum]) {
    const err = new Error("Workspace permission denied")
    ;(err as Error & { status?: number }).status = 403
    throw err
  }
  return membership
}

export function roleCanWrite(role: WorkspaceRole) {
  return rank[role] >= rank.editor
}

