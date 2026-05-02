import { appendToNodeTool, createNodeTool, getNode, replaceNodeSectionTool, setNodeStatus, updateNodeMetadataTool } from "./nodeTools.js"
import { createTask } from "./taskTools.js"
import { prisma } from "../../db/prisma.js"

function today() {
  return new Date().toISOString().slice(0, 10)
}

function shortTitle(text: string, prefix = "Claim") {
  return `${prefix} - ${text.replace(/\s+/g, " ").trim().slice(0, 72)}`
}

async function wikilinkFor(workspaceId: string, nodeId: string) {
  const node = await prisma.nodeIndex.findUnique({ where: { workspaceId_nodeId: { workspaceId, nodeId } } })
  return node ? `[[${node.title}]]` : nodeId
}

function claimBody(title: string, statement: string, motivation = "") {
  return `# Claim: ${title}\n\n## Statement\n\n${statement}\n\n## Status\n\nIdea captured. Proof status: none.\n\n## Role in project\n\n${motivation}\n\n## Dependencies\n\n\n## Proof routes\n\n\n## Informal proof\n\n\n## Lean formalization\n\nLean status: not_started\nLean file:\nLean theorem name:\n\n## Attempts and notes\n\n\n## Tasks\n\n\n## Decision log\n\n${today()}: Created as a Claim node.\n`
}

async function appendMetadataList(workspaceId: string, nodeId: string, field: string, values: string[], userId?: string) {
  const node = await prisma.nodeIndex.findUnique({ where: { workspaceId_nodeId: { workspaceId, nodeId } } })
  const metadata = (node?.metadata ?? {}) as Record<string, unknown>
  const current = Array.isArray(metadata[field]) ? metadata[field].map(String) : metadata[field] ? [String(metadata[field])] : []
  await updateNodeMetadataTool({ workspaceId, nodeId, patch: { [field]: [...new Set([...current, ...values])] }, userId })
}

export async function createProblem(input: { workspaceId: string; title: string; area: string; roughStatement: string; motivation: string; initialSources?: string[]; userId?: string }) {
  return createNodeTool({ workspaceId: input.workspaceId, type: "Problem", title: input.title, metadata: { area: input.area, status: "seed", initial_sources: input.initialSources ?? [] }, body: `# Problem: ${input.title}\n\n## Statement\n\n${input.roughStatement}\n\n## Motivation\n\n${input.motivation}\n\n## Decision log\n\n`, userId: input.userId })
}

export async function createConjecture(input: { workspaceId: string; problemId: string; statement: string; motivation: string; confidence: number; userId?: string }) {
  return createClaim({ workspaceId: input.workspaceId, problemId: input.problemId, statement: input.statement, motivation: input.motivation, claimKind: "conjecture", role: "main_result", confidence: input.confidence, userId: input.userId })
}

export async function createClaim(input: { workspaceId: string; problemId?: string; title?: string; statement: string; motivation?: string; claimKind?: string; role?: string; confidence?: number; userId?: string }) {
  const problem = input.problemId ? await wikilinkFor(input.workspaceId, input.problemId) : undefined
  const title = input.title ?? shortTitle(input.statement, "Claim")
  const metadata: Record<string, unknown> = {
    claim_kind: input.claimKind ?? "conjecture",
    claim_status: "idea",
    status: "active",
    role: input.role ?? "main_result",
    depends_on: [],
    supports: [],
    blocked_by: [],
    proof_status: "none",
    lean_status: "not_started",
    lean_file: "",
    lean_name: ""
  }
  if (problem) metadata.problem = problem
  if (input.confidence !== undefined) metadata.confidence = input.confidence
  return createNodeTool({
    workspaceId: input.workspaceId,
    type: "Claim",
    title,
    metadata,
    body: claimBody(title, input.statement, input.motivation),
    userId: input.userId
  })
}

