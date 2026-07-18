import { createHash, randomUUID } from "node:crypto"
import { TextDecoder } from "node:util"
import { Prisma } from "@prisma/client"
import { prisma } from "../db/prisma.js"
import { readZipEntryBytes, verifyStoredFile } from "../artifacts/storage.js"

export const CITATION_REPAIR_REQUEST_SCHEMA = "maff.citation-repair.request.v1"
export const CITATION_FINGERPRINT_SCHEMA = "maff.citation-fingerprint.v1"
export const PROTECTED_MANUSCRIPT_STATE_SCHEMA = "maff.protected-manuscript-state.v1"
export const CITATION_REPAIR_CERTIFICATE_SCHEMA = "maff.citation-repair-certificate.v1"

export type CitationRecord = { key: string; bibitem_latex: string }
export type CitationRepairInput = {
  workspaceId: string
  projectId: string
  manuscriptVersionId: string
  expectedContentHash: string
  expectedOldCitationFingerprint: string
  sourceArtifactId: string
  sourceArtifactSha256: string
  pdfArtifactId: string
  pdfArtifactSha256: string
  actorAgentRunId: string
  mode?: "source_bundle" | "explicit_map"
  citations?: CitationRecord[]
  expectedNewCitationFingerprint?: string
  idempotencyKey?: string
}

type Db = Prisma.TransactionClient | typeof prisma

function failure(code: string, message: string, status = 409): never {
  throw Object.assign(new Error(`${code}: ${message}`), { code, status })
}

const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex")
const domainDigest = (domain: string, canonicalBytes: string) => sha256(Buffer.concat([Buffer.from(domain, "utf8"), Buffer.from([0]), Buffer.from(canonicalBytes, "utf8")]))
const utf8Compare = (left: string, right: string) => Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"))

function jsonString(value: string) {
  return JSON.stringify(value).replace(/\\u00([A-F0-9]{2})/g, (_match, hex: string) => `\\u00${hex.toLowerCase()}`)
}

/** Canonical JSON v1: recursive unsigned-UTF-8 object-key ordering and no insignificant whitespace. */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null"
  if (typeof value === "string") return jsonString(value)
  if (typeof value === "boolean") return value ? "true" : "false"
  if (typeof value === "number") {
    if (!Number.isFinite(value)) failure("NON_CANONICAL_JSON", "Canonical JSON cannot contain non-finite numbers.", 400)
    return JSON.stringify(value)
  }
  if (typeof value === "bigint") return jsonString(value.toString())
  if (value instanceof Date) return jsonString(value.toISOString())
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (typeof value === "object") {
    const object = value as Record<string, unknown>
    const keys = Object.keys(object).filter((key) => object[key] !== undefined).sort(utf8Compare)
    return `{${keys.map((key) => `${jsonString(key)}:${canonicalJson(object[key])}`).join(",")}}`
  }
  failure("NON_CANONICAL_JSON", `Unsupported canonical JSON value type ${typeof value}.`, 400)
}

function canonicalSet(values: unknown[], label: string) {
  const keyed = values.map((value) => ({ value, bytes: canonicalJson(value) })).sort((a, b) => Buffer.compare(Buffer.from(a.bytes, "utf8"), Buffer.from(b.bytes, "utf8")))
  for (let index = 1; index < keyed.length; index += 1) if (keyed[index - 1].bytes === keyed[index].bytes) failure("DUPLICATE_PROTECTED_SET_ELEMENT", `${label} contains a duplicate canonical element.`)
  return keyed.map((item) => item.value)
}

function plain(value: unknown): any {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === "bigint") return value.toString()
  if (Array.isArray(value)) return value.map(plain)
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, plain(item)]))
  return value
}

function trimAsciiWhitespace(value: string) {
  return value.replace(/^[\x09-\x0d\x20]+|[\x09-\x0d\x20]+$/g, "")
}

