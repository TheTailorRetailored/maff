import { prisma } from "../db/prisma.js"

export async function enqueueJob(input: { workspaceId: string; createdByUserId: string; type: "lean_check" | "lean_stub" | "lean_proof_attempt" | "index_rebuild"; payload: unknown }) {
  return prisma.job.create({ data: { workspaceId: input.workspaceId, createdByUserId: input.createdByUserId, type: input.type, status: "queued", input: input.payload as object } })
}