export async function createRichClaim(input: {
  workspaceId: string
  problemId?: string
  title: string
  statement: string
  claimKind: string
  role: string
  claimStatus?: string
  proofStatus?: string
  leanStatus?: string
  dependsOn?: string[]
  supports?: string[]
  blockedBy?: string[]
  bodySections?: Record<string, string>
  userId?: string
}) {
  const problem = input.problemId ? await wikilinkFor(input.workspaceId, input.problemId) : undefined
  const section = (name: string, fallback = "") => input.bodySections?.[name] ?? fallback
  const metadata: Record<string, unknown> = {
    claim_kind: input.claimKind,
    claim_status: input.claimStatus ?? "idea",
    status: input.claimStatus === "killed" ? "killed" : "active",
    role: input.role,
    depends_on: input.dependsOn ?? [],
    supports: input.supports ?? [],
    blocked_by: input.blockedBy ?? [],
    proof_status: input.proofStatus ?? "none",
    lean_status: input.leanStatus ?? "not_started",
    lean_file: "",
    lean_name: ""
  }
  if (problem) metadata.problem = problem
  return createNodeTool({
    workspaceId: input.workspaceId,
    type: "Claim",
    title: input.title,
    metadata,
    body: `# Claim: ${input.title}

## Statement

${input.statement}

## Role in project

${section("Role in project")}

## Status

Claim status: ${metadata.claim_status}
Proof status: ${metadata.proof_status}

## Dependencies

${section("Dependencies", (input.dependsOn ?? []).map((dep) => `- ${dep}`).join("\n"))}

## Proof routes

${section("Proof routes")}

## Informal proof

${section("Informal proof")}

## Lean formalization

Lean status: ${metadata.lean_status}
Lean file:
Lean theorem name:

${section("Lean formalization")}

## Attempts and notes

${section("Attempts and notes")}

## Tasks

${section("Tasks")}

## Decision log

${today()}: Created as a claim-centric node.
`,
    userId: input.userId
  })
}

export async function updateClaimMetadata(input: { workspaceId: string; claimId: string; patch: Record<string, unknown>; userId?: string }) {
  const result = await updateNodeMetadataTool({ workspaceId: input.workspaceId, nodeId: input.claimId, patch: input.patch, userId: input.userId })
  await appendToNodeTool({ workspaceId: input.workspaceId, nodeId: input.claimId, section: "Decision log", content: `${today()}: Updated claim metadata: ${Object.keys(input.patch).join(", ")}`, userId: input.userId })
  return result
}

export async function updateClaimProofStatus(input: { workspaceId: string; claimId: string; proofStatus: string; claimStatus?: string; reason: string; userId?: string }) {
  const patch: Record<string, unknown> = { proof_status: input.proofStatus }
  if (input.claimStatus) patch.claim_status = input.claimStatus
  await updateNodeMetadataTool({ workspaceId: input.workspaceId, nodeId: input.claimId, patch, userId: input.userId })
  await appendToNodeTool({ workspaceId: input.workspaceId, nodeId: input.claimId, section: "Decision log", content: `${today()}: Proof status set to ${input.proofStatus}${input.claimStatus ? `; claim status set to ${input.claimStatus}` : ""}. ${input.reason}`, userId: input.userId })
  return { ok: true, claimId: input.claimId, proofStatus: input.proofStatus, claimStatus: input.claimStatus ?? null }
}

export async function createProofRoute(input: { workspaceId: string; targetNodeId: string; method: string; plan: string; killCondition: string; userId?: string }) {
  return addRouteToClaim({ workspaceId: input.workspaceId, claimId: input.targetNodeId, routeTitle: input.method, status: "active", confidence: "medium", method: input.method, strategy: input.plan, blockers: input.killCondition, userId: input.userId })
}

export async function logProofAttempt(input: { workspaceId: string; targetNodeId: string; routeNodeId?: string; summary: string; result: string; failureReason?: string; newGaps?: string[]; userId?: string }) {
  const gaps = input.newGaps?.length ? `\n\nNew gaps:\n${input.newGaps.map((gap) => `- ${gap}`).join("\n")}` : ""
  await appendToNodeTool({ workspaceId: input.workspaceId, nodeId: input.targetNodeId, section: "Attempts and notes", content: `### Attempt: ${input.result} (${today()})\n\nSummary:\n${input.summary}\n\nFailure reason:\n${input.failureReason ?? ""}${gaps}`, userId: input.userId })
  if (input.newGaps?.length) await appendToNodeTool({ workspaceId: input.workspaceId, nodeId: input.targetNodeId, section: "Proof routes", content: `Blockers identified ${today()}:\n${input.newGaps.map((gap) => `- ${gap}`).join("\n")}`, userId: input.userId })
  return { ok: true, targetNodeId: input.targetNodeId, result: input.result }
}