export function normalizeCitationRecords(records: CitationRecord[]) {
  if (!Array.isArray(records) || records.length === 0) failure("EMPTY_CITATION_MAP", "At least one exact citation record is required.", 400)
  const seen = new Set<string>()
  const normalized = records.map((record, index) => {
    if (!record || typeof record.key !== "string" || typeof record.bibitem_latex !== "string") failure("MALFORMED_CITATION_RECORD", `Citation record ${index} must contain string key and bibitem_latex fields.`, 400)
    const key = record.key
    if (!/^[A-Za-z0-9_.:+/-]+$/.test(key)) failure("MALFORMED_CITATION_KEY", `Citation key ${jsonString(key)} is invalid.`, 400)
    if (seen.has(key)) failure("DUPLICATE_CITATION_KEY", `Citation key ${key} occurs more than once.`, 400)
    seen.add(key)
    const bibitem_latex = trimAsciiWhitespace(record.bibitem_latex.replace(/\r\n?/g, "\n"))
    if (!bibitem_latex) failure("EMPTY_CITATION_RECORD", `Citation ${key} has an empty bibitem body.`, 400)
    return { key, bibitem_latex }
  })
  return normalized.sort((left, right) => utf8Compare(left.key, right.key))
}

export function citationEnvelope(records: CitationRecord[]) {
  return { schema: CITATION_FINGERPRINT_SCHEMA, citations: normalizeCitationRecords(records) }
}

export function computeCitationFingerprint(records: CitationRecord[]) {
  const envelope = citationEnvelope(records)
  const canonical = canonicalJson(envelope)
  return { envelope, canonical, payloadDigest: sha256(canonical), fingerprint: domainDigest("maff:citation-fingerprint:v1", canonical) }
}

export function parseCitationRecordsFromTex(bytes: Buffer) {
  let tex: string
  try { tex = new TextDecoder("utf-8", { fatal: true }).decode(bytes) } catch { failure("INVALID_SOURCE_UTF8", "main.tex is not valid UTF-8.", 400) }
  tex = tex!.replace(/\r\n?/g, "\n")
  const blocks = [...tex.matchAll(/\\begin\{thebibliography\}(?:\{[^}]*\})?([\s\S]*?)\\end\{thebibliography\}/g)]
  if (blocks.length !== 1) failure("AMBIGUOUS_BIBLIOGRAPHY", `Expected exactly one thebibliography environment; found ${blocks.length}.`, 400)
  const body = blocks[0][1]
  const marker = /\\bibitem(?:\[[^\]]*\])?\{([^}]+)\}/g
  const matches = [...body.matchAll(marker)]
  if (!matches.length) failure("EMPTY_BIBLIOGRAPHY", "The bibliography has no bibitem records.", 400)
  const records = matches.map((match, index) => ({ key: match[1], bibitem_latex: body.slice((match.index ?? 0) + match[0].length, index + 1 < matches.length ? matches[index + 1].index : body.length) }))
  const allMarkers = [...tex.matchAll(marker)]
  if (allMarkers.length !== matches.length) failure("BIBITEM_OUTSIDE_BIBLIOGRAPHY", "A bibitem marker occurs outside the unique bibliography environment.", 400)

  const cited = new Set<string>()
  const sourceWithoutBibliography = `${tex.slice(0, blocks[0].index)}${tex.slice((blocks[0].index ?? 0) + blocks[0][0].length)}`
  for (const cite of sourceWithoutBibliography.matchAll(/\\(?:cite|citep|citet|citealp|citeauthor|citeyear|nocite)(?:\[[^\]]*\]){0,2}\{([^}]*)\}/g)) {
    for (const raw of cite[1].split(",")) {
      const key = trimAsciiWhitespace(raw)
      if (!key || key === "*") failure("MALFORMED_CITATION_USE", "Citation commands must name explicit nonempty keys.", 400)
      cited.add(key)
    }
  }
  const normalized = normalizeCitationRecords(records)
  const bibliographyKeys = new Set(normalized.map((record) => record.key))
  const missing = [...cited].filter((key) => !bibliographyKeys.has(key)).sort(utf8Compare)
  const extra = [...bibliographyKeys].filter((key) => !cited.has(key)).sort(utf8Compare)
  if (missing.length || extra.length) failure("CITATION_KEY_SET_MISMATCH", `Citation uses and bibitems differ; missing=[${missing.join(",")}], extra=[${extra.join(",")}].`, 400)
  return normalized
}

