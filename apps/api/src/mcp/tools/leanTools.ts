import { prisma } from "../../db/prisma.js"
import { leanClient } from "../../lean/leanClient.js"
import * as runtime from "../../research/runtime.js"

async function workspaceSlug(workspaceId: string) {
  return (await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } })).slug
}

export async function createLeanProject(input: { workspaceId: string; projectName: string }) {
  return leanClient.createProject({ workspaceSlug: await workspaceSlug(input.workspaceId), projectName: input.projectName })
}

export async function createLeanStub(input: { workspaceId: string; formalizationTargetId: string; theoremStatement: string; imports?: string[]; userId?: string }) {
  const filePath = `ResearchGraph/Generated/${input.formalizationTargetId.replace(/[^a-zA-Z0-9_-]/g, "_")}.lean`
  const result = await leanClient.createStub({ workspaceSlug: await workspaceSlug(input.workspaceId), filePath, imports: input.imports ?? ["Mathlib"], theoremStatement: input.theoremStatement })
  const typedTarget = await prisma.formalizationTarget.findFirstOrThrow({ where: { workspaceId: input.workspaceId, id: input.formalizationTargetId } })
  const leanName = input.theoremStatement.match(/\btheorem\s+([A-Za-z0-9_'.]+)/)?.[1] ?? `maff_${typedTarget.id.replace(/-/g, "_")}`
  const leanTheorem = await runtime.createLeanTheorem({
    workspaceId: input.workspaceId,
    projectId: typedTarget.projectId,
    formalizationTargetId: typedTarget.id,
    leanName,
    proofFile: filePath,
    statementMarkdown: input.theoremStatement,
    status: "draft",
    hasSorry: /\bsorry\b/.test(input.theoremStatement),
    hasAxiom: /^\s*axiom\s+/m.test(input.theoremStatement)
  })
  return { result, leanTheorem }
}

export async function leanCheck(input: { workspaceId: string; leanTheoremId: string; userId?: string }) {
  return runtime.runLeanTheoremCheck({ workspaceId: input.workspaceId, leanTheoremId: input.leanTheoremId, userId: input.userId })
}

export async function leanGoal(input: { workspaceId: string; leanFileId: string; position: { line: number; column: number } }) {
  return leanClient.goal({ workspaceSlug: await workspaceSlug(input.workspaceId), filePath: input.leanFileId, line: input.position.line, column: input.position.column })
}
