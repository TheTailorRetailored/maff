export const RELEASE_CONTRACT_SCHEMA_VERSION = "maff.release-contract.v1"

type ReadinessLike = {
  submission_ready?: boolean
  status?: string
  policy_version?: string
  lifecycle_stage?: string
  release_assessment_active?: boolean
  canonical_manuscript?: { id?: string } | null
  release_candidate?: { id?: string } | null
  next_required_action?: { gate?: string; instruction?: string } | null
  workflow_circuit_breaker?: { active?: boolean; affected_gates?: string[]; instruction?: string | null } | null
  gates?: Record<string, { unresolved_external_review_ids?: string[] } | undefined>
  missing_gate_references?: readonly string[]
  blocking_object_references?: Array<{ type?: string; id?: string; path?: string[] }>
}

type ContractAction = {
  kind: string
  tool: string | null
  exact_target_id: string | null
  gate: string | null
  instruction: string
  requires_user_decision: boolean
  requires_administrator: boolean
}

const gateTool = (gate: string | undefined) => gate === "compile" || gate === "revision" ? "claim_next_assignment" : gate ? "claim_next_review" : null

/**
 * Stable, LLM-facing interpretation of release readiness.
 *
 * This is deliberately derived from readiness rather than a second policy
 * evaluator. It names the one permitted mutation path and makes common
 * shortcuts explicit so clients never need to reverse-engineer lifecycle flags.
 */