function normalizedObligation(value: any) {
  const row = plain(value)
  for (const field of ["dependencies", "externalTheorems", "assumptions", "excludedRegimes", "boundaryCases", "semanticConsequences"]) row[field] = canonicalSet(Array.isArray(row[field]) ? row[field] : [], `ProofObligation.${field}`)
  return row
}

function normalizedReview(value: any) {
  const row = plain(value)
  for (const field of ["issues", "requiredChanges", "checkedRefs", "inspectedArtifactIds", "checkedObligationIds"]) row[field] = canonicalSet(Array.isArray(row[field]) ? row[field] : [], `ReviewRound.${field}`)
  row.obligationChecks = [...(row.obligationChecks ?? [])].sort((a: any, b: any) => utf8Compare(a.id, b.id))
  row.evidenceSections = [...(row.evidenceSections ?? [])].sort((a: any, b: any) => utf8Compare(a.id, b.id))
  return row
}

export async function protectedManuscriptSnapshot(db: Db, input: { workspaceId: string; projectId: string; manuscriptVersionId: string; sourceArtifactId: string; pdfArtifactId: string }) {
  const [project, version, physicalLinks, obligations, reviews, assignments, externalReviews, packages, builds, researchLinks] = await Promise.all([
    db.project.findFirstOrThrow({ where: { workspaceId: input.workspaceId, id: input.projectId } }),
    db.manuscriptVersion.findFirstOrThrow({ where: { workspaceId: input.workspaceId, projectId: input.projectId, id: input.manuscriptVersionId }, include: { artifact: true } }),
    db.artifactManuscriptVersion.findMany({ where: { workspaceId: input.workspaceId, manuscriptVersionId: input.manuscriptVersionId }, include: { artifact: true }, orderBy: [{ role: "asc" }, { artifactId: "asc" }, { id: "asc" }] }),
    db.proofObligation.findMany({ where: { workspaceId: input.workspaceId, projectId: input.projectId, manuscriptVersionId: input.manuscriptVersionId }, orderBy: { id: "asc" } }),
    db.reviewRound.findMany({ where: { workspaceId: input.workspaceId, projectId: input.projectId, OR: [{ targetVersion: input.manuscriptVersionId }, { targetObjectType: "ManuscriptVersion", targetObjectId: input.manuscriptVersionId }] }, include: { obligationChecks: true, evidenceSections: true }, orderBy: { id: "asc" } }),
    db.reviewAssignment.findMany({ where: { workspaceId: input.workspaceId, projectId: input.projectId, OR: [{ manuscriptVersionId: input.manuscriptVersionId }, { targetObjectType: "ManuscriptVersion", targetObjectId: input.manuscriptVersionId }] }, orderBy: { id: "asc" } }),
    db.externalReviewImport.findMany({ where: { workspaceId: input.workspaceId, projectId: input.projectId, manuscriptVersionId: input.manuscriptVersionId }, orderBy: { id: "asc" } }),
    db.publicationPackage.findMany({ where: { workspaceId: input.workspaceId, projectId: input.projectId, manuscriptVersionId: input.manuscriptVersionId }, orderBy: { id: "asc" } }),
    db.paperBuild.findMany({ where: { workspaceId: input.workspaceId, projectId: input.projectId, manuscriptVersionId: input.manuscriptVersionId }, orderBy: { id: "asc" } }),
    db.researchLink.findMany({ where: { workspaceId: input.workspaceId, projectId: input.projectId, OR: [{ sourceType: "ManuscriptVersion", sourceId: input.manuscriptVersionId }, { targetType: "ManuscriptVersion", targetId: input.manuscriptVersionId }] }, orderBy: { id: "asc" } })
  ])
  const sourceLink = physicalLinks.find((link) => link.artifactId === input.sourceArtifactId)
  const pdfLink = physicalLinks.find((link) => link.artifactId === input.pdfArtifactId)
  if (!sourceLink || !pdfLink) failure("ARTIFACT_NOT_EXACTLY_LINKED", "The supplied source and PDF must both be directly linked to the exact ManuscriptVersion.")
  const proofLedger = obligations.map(normalizedObligation)
  const proofLedgerCanonical = canonicalJson(proofLedger)
  const projection = {
    schema: PROTECTED_MANUSCRIPT_STATE_SCHEMA,
    project: { id: project.id, status: project.status, current_working_paper_id: project.currentWorkingPaperId },
    manuscript: {
      id: version.id, version: version.version, artifact_id: version.artifactId, content_hash: version.contentHash, theorem_fingerprint: version.theoremFingerprint,
      is_canonical: version.isCanonical, verification_state: version.verificationState, freeze_level: version.freezeLevel, lifecycle_stage: version.lifecycleStage,
      lexical_frozen_at: version.lexicalFrozenAt, interface_frozen_at: version.interfaceFrozenAt, mathematical_frozen_at: version.mathematicalFrozenAt, superseded_at: version.supersededAt,
      created_at: version.createdAt
    },
    manuscript_research_artifact: plain(version.artifact),
    exact_source_artifact: plain(sourceLink.artifact),
    exact_pdf_artifact: plain(pdfLink.artifact),
    physical_artifact_relationships: physicalLinks.map((link) => plain(link)),
    proof_obligations: proofLedger,
    exact_reviews: reviews.map(normalizedReview),
    exact_review_assignments: assignments.map((assignment) => {
      const row = plain(assignment)
      row.permittedArtifactIds = canonicalSet(Array.isArray(row.permittedArtifactIds) ? row.permittedArtifactIds : [], "ReviewAssignment.permittedArtifactIds")
      return row
    }),
    external_review_imports: plain(externalReviews),
    publication_packages: plain(packages),
    paper_builds: plain(builds),
    manuscript_research_links: plain(researchLinks)
  }
  const canonical = canonicalJson(projection)
  return { projection, digest: domainDigest("maff:protected-manuscript-state:v1", canonical), proofLedgerDigest: domainDigest("maff:proof-ledger:v1", proofLedgerCanonical), project, version, physicalLinks }
}

