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

export async function claimTask(workspaceId: string, taskId: string, userId: string) {
  return prisma.taskIndex.update({ where: { id: taskId }, data: { assignedToUserId: userId, status: "running" } })
}

export async function completeTask(workspaceId: string, taskId: string, outcomeSummary: string) {
  return prisma.taskIndex.update({ where: { id: taskId }, data: { status: "closed" } })
}

export async function snoozeTask(workspaceId: string, taskId: string, reason: string) {
  return prisma.taskIndex.update({ where: { id: taskId }, data: { status: "snoozed" } })
}

