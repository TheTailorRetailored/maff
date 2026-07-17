# MMRW Golden Lifecycle Verification

## Purpose

MMRW is the regression corpus for Maff's proof-graph-to-publication workflow. The executable fixture reconstructs the successful semantics at current `HEAD`; it does not check out historically broken intermediate revisions. This keeps the test focused on behaviors that survived repair while preserving the incident history as named regression assertions.

Run the source contract checks with:

```bash
cd apps/api
npm run test:smoke:src
```

Run the complete database replay against a migrated PostgreSQL database with PaperBuilder/Tectonic available:

```bash
cd apps/api
npm run build
npm run test:mmrw-golden:db
```

CI runs the broader production-image suite through `npm run test:lifecycle:db`.

Assess existing projects without mutation using `npm run admin:assess-release-alignment -- --workspace <id-or-slug>`. After reviewing the report, align only eligible projects with `npm run admin:align-release-state -- --workspace <id-or-slug>`. The apply mode is idempotent and deliberately leaves `inconsistent` projects unchanged for explicit administrative repair.

## Golden path

| Stage | Required observable result |
| --- | --- |
| Mature research graph | A reviewed proof attempt and mature claim classify as `proof_graph_ready_for_synthesis`, without pretending a canonical manuscript exists. |
| Existing-project alignment | `align_project_release_state` creates exactly one PaperWriter frontier; a repeated call reuses it. It creates no approval, candidate, audit, or publication state. |
| Structured synthesis | PaperWriter creates linked sections and an explicit proof-obligation ledger from governing graph objects. |
| Deterministic build | PaperBuilder creates one canonical exact version with managed source/PDF bytes; compilation alone supplies no mathematical approval. |
| Explicit candidacy | The release contract permits only `promote_manuscript_to_submission_candidate` and marks it as a user decision. |
| Reviewed successor adoption | A separate regression permits only `adopt_reviewed_manuscript_successor`, preserves the predecessor and all mathematical/release fields, then retargets candidacy to the adopted successor. |
| Exact review sequence | Compile, proof integration, novelty, bibliography, end-to-end mathematics, and editorial evidence are consumed in policy order against the immutable candidate. |
| Third-party handoff | `prepare_external_review_package` returns exact PDF/source bytes, remains idempotent, and leaves the project active. |
| External review | Imported feedback is bound to the exact candidate/package; adverse feedback would reopen a bounded revision rather than being treated as publication approval. |
| Publication | Only explicit `publish_manuscript` releases the already prepared package, completes the project, and remains idempotent. |
| Terminal contract | State is `publication_released` and no further release mutation is advertised. |

## Historical regression corpus

These current behaviors encode the repaired lineage rather than preserving broken implementations:

| Historical failure class | Known-good lineage | Regression assertion |
| --- | --- | --- |
| Approval leaked across changed manuscripts | `06bdf50`, `feb95a4`, `f009ac1` | Reviews are exact-version or fingerprint-scoped and cannot be manufactured from a generic report. |
| Review recording or ownership was non-atomic | `d9b7414`, `ab97abb`, `662242e` | Every substantive gate uses a server-issued, one-use locked assignment and verified exact-artifact access. |
| Final review began before a deliberate candidate existed | `9df3abc`, `ac1f59f` | The contract exposes only candidacy activation during ordinary manuscript development and requires a user decision. |
| Submitted or claimed reviews became stranded | `a1bb186`, `bcdf34b`, `26dec2e`, `4997556`, `5f78a83` | Consecutive gates remain claimable and completion cannot orphan a submitted report or lock. |
| Gate aliases or changed versions caused repeated work | `afd75c8`, `7d79fa3`, `898bc9f` | Aliases normalize, satisfied gates retire, and one eligible reviewer context can drain the next distinct gate without duplicating an unchanged gate. |
| Manual files and canonical flags substituted for a real build | `4d069d2`, `ede4074` | PaperBuilder owns deterministic managed bytes; source-preserving repair creates an immutable successor and re-evaluates affected evidence. |
| Governance work replaced ordinary progress | `f009ac1` plus the LLM release contract | Exactly one permitted semantic mutation is advertised; circuit breakers advertise none, and alignment never creates audit theatre. |

## All-project acceptance criteria

An existing Maff project is aligned when all of the following are machine-observable:

1. The preflight classification is one of the five documented alignment classes and never depends on an LLM inference.
2. At most one canonical working manuscript exists and the project pointer agrees with it.
3. Every canonical manuscript has an explicit, non-empty exact-version obligation ledger and constructive AgentRun provenance.
4. Release candidacy is explicit, immutable, and separate from ordinary development.
5. Readiness names one next action and the release contract exposes at most one permitted mutation tool.
6. Review evidence is assigned, independent where required, exact-targeted, substantive, and consumed once.
7. Managed physical bytes, not paths or hashes alone, back build and review-package claims.
8. External-review handoff, external-review import, and publication are separate transitions.
9. Repeating any semantic transition is safe and cannot create duplicate frontiers, packages, reviews, or releases.
10. Any inconsistent state stops with an administrative repair classification; no model-facing loophole is available.

The same replay architecture should be extended with additional project fixtures only when they add a genuinely different semantic case, such as a legacy hand-formatted manuscript, a substantive adverse external review and successor, or an editorial-only source-preserving child.
