export const supportedTypes = [
  "Problem", "Claim", "Conjecture", "TheoremCandidate", "Definition", "LemmaCandidate", "ProofRoute", "ProofAttempt", "Gap",
  "Counterexample", "Experiment", "Paper", "KnownResult", "InformalProof", "FormalizationTarget", "LeanTheorem",
  "FormalizationGap", "Task", "PausedProject", "KilledProject"
]

export const supportedStatuses = [
  "seed", "active", "lit_checked", "route_active", "proof_candidate", "informally_proved", "formalizing", "lean_verified",
  "paused", "killed", "paper_pipeline", "open", "closed", "queued", "running", "failed", "succeeded", "created", "snoozed",
  "lean_checked", "temporary_axiom", "unproved_dependency", "idea", "precise", "proof_sketch", "false", "claimed", "cancelled", "archived"
]

export function defaultBody(type: string, title: string, body?: string) {
  if (body?.trim()) return body
  if (type === "Claim") {
    return `# Claim: ${title}\n\n## Statement\n\n\n## Status\n\n\n## Role in project\n\n\n## Dependencies\n\n\n## Proof routes\n\n\n## Informal proof\n\n\n## Lean formalization\n\nLean status: not_started\nLean file:\nLean theorem name:\n\n## Attempts and notes\n\n\n## Tasks\n\n\n## Decision log\n\n`
  }
  return `# ${type}: ${title}\n\n## Statement\n\n\n## Motivation\n\n\n## Decision log\n\n`
}
