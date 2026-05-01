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
  const result = await leanClient.check({ workspaceSlug: await workspaceSlug(input.workspaceId), filePath })
  await prisma.job.create({
    data: {
      workspaceId: input.workspaceId,
      type: "lean_check",
      status: result.success ? "succeeded" : "failed",
      input: { leanFileId: input.leanFileId, filePath },
      output: result,
      createdByUserId: (node.metadata as Record<string, string>).created_by_user_id ?? (await prisma.workspaceMember.findFirstOrThrow({ where: { workspaceId: input.workspaceId }, orderBy: { createdAt: "asc" } })).userId,
      startedAt: new Date(),
      finishedAt: new Date()
    }
  })
  return result
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
  mark_lean_verified: async (input: any) => {
    const latest = await prisma.job.findFirst({ where: { workspaceId: input.workspaceId, type: "lean_check", input: { path: ["leanFileId"], equals: input.leanTheoremNodeId } }, orderBy: { finishedAt: "desc" } })
    const output = latest?.output as Record<string, unknown> | null
    if (!latest || latest.status !== "succeeded" || output?.success !== true || output?.hasSorry === true || output?.hasAxiom === true) {
      return setNodeStatus({ workspaceId: input.workspaceId, nodeId: input.leanTheoremNodeId, status: "lean_checked", reason: "Conservative MVP: latest Lean check is missing, failed, or contains sorry/axiom.", userId: input.userId })
    }
    const linkedAssumptions = await prisma.edgeIndex.findMany({ where: { workspaceId: input.workspaceId, sourceNodeId: input.leanTheoremNodeId, edgeType: { in: ["depends_on", "blocked_by"] } } })
    if (linkedAssumptions.length > 0) {
      const nodes = await prisma.nodeIndex.findMany({ where: { workspaceId: input.workspaceId, nodeId: { in: linkedAssumptions.flatMap((e) => e.targetNodeId ? [e.targetNodeId] : []) }, status: { in: ["temporary_axiom", "unproved_dependency"] } } })
      if (nodes.length) return setNodeStatus({ workspaceId: input.workspaceId, nodeId: input.leanTheoremNodeId, status: "lean_checked", reason: "Linked temporary_axiom or unproved_dependency prevents lean_verified.", userId: input.userId })
    }
    return setNodeStatus({ workspaceId: input.workspaceId, nodeId: input.leanTheoremNodeId, status: "lean_verified", reason: `${input.theoremName} verified in ${input.fileRef}`, userId: input.userId })
  },
  create_assumption_entry: (input: any) => createNodeTool({ workspaceId: input.workspaceId, type: "FormalizationGap", title: `Assumption - ${input.statement.slice(0, 48)}`, metadata: { status: input.status, reason: input.reason }, body: `# Assumption\n\n${input.statement}\n`, userId: input.userId }),
  create_local_theorem_library_entry: async (input: any) => prisma.localTheorem.create({ data: { workspaceId: input.workspaceId, leanName: input.leanTheoremName, statement: input.statement, proofFile: input.proofFile, status: "proved_locally" } })
}
