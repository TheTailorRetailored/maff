export const supportedTypes = [
  "Problem", "Conjecture", "TheoremCandidate", "Definition", "LemmaCandidate", "ProofRoute", "ProofAttempt", "Gap",
  "Counterexample", "Experiment", "Paper", "KnownResult", "InformalProof", "FormalizationTarget", "LeanTheorem",
  "FormalizationGap", "Task", "PausedProject", "KilledProject"
]

export const supportedStatuses = [
  "seed", "active", "lit_checked", "route_active", "proof_candidate", "informally_proved", "formalizing", "lean_verified",
  "paused", "killed", "paper_pipeline", "open", "closed", "queued", "running", "failed", "succeeded", "created", "snoozed"
]

export function defaultBody(type: string, title: string, body?: string) {
  if (body?.trim()) return body
  return `# ${type}: ${title}\n\n## Statement\n\n\n## Motivation\n\n\n## Decision log\n\n`
}

