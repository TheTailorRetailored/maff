import { createNodeTool } from "./nodeTools.js"
import { prisma } from "../../db/prisma.js"

export async function createTask(input: { workspaceId: string; targetNodeId: string; workflowType: string; priority: number; instructions: string; userId?: string }) {
  return createNodeTool({
    workspaceId: input.workspaceId,
    type: "Task",
    title: `Task - ${input.workflowType} - ${Date.now()}`,
    metadata: { workflow: input.workflowType, priority: input.priority, status: "open", target: input.targetNodeId },
    body: `# Task: ${input.workflowType}\n\n## Instructions\n\n${input.instructions}\n`,
    userId: input.userId
  })
}

export async function getNextTask(workspaceId: string) {
  return prisma.taskIndex.findFirst({ where: { workspaceId, status: "open" }, orderBy: [{ priority: "desc" }, { createdAt: "asc" }] })
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
      data: { assignedToUserId: userId, status: "claimed", claimedSessionId: sessionId ?? null, leaseExpiresAt }
    })
  })
}

export async function completeTask(workspaceId: string, taskId: string, outcomeSummary: string) {
  return prisma.taskIndex.update({ where: { id: taskId }, data: { status: "completed", leaseExpiresAt: null } })
}

export async function snoozeTask(workspaceId: string, taskId: string, reason: string) {
  return prisma.taskIndex.update({ where: { id: taskId }, data: { status: "snoozed", leaseExpiresAt: null } })
}

export async function releaseTask(workspaceId: string, taskId: string) {
  return prisma.taskIndex.update({ where: { id: taskId }, data: { status: "open", assignedToUserId: null, claimedSessionId: null, leaseExpiresAt: null } })
}

export async function heartbeatTask(workspaceId: string, taskId: string, workflow?: string) {
  const leaseMinutes = workflow?.startsWith("lean") || workflow?.startsWith("formalization") ? 60 : 20
  return prisma.taskIndex.update({ where: { id: taskId }, data: { leaseExpiresAt: new Date(Date.now() + leaseMinutes * 60 * 1000) } })
}