export async function createGap(input: { workspaceId: string; targetNodeId: string; statement: string; severity: string; possibleResolutions: string[]; userId?: string }) {
  await appendToNodeTool({ workspaceId: input.workspaceId, nodeId: input.targetNodeId, section: "Attempts and notes", content: `### Gap: ${input.statement.slice(0, 72)}\n\nSeverity: ${input.severity}\n\n${input.statement}\n\nPossible resolutions:\n${input.possibleResolutions.map((r) => `- ${r}`).join("\n") || "- TBD"}`, userId: input.userId })
  await updateNodeMetadataTool({ workspaceId: input.workspaceId, nodeId: input.targetNodeId, patch: { blocked_by: [input.statement], claim_status: "route_active" }, userId: input.userId })
  return { ok: true, targetNodeId: input.targetNodeId, gap: input.statement }
}

export async function addRouteToClaim(input: { workspaceId: string; claimId: string; routeTitle: string; status: string; confidence: string; method: string; strategy: string; proposedDecomposition?: string[]; blockers?: string; userId?: string }) {
  const decomposition = input.proposedDecomposition?.length ? input.proposedDecomposition.map((item) => `- ${item}`).join("\n") : "- TBD"
  await appendToNodeTool({
    workspaceId: input.workspaceId,
    nodeId: input.claimId,
    section: "Proof routes",
    content: `### Route: ${input.routeTitle}\n\nStatus: ${input.status}\nConfidence: ${input.confidence}\nMethod: ${input.method}\n\nStrategy:\n${input.strategy}\n\nProposed decomposition:\n${decomposition}\n\nBlockers:\n${input.blockers ?? "TBD"}\n\nAttempts:\n`,
    userId: input.userId
  })
  await updateNodeMetadataTool({ workspaceId: input.workspaceId, nodeId: input.claimId, patch: { claim_status: input.status === "successful" ? "proof_sketch" : "route_active" }, userId: input.userId })
  return { ok: true, claimId: input.claimId, routeTitle: input.routeTitle }
}

export async function updateClaimRoute(input: { workspaceId: string; claimId: string; routeTitleOrId: string; patch: Record<string, unknown>; userId?: string }) {
  await appendToNodeTool({ workspaceId: input.workspaceId, nodeId: input.claimId, section: "Proof routes", content: `### Route update: ${input.routeTitleOrId} (${today()})\n\n${JSON.stringify(input.patch, null, 2)}`, userId: input.userId })
  return { ok: true, claimId: input.claimId, route: input.routeTitleOrId }
}

export async function promoteRouteToNode(input: { workspaceId: string; claimId: string; routeTitleOrId: string; reason?: string; userId?: string }) {
  const claim = await prisma.nodeIndex.findUniqueOrThrow({ where: { workspaceId_nodeId: { workspaceId: input.workspaceId, nodeId: input.claimId } } })
  return createNodeTool({ workspaceId: input.workspaceId, type: "ProofRoute", title: `Route - ${input.routeTitleOrId}`, metadata: { target: `[[${claim.title}]]`, status: "active", promoted_from_claim: `[[${claim.title}]]`, promotion_reason: input.reason ?? "" }, body: `# Route: ${input.routeTitleOrId}\n\nPromoted from [[${claim.title}]].\n\nReason: ${input.reason ?? "Substantial route promoted for independent tracking."}\n\n## Plan\n\n`, userId: input.userId })
}

export async function addInformalProofToClaim(input: { workspaceId: string; claimId: string; proof: string; remainingCaveats?: string[]; userId?: string }) {
  await replaceNodeSectionTool({ workspaceId: input.workspaceId, nodeId: input.claimId, section: "Informal proof", content: `${input.proof}\n\nRemaining caveats:\n${input.remainingCaveats?.map((c) => `- ${c}`).join("\n") ?? "- None recorded"}`, userId: input.userId })
  await updateNodeMetadataTool({ workspaceId: input.workspaceId, nodeId: input.claimId, patch: { claim_status: "informally_proved", proof_status: input.remainingCaveats?.length ? "complete_modulo_dependencies" : "complete" }, userId: input.userId })
  return { ok: true, claimId: input.claimId }
}

