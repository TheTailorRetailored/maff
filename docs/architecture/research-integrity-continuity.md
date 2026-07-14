# Research Integrity and Continuity

## Invariants

1. An active project always has runnable work, pending review, an explicit waiting condition, or a terminal justification.
2. Internal manuscript reviews count only when issued through a locked `ReviewAssignment`, submitted by its active AgentRun, and closed atomically with substantive evidence.
3. Reviewer independence is computed from append-only `ObjectContribution` provenance; callers cannot self-declare it.
4. Readiness is reconstructed from exact versions, physical artifacts, evidence contracts, open targeted gaps, and external challenges.
5. Audit reports are append-only and do not mutate the audited project. Repair begins in a fresh chat through a separate campaign.
6. Artifact ingestion, reviewer inspection, user surfacing, and publication are distinct operations.

## Lifecycle

The derived manuscript stages are `imported_unverified`, `draft`, `build_reproducible`, `proof_integration_checked`, `internally_refereed`, `external_challenge_resolved`, `publication_candidate`, and `publication_package_released`.

`publication_candidate` means that the configured evidence program has no known blocker. It is not an assertion of absolute mathematical truth or journal acceptance.

## Review integrity

`claim_next_review` creates a server-issued assignment bound to the exact target, reviewer run, computed independence class, sealed briefing, permitted artifacts, lease, and single-use token. Typed manuscript review creation without that assignment is rejected. Bare obligation ids are inventory only and never become preserved proof evidence.

The reviewer records exact access through `record_object_access`, submits structured `ReviewEvidenceSection` records, and finishes with `submit_run_outcome`. Construction-to-review transitions require a fresh chat.

## Continuity

Every AgentRun closes through `submit_run_outcome`, which records completed work, changes, evidence, checks, problems, uncertainty, gap deltas, and one next action. The detailed handoff stays in Maff. The user sees only `continue` when the current context remains eligible, or one generic project-level sentence when independence requires a fresh chat. A HostileReviewer context may drain multiple distinct eligible reviews; it must start a fresh chat before repairing or authoring.

Project lookup accepts exact ids, slugs, titles, distinctive title words, and unambiguous acronym prefixes. A new chat can therefore say `Work on the next part of my Maff project: MMRW.` Maff resolves the project and chooses the next eligible assignment or review; the user does not transport role names, workstream ids, or repair instructions.

Workstream review policy is applicability-based. Coordination, triage, literature evidence, gap analysis, experiment design, and mechanical Lean-check reports default to zero mandatory approvals and complete when their report is submitted. Proof attempts, counterexamples, computations, formalizations, and manuscript synthesis retain independent review by default. Dependencies respect the prerequisite's configured approval count; a zero-review prerequisite never needs a ceremonial approval. Computation may establish reproducibility through a structured database `Experiment` or a durable file artifact.

An audit distinguishes corrupted or falsely claimed evidence from work that is simply not finished yet. Missing source/PDF outputs on an ordinary working manuscript are release-plan items reported by readiness, not graph defects and not reasons to create an audit-repair campaign. An attached artifact whose bytes are missing or corrupt is a genuine integrity defect.

Evidence gates validate structured content, not verbosity. Review sections require a conclusion and concrete evidence, proof-obligation checks require specific evidence, and end-to-end review records actual attack categories. Arbitrary character counts and fixed category quotas are not evidence.

Strategic review likewise records a real reviewer AgentRun and at least one decision-relevant next move. It does not require exactly three moves or a fixed menu of probability estimates; irrelevant estimates are spurious precision, not rigor.

`ensure_project_actionable` is the reconciliation/watchdog surface. It creates a task only when tied to a blocker or to the structural defect of an unexplained empty frontier.

## Imports

Existing projects use staged import: begin, ingest exact artifacts, analyze and preview the proposed graph, commit as `imported_unverified`, then run a fresh baseline audit. Imported assertions and historical reviews remain provenance-aware evidence, not Maff verification.

## Audits and repair

`run_project_graph_audit` supports invariant, release, migration, and forensic modes. Full modes require a fresh `GraphAuditor` run. The audit records a snapshot hash and proposed findings without changing project state. Repeated instances of one systemic defect are stored as one finding class with all affected record IDs as evidence; an audit does not become dozens of repair jobs merely because historical telemetry contains dozens of bad rows.

`begin_repair_from_audit` starts a bounded three-phase campaign: reconstruct the current verification baseline, execute only the exact current-candidate release-gate delta, then run one fresh immutable re-audit. Starting it supersedes older row-by-row campaigns for the same audit, preserves their reports, marks their workflow-only gaps as consolidated, and quarantines defective historical review evidence in bulk. It never schedules one rerun per historical review. The phases advance automatically when their workstreams complete, so the normal user path is one coordinator chat, one author-disjoint reviewer chat if current gates are missing, and one fresh auditor chat. A reviewer chat may drain multiple distinct current-candidate gates sequentially.

The release-gate circuit breaker ignores quarantined, unassigned, and incomplete attempts. It may be bypassed only by an explicit remediation workstream targeting the exact canonical manuscript with a recognized release-gate type; arbitrary duplicate review work remains blocked.

## Artifacts and publication

`create_artifact` ingests managed bytes but returns metadata only. `surface_artifact` is explicit. `publish_manuscript_package` is the only default user-visible publication path and requires reconstructed publication-candidate readiness plus verified source and PDF bytes.
