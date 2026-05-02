import { randomUUID } from "node:crypto"
import { prisma } from "../../db/prisma.js"

export async function createTask(input: { workspaceId: string; targetNodeId: string; targetSection?: string; workflowType: string; title?: string; priority: number; instructions: string; userId?: string }) {
  const task = await prisma.taskIndex.create({
    data: {
      workspaceId: input.workspaceId,
      nodeId: `task-${randomUUID()}`,
      targetNodeId: input.targetNodeId,
      targetSection: input.targetSection ?? null,
      workflow: input.workflowType,
      title: input.title ?? input.workflowType.replace(/_/g, " "),
      instructions: input.instructions,
      priority: input.priority,
      status: "open"
    }
  })
  return task
}

export async function getNextTask(workspaceId: string, targetNodeId?: string) {
  return prisma.taskIndex.findFirst({ where: { workspaceId, status: "open", ...(targetNodeId ? { targetNodeId } : {}) }, orderBy: [{ priority: "desc" }, { createdAt: "asc" }] })
}

export async function claimTask(workspaceId: string, taskId: string | undefined, userId: string, sessionId?: string, workflow?: string) {
  const now = new Date()
  const leaseMinutes = workflow?.startsWith("lean") || workflow?.startsWith("formalization") ? 60 : 20
  const leaseExpiresAt = new Date(now.getTime() + leaseMinutes * 60 * 1000)
  return prisma.$transaction(async (tx) => {
    const task = taskId
      ? await tx.taskIndex.findFirst({
        where: { id: taskId, workspaceId, OR: [{ status: "open" }, { status: "claimed", leaseExpiresAt: { lt: now } }] }
      })
      : await tx.taskIndex.findFirst({
        where: { workspaceId, OR: [{ status: "open" }, { status: "claimed", leaseExpiresAt: { lt: now } }] },
        orderBy: [{ priority: "desc" }, { createdAt: "asc" }]
      })
    if (!task) throw Object.assign(new Error("No claimable task"), { status: 404 })
    return tx.taskIndex.update({
      where: { id: task.id },
      data: { assignedToUserId: userId, status: "claimed", claimedSessionId: sessionId ?? randomUUID(), leaseExpiresAt }
    })
  })
}

export async function completeTask(workspaceId: string, taskId: string, outcomeSummary: string, claimedSessionId?: string) {
  const task = await prisma.taskIndex.findFirstOrThrow({ where: { id: taskId, workspaceId } })
  if (claimedSessionId && task.claimedSessionId && task.claimedSessionId !== claimedSessionId) throw Object.assign(new Error("Task is claimed by another session"), { status: 409 })
  return prisma.taskIndex.update({ where: { id: taskId }, data: { status: "completed", leaseExpiresAt: null, completedAt: new Date() } })
}

export async function snoozeTask(workspaceId: string, taskId: string, reason: string, until?: string) {
  return prisma.taskIndex.update({ where: { id: taskId }, data: { status: "snoozed", leaseExpiresAt: null, snoozedUntil: until ? new Date(until) : null } })
}

export async function releaseTask(workspaceId: string, taskId: string, claimedSessionId?: string) {
  const task = await prisma.taskIndex.findFirstOrThrow({ where: { id: taskId, workspaceId } })
  if (claimedSessionId && task.claimedSessionId && task.claimedSessionId !== claimedSessionId) throw Object.assign(new Error("Task is claimed by another session"), { status: 409 })
  return prisma.taskIndex.update({ where: { id: taskId }, data: { status: "open", assignedToUserId: null, claimedSessionId: null, leaseExpiresAt: null } })
}

export async function heartbeatTask(workspaceId: string, taskId: string, workflow?: string, claimedSessionId?: string) {
  const leaseMinutes = workflow?.startsWith("lean") || workflow?.startsWith("formalization") ? 60 : 20
  const task = await prisma.taskIndex.findFirstOrThrow({ where: { id: taskId, workspaceId } })
  if (claimedSessionId && task.claimedSessionId && task.claimedSessionId !== claimedSessionId) throw Object.assign(new Error("Task is claimed by another session"), { status: 409 })
  return prisma.taskIndex.update({ where: { id: taskId }, data: { leaseExpiresAt: new Date(Date.now() + leaseMinutes * 60 * 1000) } })
}
