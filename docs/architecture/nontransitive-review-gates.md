# Non-Transitive Review Gates

## Invariant

Approval is scoped evidence, not a property inherited by descendants. An approved source proof can support a later review, but cannot approve an integration, a manuscript, a theorem extension, or a PDF.

## Durable model

`ReviewRound` records `reviewType`, exact `targetVersion`, scope, inspected source artifacts, checked proof obligations, whether parent mathematics was reopenable, evidence-only treatment of old approvals, reviewer independence, verdict, issues, references, and agent run.

Legacy records remain readable as `legacy_unspecified`; they are never promoted to an end-to-end mathematical approval.

`ManuscriptVersion` is the canonical working paper. It stores content/theorem/citation fingerprints and is superseded rather than overwritten. A substantive canonical artifact edit creates a new version, leaving old reviews historical and stale.

`ProofObligation` connects a governing claim, detailed source artifact, manuscript location, and required proof clause. `ReviewObligationCheck` stores an integration reviewer's preserved/partial/omitted finding and evidence.

`ResearchLink` connects manuscript versions to source artifacts and contribution claims. `WorkstreamDependency` controls operational ordering.

## Gate policy

For a mathematical paper, `computeSubmissionReadiness` requires the current canonical version to have:

1. approved proof-integration review with all required obligations preserved;
2. approved independent end-to-end mathematical review;
3. novelty coverage for every linked contribution claim;
4. approved bibliography review;
5. approved compile review;
6. no relevant open major, critical, or fatal gap.

A review counts only if its type and target version match. Compile, bibliography, source-fidelity, numerical, formal, and ingredient reviews are never substitutes for another gate.

`compute_submission_readiness` presents the canonical `ManuscriptVersion` as one immutable release candidate and returns an ordered gate plan. Compile, proof-integration, and end-to-end evidence are exact-version only. Novelty evidence may be reused only when the theorem fingerprint is unchanged; bibliography evidence may be reused only when the citation fingerprint is unchanged. Every rejected review includes a machine-readable reason, and the response names exactly one next action.

Approved proof-integration evidence must preserve every required obligation. `passed` is normalized to `preserved`, and the compatibility `checked_obligation_ids` field is materialized as preserved checks on new approved reviews. This prevents a review from reporting six checked obligations while readiness sees zero.

If repeated exact-version reviews add no issues while a gate remains unsatisfied, or accepted evidence remains incomplete, readiness activates a workflow circuit breaker. Coordinators must pause duplicate final-review work and repair the identified evidence transition instead.

## Gaps and dependencies

Readiness traverses selected `ResearchLink` relations from the canonical manuscript, sources, and claims. A relevant major/critical/fatal open gap blocks readiness and reports an object path. Unlinked branch gaps do not block the manuscript.

Claiming or completing a workstream checks explicit prerequisites. The control room only suggests dependency-satisfied workstreams.

## Reopening

Old reviews are immutable. A defect is recorded through a gap/revision request and a new manuscript version/review, not by rewriting historical approval. Mathematical reviewers are always permitted to reopen mathematics; only mechanical export/compile reviews may freeze source text, and their output remains non-mathematical.

## Backfill

The additive migration defaults all old review rows to `legacy_unspecified`, with evidence-only parent approval semantics. No existing record is upgraded. Projects without a canonical manuscript return `no_canonical_manuscript` and otherwise keep their legacy behavior.
