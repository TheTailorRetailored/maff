# Internal PaperBuilder

## Source of truth

The editable paper lives in `ManuscriptDocument` and append-only `ManuscriptSection` revisions. Metadata includes title, authors, abstract, keywords, template, and explicit proof-obligation drafts. Sections carry stable keys, order, semantic kind, Markdown or LaTeX content, governing claim ids, and citation keys.

An LLM authors exposition and mathematics in these structured records. It never has to create, upload, attach, hash, verify, or surface TeX/PDF files.

## Exact builds

`build_manuscript` assembles the current section set into an immutable semantic `ResearchArtifact` and exact `ManuscriptVersion`. PaperBuilder renders `main.tex` and `references.bib`, invokes pinned Tectonic, creates a source bundle and PDF in Maff-managed content-addressed storage, and records a `PaperBuild` containing the builder version, source hash, manifest, log and artifact ids.

The same semantic snapshot and builder version produce the same rendered source hash. A failed compilation records an ordinary failed PaperBuild and remains author repair work; it does not create an audit or reviewer assignment.

## Inspection and publication

`inspect_manuscript_build` returns the full normalized manuscript, TeX, bibliography, manifest and log as text. It reports PDF identity but does not return a file resource. This is the reviewer path.

Imported or hand-formatted LaTeX projects use `revise_manuscript_source` for bounded successor revisions. The server reads the parent source bundle, requires exact expected-text occurrence counts, preserves every untouched source entry, recompiles internally, clones the proof-obligation ledger, and records an immutable child lineage. The conservative `editorial_only` class is accepted only when the entire source delta is confined to `\\date{...}`; this may carry proof-integration and end-to-end evidence forward while never carrying the editorial verdict that requested the change.

Readiness treats a successful PaperBuild whose manifest matches the canonical manuscript content hash as compile evidence. After all substantive gates pass, `prepare_external_review_package` selects that exact build and surfaces its PDF/source handoff without completing the project. A later explicit `publish_manuscript` releases the same immutable package.