async function validateReplay(db: Db, certificate: any) {
  const snapshot = await protectedManuscriptSnapshot(db, { workspaceId: certificate.workspaceId, projectId: certificate.projectId, manuscriptVersionId: certificate.manuscriptVersionId, sourceArtifactId: certificate.sourceArtifactId, pdfArtifactId: certificate.pdfArtifactId })
  if (snapshot.version.contentHash !== certificate.observedContentHash || snapshot.version.citationFingerprint !== certificate.newCitationFingerprint || snapshot.version.theoremFingerprint !== certificate.theoremFingerprint || snapshot.proofLedgerDigest !== certificate.proofLedgerDigest || snapshot.digest !== certificate.protectedStateDigestAfter) failure("REPLAY_STATE_DIVERGED", `Protected or citation state no longer matches certificate ${certificate.id}.`)
  const payloadDigest = snapshot.version.citationPayload ? sha256(canonicalJson(snapshot.version.citationPayload)) : null
  if (payloadDigest !== certificate.citationPayloadDigest) failure("REPLAY_STATE_DIVERGED", `Citation payload no longer matches certificate ${certificate.id}.`)
  return { certificate, delivery_outcome: "replayed" as const }
}

export async function runExactVersionCitationRepairAudit(input: { workspaceId: string; projectId: string; certificateId: string }) {
  const certificate = await prisma.citationRepairCertificate.findFirstOrThrow({ where: { id: input.certificateId, workspaceId: input.workspaceId, projectId: input.projectId } })
  const replay = await validateReplay(prisma, certificate)
  const [source, pdf] = await Promise.all([
    prisma.artifact.findFirstOrThrow({ where: { id: certificate.sourceArtifactId, workspaceId: input.workspaceId, projectId: input.projectId } }),
    prisma.artifact.findFirstOrThrow({ where: { id: certificate.pdfArtifactId, workspaceId: input.workspaceId, projectId: input.projectId } })
  ])
  for (const [label, artifact, expected] of [["source", source, certificate.sourceArtifactSha256], ["PDF", pdf, certificate.pdfArtifactSha256]] as const) {
    if (!artifact.storageKey || artifact.sha256 !== expected || artifact.byteSize === null) failure("AUDIT_ARTIFACT_PROVENANCE_MISMATCH", `Certificate ${label} artifact metadata has drifted.`)
    if (!(await verifyStoredFile(artifact.storageKey, expected, artifact.byteSize)).ok) failure("AUDIT_ARTIFACT_INTEGRITY_FAILURE", `Certificate ${label} bytes are missing or corrupt.`)
  }
  if (!source.storageKey) failure("AUDIT_SOURCE_BYTES_UNAVAILABLE", "Certificate source bytes are unavailable.")
  const records = parseCitationRecordsFromTex((await readZipEntryBytes(source.storageKey, "main.tex", 16 * 1024 * 1024)).bytes)
  const computed = computeCitationFingerprint(records)
  if (computed.fingerprint !== certificate.newCitationFingerprint || computed.payloadDigest !== certificate.citationPayloadDigest) failure("AUDIT_CITATION_MISMATCH", "Exact source no longer reproduces the certified citation metadata.")
  const snapshot = await protectedManuscriptSnapshot(prisma, { workspaceId: input.workspaceId, projectId: input.projectId, manuscriptVersionId: certificate.manuscriptVersionId, sourceArtifactId: certificate.sourceArtifactId, pdfArtifactId: certificate.pdfArtifactId })
  const audit = await prisma.projectAudit.create({ data: {
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    mode: "invariant_check",
    status: "completed",
    graphSnapshotHash: snapshot.digest,
    policyVersion: PROTECTED_MANUSCRIPT_STATE_SCHEMA,
    storedReadiness: { certificate_id: certificate.id, certificate_schema: certificate.schemaVersion, certified_protected_digest: certificate.protectedStateDigestAfter, certified_citation_fingerprint: certificate.newCitationFingerprint },
    reconstructedReadiness: { manuscript_version_id: certificate.manuscriptVersionId, protected_digest: snapshot.digest, proof_ledger_digest: snapshot.proofLedgerDigest, citation_fingerprint: snapshot.version.citationFingerprint, citation_payload_digest: computed.payloadDigest, source_sha256: source.sha256, pdf_sha256: pdf.sha256, protected_state_diff: [] },
    summaryMarkdown: `Exact-version citation repair certificate ${certificate.id} passed source/PDF integrity, deterministic citation reconstruction, proof-ledger, review-link, lifecycle, and current-working-pointer invariants for ManuscriptVersion ${certificate.manuscriptVersionId}.`,
    noProjectMutation: true,
    completedAt: new Date()
  } })
  return { audit, certificate: replay.certificate, passed: true, protected_state_diff: [], project_mutated: false }
}

