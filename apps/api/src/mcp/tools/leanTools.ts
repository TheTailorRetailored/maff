import { prisma } from "../../db/prisma.js"
import { leanClient } from "../../lean/leanClient.js"
import { createNodeTool, setNodeStatus } from "./nodeTools.js"

async function workspaceSlug(workspaceId: string) {
  return (await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } })).slug
}

export async function createLeanProject(input: { workspaceId: string; projectName: string }) {
  return leanClient.createProject({ workspaceSlug: await workspaceSlug(input.workspaceId), projectName: input.projectName })
}

export async function createLeanStub(input: { workspaceId: string; formalizationTargetId: string; theoremStatement: string; imports?: string[]; userId?: string }) {
  const filePath = `ResearchGraph/Generated/${input.formalizationTargetId.replace(/[^a-zA-Z0-9_-]/g, "_")}.lean`
  const result = await leanClient.createStub({ workspaceSlug: await workspaceSlug(input.workspaceId), filePath, imports: input.imports ?? ["Mathlib"], theoremStatement: input.theoremStatement })
  const node = await createNodeTool({ workspaceId: input.workspaceId, type: "LeanTheorem", title: `Lean Theorem - ${input.formalizationTargetId}`, metadata: { formalizes: input.formalizationTargetId, status: "formalizing", proof_file: filePath }, body: `# Lean Theorem\n\n\`\`\`lean\n${input.theoremStatement}\n\`\`\`\n`, userId: input.userId })
  return { result, node }
}

export async function leanCheck(input: { workspaceId: string; leanFileId: string }) {
  const node = await prisma.nodeIndex.findUniqueOrThrow({ where: { workspaceId_nodeId: { workspaceId: input.workspaceId, nodeId: input.leanFileId } } })
  const filePath = String((node.metadata as Record<string, unknown>).proof_file ?? input.leanFileId)
  return leanClient.check({ workspaceSlug: await workspaceSlug(input.workspaceId), filePath })
}

export async function leanGoal(input: { workspaceId: string; leanFileId: string; position: { line: number; column: number } }) {
  const node = await prisma.nodeIndex.findUniqueOrThrow({ where: { workspaceId_nodeId: { workspaceId: input.workspaceId, nodeId: input.leanFileId } } })
  const filePath = String((node.metadata as Record<string, unknown>).proof_file ?? input.leanFileId)
  return leanClient.goal({ workspaceSlug: await workspaceSlug(input.workspaceId), filePath, line: input.position.line, column: input.position.column })
}

export async function createFormalizationTarget(input: { workspaceId: string; informalProofId: string; leanFeasibility: string; requiredDefinitions: string[]; theoremStub?: string; userId?: string }) {
  return createNodeTool({ workspaceId: input.workspaceId, type: "FormalizationTarget", title: `Formalization Target - ${input.informalProofId}`, metadata: { source_proof: input.informalProofId, status: "created", lean_feasibility: input.leanFeasibility, required_definitions: input.requiredDefinitions }, body: `# Formalization Target\n\n## Theorem stub\n\n\`\`\`lean\n${input.theoremStub ?? ""}\n\`\`\`\n`, userId: input.userId })
}

export const leanExtras = {
  lean_search_mathlib: async (input: any) => ({ supported: false, results: [], message: `MVP stub. Search local notes for: ${input.query}` }),
  lean_multi_attempt: async () => ({ supported: false, message: "Tactic multi-attempt is not implemented in MVP" }),
  log_lean_attempt: (input: any) => createNodeTool({ workspaceId: input.workspaceId, type: "ProofAttempt", title: `Lean Attempt - ${Date.now()}`, metadata: { target: input.formalizationTargetId, result: input.result, diagnostics: input.diagnostics, status: input.result === "succeeded" ? "succeeded" : "failed" }, body: `# Lean Attempt\n\n## Diagnostics\n\n\`\`\`\n${JSON.stringify(input.diagnostics, null, 2)}\n\`\`\`\n\n## Next gap\n\n${input.nextGap ?? ""}\n`, userId: input.userId }),
  mark_lean_verified: (input: any) => setNodeStatus({ workspaceId: input.workspaceId, nodeId: input.leanTheoremNodeId, status: "lean_verified", reason: `${input.theoremName} verified in ${input.fileRef}`, userId: input.userId }),
  create_assumption_entry: (input: any) => createNodeTool({ workspaceId: input.workspaceId, type: "FormalizationGap", title: `Assumption - ${input.statement.slice(0, 48)}`, metadata: { status: input.status, reason: input.reason }, body: `# Assumption\n\n${input.statement}\n`, userId: input.userId }),
  create_local_theorem_library_entry: async (input: any) => prisma.localTheorem.create({ data: { workspaceId: input.workspaceId, leanName: input.leanTheoremName, statement: input.statement, proofFile: input.proofFile, status: "proved_locally" } })
}

