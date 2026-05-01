import { appendToNodeTool, createNodeTool, setNodeStatus } from "./nodeTools.js"
import { createTask } from "./taskTools.js"

export async function createProblem(input: { workspaceId: string; title: string; area: string; roughStatement: string; motivation: string; initialSources?: string[]; userId?: string }) {
  return createNodeTool({ workspaceId: input.workspaceId, type: "Problem", title: input.title, metadata: { area: input.area, status: "seed", initial_sources: input.initialSources ?? [] }, body: `# Problem: ${input.title}\n\n## Statement\n\n${input.roughStatement}\n\n## Motivation\n\n${input.motivation}\n\n## Decision log\n\n`, userId: input.userId })
}

export async function createConjecture(input: { workspaceId: string; problemId: string; statement: string; motivation: string; confidence: number; userId?: string }) {
  return createNodeTool({ workspaceId: input.workspaceId, type: "Conjecture", title: `Conjecture - ${input.statement.slice(0, 64)}`, metadata: { problem: input.problemId, confidence: input.confidence, novelty_status: "unknown", status: "active" }, body: `# Conjecture\n\n## Statement\n\n${input.statement}\n\n## Motivation\n\n${input.motivation}\n\n## Decision log\n\n`, userId: input.userId })
}

export async function createProofRoute(input: { workspaceId: string; targetNodeId: string; method: string; plan: string; killCondition: string; userId?: string }) {
  return createNodeTool({ workspaceId: input.workspaceId, type: "ProofRoute", title: `Route - ${input.method}`, metadata: { target: input.targetNodeId, status: "active", kill_condition: input.killCondition }, body: `# Route: ${input.method}\n\n## Plan\n\n${input.plan}\n\n## Kill condition\n\n${input.killCondition}\n`, userId: input.userId })
}

export async function logProofAttempt(input: { workspaceId: string; targetNodeId: string; routeNodeId?: string; summary: string; result: string; failureReason?: string; newGaps?: string[]; userId?: string }) {
  const attempt = await createNodeTool({ workspaceId: input.workspaceId, type: "ProofAttempt", title: `Attempt - ${input.result} - ${Date.now()}`, metadata: { target: input.targetNodeId, route: input.routeNodeId, result: input.result, status: input.result.includes("failed") ? "failed" : "active" }, body: `# Proof Attempt\n\n## Summary\n\n${input.summary}\n\n## Result\n\n${input.result}\n\n## Failure reason\n\n${input.failureReason ?? ""}\n`, userId: input.userId })
  if (input.newGaps) {
    for (const gap of input.newGaps) await createGap({ workspaceId: input.workspaceId, targetNodeId: input.targetNodeId, statement: gap, severity: "medium", possibleResolutions: [], userId: input.userId })
  }
  return attempt
}

export async function createGap(input: { workspaceId: string; targetNodeId: string; statement: string; severity: string; possibleResolutions: string[]; userId?: string }) {
  return createNodeTool({ workspaceId: input.workspaceId, type: "Gap", title: `Gap - ${input.statement.slice(0, 64)}`, metadata: { target: input.targetNodeId, severity: input.severity, status: "open" }, body: `# Gap\n\n## Statement\n\n${input.statement}\n\n## Possible resolutions\n\n${input.possibleResolutions.map((r) => `- ${r}`).join("\n")}\n`, userId: input.userId })
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
  const task = followUp ? await createTask({ workspaceId: input.workspaceId, targetNodeId: input.nodeId, workflowType: followUp, priority: 1, instructions: `Follow-up after ${input.workflowType}: ${input.summary}`, userId: input.userId }) : null
  return { ok: true, graphUpdates: input.graphUpdates ?? null, followUpTask: task }
}

export const researchExtras = {
  create_counterexample: (input: any) => createNodeTool({ workspaceId: input.workspaceId, type: "Counterexample", title: `Counterexample - ${Date.now()}`, metadata: { target: input.targetNodeId, status: "active", artifacts: input.artifacts ?? [] }, body: `# Counterexample\n\n## Construction\n\n${input.construction}\n\n## Explanation\n\n${input.explanation}\n`, userId: input.userId }),
  create_experiment: (input: any) => createNodeTool({ workspaceId: input.workspaceId, type: "Experiment", title: input.title, metadata: { problem: input.problemId, status: "queued", code_ref: input.codeRef, parameters: input.parameters ?? {} }, body: `# Experiment: ${input.title}\n\n## Hypothesis\n\n${input.hypothesis}\n`, userId: input.userId }),
  log_experiment_result: (input: any) => appendToNodeTool({ workspaceId: input.workspaceId, nodeId: input.experimentId, section: "Results", content: `${input.resultSummary}\n\nImplications: ${input.implications ?? ""}`, userId: input.userId }),
  create_literature_source: (input: any) => createNodeTool({ workspaceId: input.workspaceId, type: "Paper", title: input.title, metadata: { authors: input.authors, year: input.year, citation: input.citation, relevance: input.relevance }, body: `# Paper: ${input.title}\n\n## Notes\n\n${input.notes}\n`, userId: input.userId }),
  mark_claim_novelty: (input: any) => appendToNodeTool({ workspaceId: input.workspaceId, nodeId: input.claimId, section: "Novelty", content: `${input.noveltyStatus}\n\n${input.evidence}`, userId: input.userId }),
  promote_to_theorem_candidate: (input: any) => setNodeStatus({ workspaceId: input.workspaceId, nodeId: input.conjectureId, status: "proof_candidate", reason: input.reason, userId: input.userId }),
  promote_to_informal_proof: (input: any) => createNodeTool({ workspaceId: input.workspaceId, type: "InformalProof", title: `Informal Proof - ${input.claimId}`, metadata: { source_proof: input.claimId, status: "informally_proved", remaining_caveats: input.remainingCaveats }, body: input.proofNodeBody, userId: input.userId }),
  pause_project: (input: any) => setNodeStatus({ workspaceId: input.workspaceId, nodeId: input.nodeId, status: "paused", reason: `${input.reason}. Revival trigger: ${input.revivalTrigger}`, userId: input.userId }),
  kill_project: (input: any) => setNodeStatus({ workspaceId: input.workspaceId, nodeId: input.nodeId, status: "killed", reason: `${input.reason}. Salvage: ${input.salvageValue}`, userId: input.userId })
}
