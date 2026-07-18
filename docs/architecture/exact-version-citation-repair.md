# Exact-Version Citation Metadata Repair

`repair_exact_version_citation_metadata` is the only supported operation for correcting citation metadata on an existing exact `ManuscriptVersion`. It is not an authoring or release transition. It MUST NOT create a manuscript successor, rewrite source, rebuild a PDF, change theorem or proof state, affect review validity, move working-text authority, or change lifecycle state.

## Versioned formats

The operation uses four normative schemas:

- `maff.citation-repair.request.v1` for the semantic request digest;
- `maff.citation-fingerprint.v1` for the exact normalized citation payload;
- `maff.protected-manuscript-state.v1` for the invariant projection;
- `maff.citation-repair-certificate.v1` for the immutable application certificate.

Canonical JSON is UTF-8 without a BOM or insignificant whitespace. Object keys are recursively ordered by unsigned UTF-8 bytes. Citation records are ordered by exact key. Schema-declared set arrays are ordered by canonical element bytes and reject duplicates; sequence arrays retain their order. Strings preserve Unicode, case, punctuation, LaTeX, internal whitespace, and line breaks. Only CRLF/CR-to-LF conversion and leading/trailing ASCII whitespace trimming of a complete `bibitem_latex` body are permitted.

The fingerprint is:

```text
SHA256(UTF8("maff:citation-fingerprint:v1") || 0x00 || canonical_payload)
```

## Provenance and parsing

The request pins workspace, project, exact manuscript ID and content hash, expected old citation fingerprint, source artifact ID/hash, PDF artifact ID/hash, actor `AgentRun`, mode, and optional expected new fingerprint. Maff verifies the managed source and PDF bytes, their direct exact-version links, and the successful exact `PaperBuild` manifest.

Source mode parses the unique `thebibliography` environment in `main.tex`. Citation uses and `bibitem` keys MUST be equal sets. Invalid UTF-8, ambiguous environments, missing, duplicate, renamed, extra, empty, or malformed records fail before mutation. Explicit-map mode is accepted only when its normalized records are byte-equivalent to the exact source parse.

## Replay-first transaction

Maff computes the request digest before opening the mutation path. It checks any idempotency-key binding and looks up `(manuscript_version_id, request_digest)` before comparing the expected old fingerprint. A matching certificate is replayed only if the current citation payload, fingerprint, content hash, theorem fingerprint, proof ledger, and full protected digest still match that certificate.

On first application, a serializable transaction locks the exact manuscript row and repeats those replay checks. It then compare-and-swaps the exact version, content hash, and old citation fingerprint. Identical concurrent requests converge on one certificate; divergent requests cannot both consume the same old fingerprint.

## Protected and mutable projections

The protected projection includes working authority, lifecycle/verification/freeze state, the underlying manuscript artifact, exact source/PDF metadata, all direct physical links, complete proof obligations, exact reviews and assignments, external reviews, packages, builds, and manuscript lineage. Its pre- and post-digests MUST match.

The only mutable fields are citation payload, citation fingerprint, citation metadata revision, and citation metadata timestamp. One append-only certificate may be inserted. PostgreSQL triggers reject certificate update and deletion. The certificate records `application_outcome="applied"`; a replay response reports `delivery_outcome="replayed"` without rewriting the certificate.

`runExactVersionCitationRepairAudit` re-verifies managed source/PDF bytes, reparses the source, reconstructs the fingerprint and payload digest, checks the certificate against current protected state, and writes a durable `invariant_check` `ProjectAudit` only on success.
