# LLM-Legible Release Contract

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

When `permitted_mutation_tools` is empty, an LLM must stop and surface the classified inconsistency. It must not manufacture progress through generic reviews, reports, audits, artifact metadata, lifecycle flags, or duplicate workstreams.

## Semantic transitions

`promote_manuscript_to_submission_candidate` is the only candidate-activation transition exposed to agents. It owns canonical promotion, lifecycle activation, load-bearing ledger selection, predecessor retirement, and the resulting readiness evaluation as one semantic operation.

Gate work proceeds only through the contract-selected `claim_next_assignment` or `claim_next_review` path. Publication proceeds only through idempotent `publish_manuscript`. Low-level storage and lifecycle details are implementation mechanisms, not alternate agent workflows.

## Blocker classes

Blockers distinguish missing research or release work, an explicit user decision, missing evidence, an external condition, and a system inconsistency. A workflow evidence inconsistency activates the circuit breaker and advertises no mutation tool, preventing repeated review from being mistaken for remediation.

## Compatibility

Historical aliases and evidence shapes are normalized before readiness classification. The contract reports only canonical semantics; clients never need to infer whether a legacy spelling, version number, hash, or report shape is equivalent.

## Verification

Source smoke tests prove contract discovery, candidate-activation guidance, prohibited circuit-breaker loopholes, and stable tool counts. Database smoke tests prove that the contract's working and candidate identifiers match the transactional promotion result and that missing compile evidence selects the authoring/build path rather than reviewer work.
