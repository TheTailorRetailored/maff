# Corrected Manuscript Workflow (MCP examples)

```json
{"tool":"create_manuscript_version","workspace_id":"<workspace>","project_id":"<project>","artifact_id":"<paper-draft-artifact>","parent_artifact_ids":["<detailed-proof-a>","<detailed-proof-b>"],"claim_ids":["<theorem-claim>"]}
```

```json
{"tool":"create_proof_obligation","workspace_id":"<workspace>","project_id":"<project>","manuscript_version_id":"<version>","claim_id":"<theorem-claim>","source_artifact_id":"<detailed-proof-a>","title":"Uniform moving-start majorant","statement_markdown":"Uniform bound on the stated moving-start domain.","manuscript_location":"Lemma 4.1","required":true}
```

```json
{"tool":"record_review_round","workspace_id":"<workspace>","workstream_id":"<integration-review-workstream>","verdict":"approved","review_type":"proof_integration","target_version":"<version>","independence":"independent_reviewer","inspected_artifact_ids":["<paper-draft-artifact>","<detailed-proof-a>"],"checked_obligation_ids":["<obligation>"],"parent_math_reopenable":true,"prior_approvals_evidence_only":true,"obligation_checks":[{"proofObligationId":"<obligation>","status":"preserved","evidenceMarkdown":"Lemma 4.1 explicitly derives the majorant."}],"body_markdown":"Complete source and integrated proof checked."}
```

```json
{"tool":"record_review_round","workspace_id":"<workspace>","workstream_id":"<final-referee-workstream>","verdict":"approved","review_type":"end_to_end_mathematical","target_version":"<version>","independence":"external_referee_style","parent_math_reopenable":true,"prior_approvals_evidence_only":true,"body_markdown":"Entire manuscript and sources independently checked; excluded-regime boundaries tested."}
```

Finally call `compute_submission_readiness`. A compile review may make the paper compile-clean, but it cannot make it mathematically reviewed or submission-ready.