export async function updateClaimLeanStatus(input: { workspaceId: string; claimId: string; leanStatus: string; leanFile?: string; leanName?: string; diagnostics?: string; notes?: string; userId?: string }) {
  await updateNodeMetadataTool({ workspaceId: input.workspaceId, nodeId: input.claimId, patch: { lean_status: input.leanStatus, lean_file: input.leanFile, lean_name: input.leanName, claim_status: input.leanStatus === "verified" ? "lean_verified" : "formalizing" }, userId: input.userId })
  await replaceNodeSectionTool({ workspaceId: input.workspaceId, nodeId: input.claimId, section: "Lean formalization", content: `Lean status: ${input.leanStatus}\nLean file: ${input.leanFile ?? ""}\nLean theorem name: ${input.leanName ?? ""}\n\nDiagnostics:\n${input.diagnostics ?? ""}\n\nNotes:\n${input.notes ?? ""}`, userId: input.userId })
  return { ok: true, claimId: input.claimId }
}

export async function updateClaimLeanStatusWithReason(input: { workspaceId: string; claimId: string; leanStatus: string; leanFile?: string; leanName?: string; reason?: string; userId?: string }) {
  await updateClaimLeanStatus({ workspaceId: input.workspaceId, claimId: input.claimId, leanStatus: input.leanStatus, leanFile: input.leanFile, leanName: input.leanName, notes: input.reason, userId: input.userId })
  await appendToNodeTool({ workspaceId: input.workspaceId, nodeId: input.claimId, section: "Decision log", content: `${today()}: Lean status set to ${input.leanStatus}. ${input.reason ?? ""}`, userId: input.userId })
  return { ok: true, claimId: input.claimId, leanStatus: input.leanStatus }
}

export async function decomposeClaim(input: { workspaceId: string; claimId: string; subclaims: string[]; userId?: string }) {
  await appendToNodeTool({ workspaceId: input.workspaceId, nodeId: input.claimId, section: "Dependencies", content: input.subclaims.map((claim) => `- ${claim}`).join("\n"), userId: input.userId })
  return { ok: true, claimId: input.claimId, subclaims: input.subclaims }
}

export async function decomposeClaimRich(input: { workspaceId: string; claimId: string; routeTitleOrId?: string; subclaims: Array<{ title: string; statement: string; claim_kind?: string; role?: string; create_as_node?: boolean; reason?: string }>; userId?: string }) {
  const parent = await prisma.nodeIndex.findUniqueOrThrow({ where: { workspaceId_nodeId: { workspaceId: input.workspaceId, nodeId: input.claimId } } })
  const created = []
  const lines = []
  for (const subclaim of input.subclaims) {
    if (subclaim.create_as_node) {
      const claim = await createRichClaim({
        workspaceId: input.workspaceId,
        problemId: typeof parent.metadata === "object" && parent.metadata && "problem" in parent.metadata ? String((parent.metadata as Record<string, unknown>).problem) : undefined,
        title: subclaim.title,
        statement: subclaim.statement,
        claimKind: subclaim.claim_kind ?? "lemma",
        role: subclaim.role ?? "supporting_lemma",
        supports: [`[[${parent.title}]]`],
        userId: input.userId
      })
      await appendMetadataList(input.workspaceId, input.claimId, "depends_on", [`[[${claim.metadata.title}]]`], input.userId)
      created.push(claim)
      lines.push(`- [[${claim.metadata.title}]]: ${subclaim.reason ?? subclaim.statement}`)
    } else {
      lines.push(`- ${subclaim.title}: ${subclaim.statement}${subclaim.reason ? ` Reason: ${subclaim.reason}` : ""}`)
    }
  }
  await appendToNodeTool({ workspaceId: input.workspaceId, nodeId: input.claimId, section: input.routeTitleOrId ? "Proof routes" : "Dependencies", content: `### Decomposition${input.routeTitleOrId ? ` for ${input.routeTitleOrId}` : ""} (${today()})\n\n${lines.join("\n")}`, userId: input.userId })
  return { ok: true, claimId: input.claimId, createdClaims: created }
}