async function prepareCandidate(input: CitationRepairInput) {
  const [source, pdf] = await Promise.all([
    prisma.artifact.findFirstOrThrow({ where: { workspaceId: input.workspaceId, projectId: input.projectId, id: input.sourceArtifactId } }),
    prisma.artifact.findFirstOrThrow({ where: { workspaceId: input.workspaceId, projectId: input.projectId, id: input.pdfArtifactId } })
  ])
  for (const [label, artifact, expectedHash] of [["source", source, input.sourceArtifactSha256], ["PDF", pdf, input.pdfArtifactSha256]] as const) {
    if (artifact.sha256 !== expectedHash || artifact.storageStatus !== "available" || !artifact.storageKey || artifact.byteSize === null) failure("ARTIFACT_PROVENANCE_MISMATCH", `Exact ${label} artifact metadata does not match the request.`)
    const verification = await verifyStoredFile(artifact.storageKey, expectedHash, artifact.byteSize)
    if (!verification.ok) failure("ARTIFACT_INTEGRITY_FAILURE", `Exact ${label} managed bytes are missing or corrupt.`)
  }
  if (!source.storageKey) failure("SOURCE_BYTES_UNAVAILABLE", "Exact source bundle has no managed bytes.")
  const mainTex = await readZipEntryBytes(source.storageKey, "main.tex", 16 * 1024 * 1024)
  const parsed = parseCitationRecordsFromTex(mainTex.bytes)
  const mode = input.mode ?? (input.citations ? "explicit_map" : "source_bundle")
  if (mode === "explicit_map") {
    if (!input.citations) failure("EXPLICIT_MAP_REQUIRED", "explicit_map mode requires citations.", 400)
    const explicit = normalizeCitationRecords(input.citations)
    if (canonicalJson(explicit) !== canonicalJson(parsed)) failure("SOURCE_MAP_MISMATCH", "Explicit citation map is not byte-equivalent to the exact linked source bundle.")
  } else if (input.citations) failure("UNEXPECTED_EXPLICIT_MAP", "source_bundle mode must not supply an explicit citation map.", 400)
  const candidate = computeCitationFingerprint(parsed)
  if (input.expectedNewCitationFingerprint && candidate.fingerprint !== input.expectedNewCitationFingerprint) failure("CANDIDATE_FINGERPRINT_MISMATCH", `Computed ${candidate.fingerprint}, expected ${input.expectedNewCitationFingerprint}.`)
  const requestEnvelope = {
    schema: CITATION_REPAIR_REQUEST_SCHEMA,
    workspace_id: input.workspaceId,
    project_id: input.projectId,
    manuscript_version_id: input.manuscriptVersionId,
    expected_content_hash: input.expectedContentHash,
    expected_old_citation_fingerprint: input.expectedOldCitationFingerprint,
    mode,
    source_artifact: { id: input.sourceArtifactId, sha256: input.sourceArtifactSha256 },
    compiled_pdf_artifact: { id: input.pdfArtifactId, sha256: input.pdfArtifactSha256 },
    citation_fingerprint_schema: CITATION_FINGERPRINT_SCHEMA,
    candidate_citation_payload_digest: candidate.payloadDigest,
    expected_new_citation_fingerprint: input.expectedNewCitationFingerprint ?? null
  }
  const requestDigest = domainDigest("maff:citation-repair-request:v1", canonicalJson(requestEnvelope))
  return { source, pdf, parsed, mode, candidate, requestEnvelope, requestDigest }
}

