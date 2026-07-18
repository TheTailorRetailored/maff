# LLM-Legible Release Contract

For the complete normative state-machine, evidence, transaction, testing, and operational specification, see [Maff Manuscript Lifecycle and Release System](./manuscript-lifecycle-system.md).

## Principle

Maff must not rely on a language model to obey an invariant that the exposed tool surface allows it to violate. Database constraints and transactional commands remain authoritative, while `get_project_release_contract` makes the same state machine explicit to model clients.

The contract is derived from `compute_submission_readiness`; it is not a second readiness evaluator. Its schema version, exact identifiers, blocker codes, and permitted mutation tools are stable machine-facing fields.

## Contract

Every response identifies:

- the current authoritative working `ManuscriptVersion`;
- the exact active release candidate, when one exists;
- the pinned readiness policy;
- invariant truths that clients must not reinterpret;
- classified blockers;
- exactly one next action;
- the only mutation tool permitted to advance release state;
- prohibited shortcuts that cannot satisfy release governance.
- the project's release-alignment classification when no working manuscript exists.

When `permitted_mutation_tools` is empty, an LLM must stop and surface the classified inconsistency. It must not manufacture progress through generic reviews, reports, audits, artifact metadata, lifecycle flags, or duplicate workstreams.

## Semantic transitions

`assess_project_release_alignment` classifies existing projects as natively aligned, mature-proof-graph ready for synthesis, legacy manuscript, research in progress, or inconsistent. `align_project_release_state` is the sole idempotent bridge for the two alignable legacy classes. It creates or reuses one bounded PaperWriter workstream and never invents approval, candidacy, audit evidence, or publication state.

`promote_manuscript_to_submission_candidate` is the only candidate-activation transition exposed to agents. It owns canonical promotion, lifecycle activation, load-bearing ledger selection, predecessor retirement, and the resulting readiness evaluation as one semantic operation.

`adopt_reviewed_manuscript_successor` is a separate, narrower working-authority transition. When readiness finds a non-current successor with explicit predecessor lineage, an exact successful managed build, and submitted independent exact-version approval covering every required obligation, the contract exposes only this operation. One serializable transaction checks the expected current pointer and every supplied evidence identifier, retires the predecessor as historical provenance, makes the successor current, and records adoption provenance. It deliberately does not change verification, proof-obligation, freeze, lifecycle, release-assessment, or publication state. Candidate activation can be offered only by the recomputed contract after adoption.

Gate work proceeds only through the contract-selected `claim_next_assignment` or `claim_next_review` path. Once all gates pass, idempotent `prepare_external_review_package` surfaces exact candidate bytes for third-party review while leaving the project active. Final release is a separate, explicit, idempotent `publish_manuscript` transition. Low-level storage and lifecycle details are implementation mechanisms, not alternate agent workflows.

## Blocker classes

Blockers distinguish missing research or release work, an explicit user decision, missing evidence, an external condition, and a system inconsistency. A workflow evidence inconsistency activates the circuit breaker and advertises no mutation tool, preventing repeated review from being mistaken for remediation.

## Compatibility

Historical aliases and evidence shapes are normalized before readiness classification. The contract reports only canonical semantics; clients never need to infer whether a legacy spelling, version number, hash, or report shape is equivalent.

## Working-version terminology

`ManuscriptVersion.isCanonical` is a legacy storage name for the current working manuscript. It does not mean reviewed, approved, frozen, submission-ready, or released. LLM-facing responses therefore expose `manuscript_authority.canonical_semantics=current_working_text_only`, `release_assessment_active`, and `approval_status`. Governance or lifecycle interpretations are never mathematical proof obligations, and the server rejects attempts to record them as such.

## Verification

Source smoke tests prove contract discovery, legacy-alignment guidance, candidate-activation guidance, external-review/package separation, prohibited circuit-breaker loopholes, and stable tool counts. The MMRW golden database replay starts with a mature proof graph and proves idempotent alignment, structured synthesis, deterministic build, exact-candidate promotion, every ordered review gate, immutable third-party handoff, external review import, explicit publication, and final idempotence.

A dedicated database regression additionally proves reviewed-successor discovery, atomic adoption, historical predecessor retention, exact review/build binding, preservation of mathematical and release fields, idempotence, and post-adoption retargeting of candidate activation to the successor.