export async function promoteInlineSubclaimToClaim(input: { workspaceId: string; parentClaimId: string; statement: string; role?: string; userId?: string }) {
  const parent = await prisma.nodeIndex.findUniqueOrThrow({ where: { workspaceId_nodeId: { workspaceId: input.workspaceId, nodeId: input.parentClaimId } } })
  const created = await createClaim({ workspaceId: input.workspaceId, title: shortTitle(input.statement, "Claim"), statement: input.statement, claimKind: "lemma", role: input.role ?? "supporting_lemma", userId: input.userId })
  await appendMetadataList(input.workspaceId, created.id, "supports", [`[[${parent.title}]]`], input.userId)
  await appendMetadataList(input.workspaceId, input.parentClaimId, "depends_on", [`[[${created.metadata.title}]]`], input.userId)
  await appendToNodeTool({ workspaceId: input.workspaceId, nodeId: input.parentClaimId, section: "Dependencies", content: `- [[${created.metadata.title}]]`, userId: input.userId })
  return created
}

export async function promoteInlineSubclaimToClaimRich(input: { workspaceId: string; parentClaimId: string; section?: string; itemText?: string; title: string; statement: string; claimKind?: string; role?: string; reason?: string; userId?: string }) {
  const parent = await prisma.nodeIndex.findUniqueOrThrow({ where: { workspaceId_nodeId: { workspaceId: input.workspaceId, nodeId: input.parentClaimId } } })
  const created = await createRichClaim({ workspaceId: input.workspaceId, title: input.title, statement: input.statement, claimKind: input.claimKind ?? "lemma", role: input.role ?? "supporting_lemma", supports: [`[[${parent.title}]]`], userId: input.userId })
  await appendToNodeTool({ workspaceId: input.workspaceId, nodeId: input.parentClaimId, section: input.section ?? "Dependencies", content: `- [[${created.metadata.title}]] promoted from inline item${input.itemText ? `: ${input.itemText}` : ""}. ${input.reason ?? ""}`, userId: input.userId })
  await appendMetadataList(input.workspaceId, input.parentClaimId, "depends_on", [`[[${created.metadata.title}]]`], input.userId)
  return created
}

export async function appendProofAttemptToClaim(input: { workspaceId: string; claimId: string; routeTitleOrId?: string; summary: string; result: string; details?: string; nextSteps?: string[]; userId?: string }) {
  await appendToNodeTool({ workspaceId: input.workspaceId, nodeId: input.claimId, section: "Attempts and notes", content: `### Proof attempt: ${input.result} (${today()})\n\nRoute: ${input.routeTitleOrId ?? "unspecified"}\n\nSummary:\n${input.summary}\n\nDetails:\n${input.details ?? ""}\n\nNext steps:\n${input.nextSteps?.map((s) => `- ${s}`).join("\n") ?? "- TBD"}`, userId: input.userId })
  return { ok: true, claimId: input.claimId }
}

export async function addInlineGapToClaim(input: { workspaceId: string; claimId: string; routeTitleOrId?: string; severity: string; statement: string; possibleResolutions?: string[]; userId?: string }) {
  await appendToNodeTool({ workspaceId: input.workspaceId, nodeId: input.claimId, section: "Attempts and notes", content: `### Inline gap: ${input.statement.slice(0, 72)} (${today()})\n\nRoute: ${input.routeTitleOrId ?? "unspecified"}\nSeverity: ${input.severity}\n\n${input.statement}\n\nPossible resolutions:\n${input.possibleResolutions?.map((r) => `- ${r}`).join("\n") ?? "- TBD"}`, userId: input.userId })
  return { ok: true, claimId: input.claimId }
}

export async function archiveNode(input: { workspaceId: string; nodeId: string; reason: string; userId?: string }) {
  await updateNodeMetadataTool({ workspaceId: input.workspaceId, nodeId: input.nodeId, patch: { status: "archived", claim_status: "killed", archived: true }, userId: input.userId })
  await appendToNodeTool({ workspaceId: input.workspaceId, nodeId: input.nodeId, section: "Decision log", content: `${today()}: Archived. ${input.reason}`, userId: input.userId })
  return { ok: true, nodeId: input.nodeId }
}

export async function computeClaimReadiness(input: { workspaceId: string; claimId: string }) {
  const node = await getNode(input.workspaceId, input.claimId)
  const metadata = node.metadata
  const missing = []
  if (!metadata.proof_status || metadata.proof_status === "none") missing.push("informal proof")
  if (metadata.blocked_by && Array.isArray(metadata.blocked_by) && metadata.blocked_by.length) missing.push("open blockers")
  if (!metadata.lean_status || metadata.lean_status === "not_started") missing.push("Lean formalization")
  return { claimId: input.claimId, claimStatus: metadata.claim_status, proofStatus: metadata.proof_status, leanStatus: metadata.lean_status, readyForLean: metadata.proof_status === "complete" || metadata.proof_status === "complete_modulo_dependencies", missing }
}

