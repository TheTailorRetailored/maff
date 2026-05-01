import { prisma } from "../db/prisma.js"

export async function auditLog(input: {
  userId?: string | null
  workspaceId?: string | null
  action: string
  targetType: string
  targetId?: string | null
  details?: unknown
}) {
  return prisma.auditLog.create({
    data: {
      userId: input.userId ?? null,
      workspaceId: input.workspaceId ?? null,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      details: (input.details ?? {}) as object
    }
  })
}