export function releaseContractForReadiness(readiness: ReadinessLike) {
  const workingVersionId = readiness.canonical_manuscript?.id ?? null
  const activeCandidateId = readiness.release_assessment_active ? readiness.release_candidate?.id ?? workingVersionId : null
  const circuitBreaker = readiness.workflow_circuit_breaker?.active === true
  const blockers: Array<Record<string, unknown>> = []

  if (!workingVersionId) blockers.push({
    code: "NO_WORKING_MANUSCRIPT",
    category: "missing_work",
    message: "No authoritative working manuscript version exists.",
    recovery_tool: "claim_next_assignment"
  })
  else if (!readiness.release_assessment_active) blockers.push({
    code: "RELEASE_ASSESSMENT_NOT_ACTIVATED",
    category: "user_decision",
    message: "The working manuscript is not an active release candidate. Final review gates are intentionally dormant.",
    recovery_tool: "promote_manuscript_to_submission_candidate"
  })

  if (readiness.release_assessment_active) {
    for (const gate of readiness.missing_gate_references ?? []) blockers.push({
      code: "RELEASE_GATE_UNSATISFIED",
      category: gate === "external_challenge_resolution" ? "external_condition" : "missing_evidence",
      gate,
      exact_target_id: activeCandidateId
    })
  }
  for (const reference of readiness.blocking_object_references ?? []) blockers.push({
    code: "TARGETED_BLOCKER_OPEN",
    category: "missing_work",
    object_type: reference.type ?? null,
    object_id: reference.id ?? null,
    path: reference.path ?? []
  })
  if (circuitBreaker) blockers.unshift({
    code: "WORKFLOW_EVIDENCE_INCONSISTENCY",
    category: "system_inconsistency",
    affected_gates: readiness.workflow_circuit_breaker?.affected_gates ?? [],
    message: readiness.workflow_circuit_breaker?.instruction ?? "Accepted evidence is not producing the expected gate transition.",
    recovery_tool: null
  })

  const unresolvedExternalReviewIds = readiness.gates?.external_challenge_resolution?.unresolved_external_review_ids ?? []
  let nextAction: ContractAction | null
  if (!workingVersionId) nextAction = {
    kind: "continue_manuscript_development",
    tool: "claim_next_assignment",
    exact_target_id: null,
    gate: null,
    instruction: "Claim the next ordinary manuscript-development assignment. Do not create final-review evidence.",
    requires_user_decision: false,
    requires_administrator: false
  }
  else if (!readiness.release_assessment_active) nextAction = {
    kind: "activate_release_candidate",
    tool: "promote_manuscript_to_submission_candidate",
    exact_target_id: workingVersionId,
    gate: null,
    instruction: "Use only after the user deliberately places this exact working manuscript into final submission assessment.",
    requires_user_decision: true,
    requires_administrator: false
  }
  else if (circuitBreaker) nextAction = {
    kind: "repair_workflow_evidence_transition",
    tool: null,
    exact_target_id: activeCandidateId,
    gate: readiness.workflow_circuit_breaker?.affected_gates?.[0] ?? null,
    instruction: readiness.workflow_circuit_breaker?.instruction ?? "Repair or classify the evidence transition; do not create another review.",
    requires_user_decision: false,
    requires_administrator: true
  }
  else if (unresolvedExternalReviewIds.length) nextAction = {
    kind: "triage_external_review",
    tool: "triage_external_review",
    exact_target_id: activeCandidateId,
    gate: "external_challenge_resolution",
    instruction: `Triage external review ${unresolvedExternalReviewIds[0]} in a fresh non-author context before continuing release gates.`,
    requires_user_decision: false,
    requires_administrator: false
  }
  else if ((readiness.blocking_object_references ?? []).length) nextAction = {
    kind: "resolve_targeted_blocker",
    tool: "claim_next_assignment",
    exact_target_id: activeCandidateId,
    gate: null,
    instruction: "Resolve the targeted blocker through the ordinary assignment frontier; do not create another release review.",
    requires_user_decision: false,
    requires_administrator: false
  }
  else if (readiness.submission_ready) nextAction = {
    kind: "publish_release_candidate",
    tool: "publish_manuscript",
    exact_target_id: activeCandidateId,
    gate: null,
    instruction: "Publish the exact active release candidate idempotently.",
    requires_user_decision: false,
    requires_administrator: false
  }
  else if (readiness.next_required_action) nextAction = {
    kind: readiness.next_required_action.gate === "revision" ? "create_exact_successor" : "complete_release_gate",
    tool: gateTool(readiness.next_required_action.gate),
    exact_target_id: activeCandidateId,
    gate: readiness.next_required_action.gate ?? null,
    instruction: readiness.next_required_action.instruction ?? "Complete only the named next release action.",
    requires_user_decision: false,
    requires_administrator: false
  }
  else nextAction = null

  return {
    schema_version: RELEASE_CONTRACT_SCHEMA_VERSION,
    authority: "compute_submission_readiness",
    policy_version: readiness.policy_version ?? null,
    state: !workingVersionId ? "no_working_manuscript" : !readiness.release_assessment_active ? "manuscript_development" : readiness.submission_ready ? "publication_candidate" : circuitBreaker ? "workflow_infrastructure_blocked" : "candidate_assessment",
    authoritative_ids: {
      current_working_manuscript_version_id: workingVersionId,
      active_release_candidate_version_id: activeCandidateId
    },
    invariant_truths: {
      readiness_is_authoritative: true,
      release_candidate_is_exact_and_immutable: activeCandidateId !== null,
      active_candidate_must_be_the_current_working_version: true,
      exact_version_reviews_are_non_transitive: true,
      generic_reports_cannot_satisfy_release_gates: true,
      artifact_metadata_without_managed_bytes_is_not_physical_evidence: true,
      audits_do_not_mutate_the_audited_project: true
    },
    blockers,
    next_action: nextAction,
    permitted_mutation_tools: nextAction?.tool ? [nextAction.tool] : [],
    prohibited_shortcuts: [
      { code: "NO_FLAG_COMPOSITION", message: "Do not emulate candidate activation by composing lower-level canonical, lifecycle, freeze, artifact, or verification mutations." },
      { code: "NO_GENERIC_REVIEW_SUBSTITUTION", message: "Do not use generic reports or unassigned reviews to manufacture release-gate evidence." },
      { code: "NO_DUPLICATE_GATE_WORK", message: "Do not repeat a completed or circuit-broken gate against the unchanged exact candidate." },
      { code: "NO_ARTIFACT_BLESSING", message: "Do not treat paths, hashes, or metadata as durable bytes; use Maff-managed build and ingestion paths." },
      { code: "NO_AUDIT_AS_PROGRESS", message: "Do not create an audit merely because ordinary release work remains incomplete." }
    ],
    enforcement: "Only the listed permitted_mutation_tools are valid release-progress paths. If none are listed, stop and surface the system inconsistency; never construct a workaround from lower-level records."
  }
}