export async function repairExactVersionCitationMetadata(input: CitationRepairInput) {
  const prepared = await prepareCandidate(input)
  if (input.idempotencyKey) {
    const binding = await prisma.citationRepairCertificate.findUnique({ where: { idempotencyKey: input.idempotencyKey } })
    if (binding && binding.requestDigest !== prepared.requestDigest) failure("IDEMPOTENCY_CONFLICT", `Idempotency key is already bound to request ${binding.requestDigest}.`)
  }
  const existing = await prisma.citationRepairCertificate.findUnique({ where: { manuscriptVersionId_requestDigest: { manuscriptVersionId: input.manuscriptVersionId, requestDigest: prepared.requestDigest } } })
  if (existing) return validateReplay(prisma, existing)

  const apply = () => prisma.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ManuscriptVersion" WHERE "id" = ${input.manuscriptVersionId}::uuid FOR UPDATE`)
    if (input.idempotencyKey) {
      const binding = await tx.citationRepairCertificate.findUnique({ where: { idempotencyKey: input.idempotencyKey } })
      if (binding && binding.requestDigest !== prepared.requestDigest) failure("IDEMPOTENCY_CONFLICT", `Idempotency key is already bound to request ${binding.requestDigest}.`)
    }
    const replay = await tx.citationRepairCertificate.findUnique({ where: { manuscriptVersionId_requestDigest: { manuscriptVersionId: input.manuscriptVersionId, requestDigest: prepared.requestDigest } } })
    if (replay) return validateReplay(tx, replay)

    const actor = await tx.agentRun.findFirst({ where: { workspaceId: input.workspaceId, projectId: input.projectId, id: input.actorAgentRunId } })
    if (!actor) failure("INVALID_ACTOR_RUN", "actor_agent_run_id must belong to the exact workspace and project.", 400)
    const before = await protectedManuscriptSnapshot(tx, input)
    if (before.version.contentHash !== input.expectedContentHash) failure("CONTENT_HASH_MISMATCH", `Expected ${input.expectedContentHash}, observed ${before.version.contentHash}.`)
    if (before.version.citationFingerprint !== input.expectedOldCitationFingerprint) failure("PRIOR_FINGERPRINT_MISMATCH", `Expected prior fingerprint ${input.expectedOldCitationFingerprint}, observed ${before.version.citationFingerprint}.`)
    const sourceLink = before.physicalLinks.find((link) => link.artifactId === input.sourceArtifactId)!
    const pdfLink = before.physicalLinks.find((link) => link.artifactId === input.pdfArtifactId)!
    if (sourceLink.artifact.sha256 !== input.sourceArtifactSha256 || pdfLink.artifact.sha256 !== input.pdfArtifactSha256) failure("ARTIFACT_PROVENANCE_MISMATCH", "Locked exact artifact hashes differ from the request.")
    const exactBuild = await tx.paperBuild.findFirst({ where: { workspaceId: input.workspaceId, projectId: input.projectId, manuscriptVersionId: input.manuscriptVersionId, sourceArtifactId: input.sourceArtifactId, pdfArtifactId: input.pdfArtifactId, status: "succeeded" } })
    if (!exactBuild) failure("EXACT_BUILD_NOT_FOUND", "No successful exact-version PaperBuild binds the supplied source and PDF artifacts.")
    const manifest = plain(exactBuild.buildManifest)
    if (manifest.manuscript_version_id !== input.manuscriptVersionId || manifest.manuscript_content_hash !== input.expectedContentHash) failure("BUILD_MANIFEST_MISMATCH", "PaperBuild manifest does not bind the exact manuscript id and content hash.")

    const now = new Date()
    const revision = before.version.citationMetadataRevision + 1
    const updated = await tx.manuscriptVersion.updateMany({
      where: { id: input.manuscriptVersionId, workspaceId: input.workspaceId, projectId: input.projectId, contentHash: input.expectedContentHash, citationFingerprint: input.expectedOldCitationFingerprint },
      data: { citationPayload: prepared.candidate.envelope, citationFingerprint: prepared.candidate.fingerprint, citationMetadataRevision: revision, citationMetadataUpdatedAt: now }
    })
    if (updated.count !== 1) failure("CONCURRENT_MODIFICATION", "Exact-version citation compare-and-swap lost a concurrent race.")
    const after = await protectedManuscriptSnapshot(tx, input)
    if (before.digest !== after.digest) failure("PROTECTED_STATE_CHANGED", `Protected digest changed from ${before.digest} to ${after.digest}.`)
    if (before.proofLedgerDigest !== after.proofLedgerDigest) failure("PROTECTED_STATE_CHANGED", "Proof ledger changed during citation repair.")

    const certificateId = randomUUID()
    const allowedStateDiff = [
      { field: "citationPayload", before: before.version.citationPayload ?? null, after: prepared.candidate.envelope },
      { field: "citationFingerprint", before: before.version.citationFingerprint, after: prepared.candidate.fingerprint },
      { field: "citationMetadataRevision", before: before.version.citationMetadataRevision, after: revision },
      { field: "citationMetadataUpdatedAt", before: before.version.citationMetadataUpdatedAt, after: now.toISOString() }
    ]
    const certificatePayload = {
      schema: CITATION_REPAIR_CERTIFICATE_SCHEMA,
      certificate_id: certificateId,
      request_digest: prepared.requestDigest,
      idempotency_key: input.idempotencyKey ?? null,
      actor_agent_run_id: input.actorAgentRunId,
      workspace_id: input.workspaceId,
      project_id: input.projectId,
      manuscript_version_id: input.manuscriptVersionId,
      expected_content_hash: input.expectedContentHash,
      observed_content_hash: before.version.contentHash,
      expected_old_citation_fingerprint: input.expectedOldCitationFingerprint,
      old_citation_fingerprint: before.version.citationFingerprint,
      new_citation_fingerprint: prepared.candidate.fingerprint,
      citation_payload_digest: prepared.candidate.payloadDigest,
      citation_keys: prepared.parsed.map((record) => record.key),
      source_artifact: { id: input.sourceArtifactId, sha256: input.sourceArtifactSha256 },
      compiled_pdf_artifact: { id: input.pdfArtifactId, sha256: input.pdfArtifactSha256 },
      theorem_fingerprint: before.version.theoremFingerprint,
      proof_ledger_digest: before.proofLedgerDigest,
      protected_state_digest_before: before.digest,
      protected_state_digest_after: after.digest,
      current_working_pointer_before: before.project.currentWorkingPaperId,
      current_working_pointer_after: after.project.currentWorkingPaperId,
      allowed_state_diff: allowedStateDiff,
      protected_state_diff: [],
      created_at: now.toISOString(),
      application_outcome: "applied"
    }
    const certificate = await tx.citationRepairCertificate.create({ data: {
      id: certificateId, workspaceId: input.workspaceId, projectId: input.projectId, manuscriptVersionId: input.manuscriptVersionId, actorAgentRunId: input.actorAgentRunId,
      schemaVersion: CITATION_REPAIR_CERTIFICATE_SCHEMA, requestDigest: prepared.requestDigest, idempotencyKey: input.idempotencyKey,
      expectedContentHash: input.expectedContentHash, observedContentHash: before.version.contentHash, expectedOldCitationFingerprint: input.expectedOldCitationFingerprint,
      oldCitationFingerprint: before.version.citationFingerprint, newCitationFingerprint: prepared.candidate.fingerprint, citationPayloadDigest: prepared.candidate.payloadDigest,
      citationKeys: prepared.parsed.map((record) => record.key), sourceArtifactId: input.sourceArtifactId, sourceArtifactSha256: input.sourceArtifactSha256,
      pdfArtifactId: input.pdfArtifactId, pdfArtifactSha256: input.pdfArtifactSha256, theoremFingerprint: before.version.theoremFingerprint,
      proofLedgerDigest: before.proofLedgerDigest, protectedStateDigestBefore: before.digest, protectedStateDigestAfter: after.digest,
      currentWorkingPointerBefore: before.project.currentWorkingPaperId, currentWorkingPointerAfter: after.project.currentWorkingPaperId,
      allowedStateDiff, protectedStateDiff: [], applicationOutcome: "applied", certificatePayload
    } })
    return { certificate, delivery_outcome: "applied" as const }
  }, { isolationLevel: "Serializable", maxWait: 10_000, timeout: 30_000 })
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { return await apply() } catch (error) {
      const retryable = error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2034" || (error.code === "P2010" && String((error.meta as any)?.code) === "40001"))
      if (!retryable || attempt === 2) throw error
      const replay = await prisma.citationRepairCertificate.findUnique({ where: { manuscriptVersionId_requestDigest: { manuscriptVersionId: input.manuscriptVersionId, requestDigest: prepared.requestDigest } } })
      if (replay) return validateReplay(prisma, replay)
    }
  }
  failure("CONCURRENT_MODIFICATION", "Citation repair could not serialize after three attempts.")
}