export async function completeWorkflow(input: { workspaceId: string; nodeId: string; workflowType: string; summary: string; graphUpdates?: unknown; userId?: string }) {
  await appendToNodeTool({ workspaceId: input.workspaceId, nodeId: input.nodeId, section: "Decision log", content: `${new Date().toISOString().slice(0, 10)}: Completed ${input.workflowType}. ${input.summary}`, userId: input.userId })
  const summary = input.summary.toLowerCase()
  const followUp =
    input.workflowType === "literature_check" ? "generate_routes" :
    input.workflowType === "generate_routes" ? "attack_route" :
    input.workflowType === "attack_route" && summary.includes("gap") ? "gap_analysis" :
    input.workflowType === "attack_route" && summary.includes("proof candidate") ? "hostile_review" :
    input.workflowType === "hostile_review" && (summary.includes("fatal") || summary.includes("gap")) ? "gap_analysis" :
    input.workflowType === "hostile_review" && (summary.includes("passed") || summary.includes("ready")) ? "paper_outline" :
    input.workflowType === "lean_handoff" ? "lean_stub_generation" :
    input.workflowType === "lean_proof_repair" && summary.includes("failed") ? "formalization_gap_analysis" :
    null
  const task = followUp ? await createTask({ workspaceId: input.workspaceId, targetNodeId: input.nodeId, workflowType: followUp, title: `Follow-up: ${followUp}`, priority: 1, instructions: `Follow-up after ${input.workflowType}: ${input.summary}`, userId: input.userId }) : null
  return { ok: true, graphUpdates: input.graphUpdates ?? null, followUpTask: task }
}

export const researchExtras = {
  create_counterexample: (input: any) => createNodeTool({ workspaceId: input.workspaceId, type: "Counterexample", title: `Counterexample - ${Date.now()}`, metadata: { target: input.targetNodeId, status: "active", artifacts: input.artifacts ?? [] }, body: `# Counterexample\n\n## Construction\n\n${input.construction}\n\n## Explanation\n\n${input.explanation}\n`, userId: input.userId }),
  create_experiment: (input: any) => createNodeTool({ workspaceId: input.workspaceId, type: "Experiment", title: input.title, metadata: { problem: input.problemId, status: "queued", code_ref: input.codeRef, parameters: input.parameters ?? {} }, body: `# Experiment: ${input.title}\n\n## Hypothesis\n\n${input.hypothesis}\n`, userId: input.userId }),
  log_experiment_result: (input: any) => appendToNodeTool({ workspaceId: input.workspaceId, nodeId: input.experimentId, section: "Results", content: `${input.resultSummary}\n\nImplications: ${input.implications ?? ""}`, userId: input.userId }),
  create_literature_source: (input: any) => createNodeTool({ workspaceId: input.workspaceId, type: "Paper", title: input.title, metadata: { authors: input.authors, year: input.year, citation: input.citation, relevance: input.relevance }, body: `# Paper: ${input.title}\n\n## Notes\n\n${input.notes}\n`, userId: input.userId }),
  mark_claim_novelty: (input: any) => appendToNodeTool({ workspaceId: input.workspaceId, nodeId: input.claimId, section: "Novelty", content: `${input.noveltyStatus}\n\n${input.evidence}`, userId: input.userId }),
  promote_to_theorem_candidate: (input: any) => setNodeStatus({ workspaceId: input.workspaceId, nodeId: input.conjectureId, status: "proof_candidate", reason: input.reason, userId: input.userId }),
  promote_to_informal_proof: (input: any) => addInformalProofToClaim({ workspaceId: input.workspaceId, claimId: input.claimId, proof: input.proofNodeBody, remainingCaveats: input.remainingCaveats, userId: input.userId }),
  pause_project: (input: any) => setNodeStatus({ workspaceId: input.workspaceId, nodeId: input.nodeId, status: "paused", reason: `${input.reason}. Revival trigger: ${input.revivalTrigger}`, userId: input.userId }),
  kill_project: (input: any) => setNodeStatus({ workspaceId: input.workspaceId, nodeId: input.nodeId, status: "killed", reason: `${input.reason}. Salvage: ${input.salvageValue}`, userId: input.userId })
}
