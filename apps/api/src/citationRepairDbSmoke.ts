import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { ZipFile } from "yazl"
import { prisma } from "./db/prisma.js"
import { ingestBytes } from "./artifacts/storage.js"
import { computeCitationFingerprint, parseCitationRecordsFromTex, protectedManuscriptSnapshot, repairExactVersionCitationMetadata, runExactVersionCitationRepairAudit, type CitationRecord, type CitationRepairInput } from "./research/citationRepair.js"

if (!process.env.DATABASE_URL) {
  console.log("Skipping citation repair DB smoke: DATABASE_URL is not set.")
  process.exit(0)
}

const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
const VERSION_10_FINGERPRINT = "ceee4bd2373251be5bb35b52772f47ca7a45b210fb6e2a1ec9a212b8c60b873e"
const VERSION_15_FINGERPRINT = "cc30ed533a4e18c14a5ef3cc82abde333f6fcfc42fafdcafc1eb2f1586500d41"

const fourKeyRecords: CitationRecord[] = [
  { key: "lubetzky_sly_2011", bibitem_latex: "E.~Lubetzky and A.~Sly,\n\\newblock Explicit expanders with cutoff phenomena,\n\\newblock \\emph{Electron. J. Probab.} \\textbf{16} (2011), no.~15, 419--435; arXiv:1003.3515." },
  { key: "hermon_peres_2018", bibitem_latex: "J.~Hermon and Y.~Peres,\n\\newblock On sensitivity of mixing times and cutoff,\n\\newblock \\emph{Electron. J. Probab.} \\textbf{23} (2018), Paper No.~25, 34 pp.; DOI: 10.1214/18-EJP154; arXiv:1610.04357." },
  { key: "basu_hermon_peres_2017", bibitem_latex: "R.~Basu, J.~Hermon and Y.~Peres,\n\\newblock Characterization of cutoff for reversible Markov chains,\n\\newblock \\emph{Ann. Probab.} \\textbf{45} (2017), no.~3, 1448--1487; arXiv:1409.3250." },
  { key: "pedrotti_salez_2026", bibitem_latex: "F.~Pedrotti and J.~Salez,\n\\newblock The local product condition implies cutoff,\n\\newblock arXiv:2607.05345 (2026)." }
]
const fiveKeyRecords: CitationRecord[] = [...fourKeyRecords, { key: "morgenstern_1994", bibitem_latex: "M.~Morgenstern,\n\\newblock Existence and explicit constructions of $q+1$ regular Ramanujan graphs for every prime power $q$,\n\\newblock \\emph{J. Combin. Theory Ser. B} \\textbf{62} (1994), no.~1, 44--62." }]

assert.equal(computeCitationFingerprint(fourKeyRecords).fingerprint, VERSION_10_FINGERPRINT)
assert.equal(computeCitationFingerprint(fiveKeyRecords).fingerprint, VERSION_15_FINGERPRINT)

function texFor(records: CitationRecord[], citedKeys = records.map((record) => record.key)) {
  return Buffer.from(`\\documentclass{article}\n\\begin{document}\nSee \\cite{${citedKeys.join(",")}}.\n\\begin{thebibliography}{99}\n${records.map((record) => `\\bibitem{${record.key}}\n${record.bibitem_latex}`).join("\n\n")}\n\\end{thebibliography}\n\\end{document}\n`, "utf8")
}

async function zipBytes(entries: Record<string, Buffer | string>) {
  const archive = new ZipFile()
  for (const [name, value] of Object.entries(entries)) archive.addBuffer(Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8"), name)
  archive.end()
  const chunks: Buffer[] = []
  for await (const chunk of archive.outputStream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return Buffer.concat(chunks)
}

type Fixture = { workspaceId: string; projectId: string; versionId: string; obligationId: string; sourceId: string; pdfId: string; actorRunId: string; input: CitationRepairInput }

async function fixture(records: CitationRecord[], expectedFingerprint: string, idempotencyKey?: string): Promise<Fixture> {
  const suffix = randomUUID().slice(0, 8)
  const workspace = await prisma.workspace.create({ data: { slug: `citation-repair-${suffix}`, name: "Citation repair smoke", type: "private" } })
  const project = await prisma.project.create({ data: { workspaceId: workspace.id, slug: `citation-repair-${suffix}`, title: "Exact citation metadata repair", statement: "Repair citation metadata only.", status: "active" } })
  const artifact = await prisma.researchArtifact.create({ data: { workspaceId: workspace.id, projectId: project.id, title: "Exact manuscript", slug: `citation-manuscript-${suffix}`, kind: "paper_draft", status: "reviewed", contentMarkdown: "Immutable manuscript source", descriptionMarkdown: "Protected research artifact" } })
  const contentHash = suffix.padEnd(64, "a")
  const theoremFingerprint = suffix.padEnd(64, "b")
  const version = await prisma.manuscriptVersion.create({ data: { workspaceId: workspace.id, projectId: project.id, artifactId: artifact.id, version: 15, contentHash, theoremFingerprint, citationFingerprint: EMPTY_SHA256, isCanonical: true, verificationState: "ledger_complete", lifecycleStage: "integrated" } })
  await prisma.project.update({ where: { id: project.id }, data: { currentWorkingPaperId: version.id } })
  const obligation = await prisma.proofObligation.create({ data: { workspaceId: workspace.id, projectId: project.id, manuscriptVersionId: version.id, title: "Protected theorem", statementMarkdown: "A protected exact-version proof obligation.", assumptions: ["B", "A"], dependencies: [{ key: "PO-0" }], boundaryCases: ["endpoint"], required: true } })
  const workstream = await prisma.workstream.create({ data: { workspaceId: workspace.id, projectId: project.id, title: "Citation infrastructure repair", kind: "gap_analysis", coordinatorRole: "ProjectCoordinator", status: "running", targetObjectType: "ManuscriptVersion", targetObjectId: version.id, instructions: "Repair metadata only.", allowedWrites: ["CitationRepairCertificate"], forbiddenActions: ["Do not edit manuscript source."], successCriteria: ["Protected state is unchanged."], reviewPolicy: {} } })
  const actor = await prisma.agentRun.create({ data: { workspaceId: workspace.id, projectId: project.id, workstreamId: workstream.id, role: "ProjectCoordinator", status: "running", model: "citation-repair-smoke", sessionId: `citation-repair-${suffix}`, inputBriefing: {}, toolCalls: [], createdObjectRefs: [], updatedObjectRefs: [] } })
  const sourceIngested = await ingestBytes(await zipBytes({ "main.tex": texFor(records), "references.bib": "", "main.pdf": "%PDF smoke", "build-manifest.json": "{}" }), workspace.id, "source.zip")
  const pdfIngested = await ingestBytes(Buffer.from("%PDF-1.7 exact citation repair smoke", "utf8"), workspace.id, "paper.pdf")
  const source = await prisma.artifact.create({ data: { workspaceId: workspace.id, projectId: project.id, kind: "other", title: "Exact source", originalFilename: "source.zip", mimeType: "application/zip", byteSize: sourceIngested.byteSize, sha256: sourceIngested.sha256, storageKey: sourceIngested.storageKey, storageStatus: "available", metadata: {} } })
  const pdf = await prisma.artifact.create({ data: { workspaceId: workspace.id, projectId: project.id, kind: "pdf", title: "Exact PDF", originalFilename: "paper.pdf", mimeType: "application/pdf", byteSize: pdfIngested.byteSize, sha256: pdfIngested.sha256, storageKey: pdfIngested.storageKey, storageStatus: "available", metadata: {} } })
  await prisma.artifactManuscriptVersion.createMany({ data: [
    { workspaceId: workspace.id, manuscriptVersionId: version.id, artifactId: source.id, role: "source_bundle" },
    { workspaceId: workspace.id, manuscriptVersionId: version.id, artifactId: pdf.id, role: "compiled_pdf" }
  ] })
  await prisma.paperBuild.create({ data: { workspaceId: workspace.id, projectId: project.id, manuscriptVersionId: version.id, status: "succeeded", builderVersion: `citation-smoke-${suffix}`, sourceHash: source.sha256!, sourceArtifactId: source.id, pdfArtifactId: pdf.id, buildManifest: { manuscript_version_id: version.id, manuscript_content_hash: contentHash }, completedAt: new Date() } })
  await prisma.reviewRound.create({ data: { workspaceId: workspace.id, projectId: project.id, workstreamId: workstream.id, targetObjectType: "ManuscriptVersion", targetObjectId: version.id, reviewerRole: "HostileReviewer", verdict: "approved", issues: [], requiredChanges: [], checkedRefs: [source.id, pdf.id], bodyMarkdown: "Protected exact review link.", evidenceStatus: "unverified_legacy", reviewType: "bibliography", targetVersion: version.id, inspectedArtifactIds: [source.id, pdf.id], checkedObligationIds: [obligation.id] } })
  const input: CitationRepairInput = { workspaceId: workspace.id, projectId: project.id, manuscriptVersionId: version.id, expectedContentHash: contentHash, expectedOldCitationFingerprint: EMPTY_SHA256, sourceArtifactId: source.id, sourceArtifactSha256: source.sha256!, pdfArtifactId: pdf.id, pdfArtifactSha256: pdf.sha256!, actorAgentRunId: actor.id, mode: "source_bundle", expectedNewCitationFingerprint: expectedFingerprint, idempotencyKey }
  return { workspaceId: workspace.id, projectId: project.id, versionId: version.id, obligationId: obligation.id, sourceId: source.id, pdfId: pdf.id, actorRunId: actor.id, input }
}

// Parser rejects missing, renamed, duplicate, extra, malformed, and altered citation data.
assert.throws(() => parseCitationRecordsFromTex(texFor(fiveKeyRecords.filter((record) => record.key !== "morgenstern_1994"), fiveKeyRecords.map((record) => record.key))), /CITATION_KEY_SET_MISMATCH/)
assert.throws(() => parseCitationRecordsFromTex(texFor(fiveKeyRecords.map((record) => record.key === "morgenstern_1994" ? { ...record, key: "morgenstern_1994_renamed" } : record), fiveKeyRecords.map((record) => record.key))), /CITATION_KEY_SET_MISMATCH/)
assert.throws(() => parseCitationRecordsFromTex(texFor([...fiveKeyRecords, fiveKeyRecords[0]])), /DUPLICATE_CITATION_KEY/)
assert.throws(() => parseCitationRecordsFromTex(texFor([...fiveKeyRecords, { key: "extra_2026", bibitem_latex: "Extra record." }], fiveKeyRecords.map((record) => record.key))), /CITATION_KEY_SET_MISMATCH/)
assert.throws(() => parseCitationRecordsFromTex(Buffer.from("not a bibliography", "utf8")), /AMBIGUOUS_BIBLIOGRAPHY/)
assert.throws(() => parseCitationRecordsFromTex(Buffer.from([0xff, 0xfe])), /INVALID_SOURCE_UTF8/)
assert.notEqual(computeCitationFingerprint(fiveKeyRecords.map((record) => record.key === "morgenstern_1994" ? { ...record, bibitem_latex: `${record.bibitem_latex}!` } : record)).fingerprint, VERSION_15_FINGERPRINT)

const primary = await fixture(fiveKeyRecords, VERSION_15_FINGERPRINT, `primary-${randomUUID()}`)
const before = await protectedManuscriptSnapshot(prisma, { workspaceId: primary.workspaceId, projectId: primary.projectId, manuscriptVersionId: primary.versionId, sourceArtifactId: primary.sourceId, pdfArtifactId: primary.pdfId })
const beforeVersionCount = await prisma.manuscriptVersion.count({ where: { projectId: primary.projectId } })
const beforeObligations = await prisma.proofObligation.findMany({ where: { manuscriptVersionId: primary.versionId }, orderBy: { id: "asc" } })
const beforeReviews = await prisma.reviewRound.findMany({ where: { projectId: primary.projectId }, orderBy: { id: "asc" } })
const applied = await repairExactVersionCitationMetadata(primary.input)
assert.equal(applied.delivery_outcome, "applied")
assert.equal(applied.certificate.applicationOutcome, "applied")
assert.equal(applied.certificate.newCitationFingerprint, VERSION_15_FINGERPRINT)
const after = await protectedManuscriptSnapshot(prisma, { workspaceId: primary.workspaceId, projectId: primary.projectId, manuscriptVersionId: primary.versionId, sourceArtifactId: primary.sourceId, pdfArtifactId: primary.pdfId })
assert.equal(before.digest, after.digest)
assert.equal(before.proofLedgerDigest, after.proofLedgerDigest)
assert.equal(await prisma.manuscriptVersion.count({ where: { projectId: primary.projectId } }), beforeVersionCount)
assert.deepEqual(await prisma.proofObligation.findMany({ where: { manuscriptVersionId: primary.versionId }, orderBy: { id: "asc" } }), beforeObligations)
assert.deepEqual(await prisma.reviewRound.findMany({ where: { projectId: primary.projectId }, orderBy: { id: "asc" } }), beforeReviews)
assert.equal(after.version.theoremFingerprint, before.version.theoremFingerprint)
assert.equal(after.version.lifecycleStage, before.version.lifecycleStage)
assert.equal(after.version.verificationState, before.version.verificationState)
assert.equal(after.version.freezeLevel, before.version.freezeLevel)
assert.equal(after.project.currentWorkingPaperId, before.project.currentWorkingPaperId)
assert.equal(after.physicalLinks.find((link) => link.artifactId === primary.sourceId)?.artifact.sha256, before.physicalLinks.find((link) => link.artifactId === primary.sourceId)?.artifact.sha256)
assert.equal(after.physicalLinks.find((link) => link.artifactId === primary.pdfId)?.artifact.sha256, before.physicalLinks.find((link) => link.artifactId === primary.pdfId)?.artifact.sha256)

const replayed = await repairExactVersionCitationMetadata(primary.input)
assert.equal(replayed.delivery_outcome, "replayed")
assert.equal(replayed.certificate.id, applied.certificate.id)
assert.equal(replayed.certificate.applicationOutcome, "applied")
assert.equal(await prisma.citationRepairCertificate.count({ where: { manuscriptVersionId: primary.versionId } }), 1)
assert.equal((await prisma.manuscriptVersion.findUniqueOrThrow({ where: { id: primary.versionId } })).citationMetadataRevision, 1)
const invariantAudit = await runExactVersionCitationRepairAudit({ workspaceId: primary.workspaceId, projectId: primary.projectId, certificateId: applied.certificate.id })
assert.equal(invariantAudit.passed, true)
assert.deepEqual(invariantAudit.protected_state_diff, [])
assert.equal(invariantAudit.audit.graphSnapshotHash, applied.certificate.protectedStateDigestAfter)

await assert.rejects(() => repairExactVersionCitationMetadata({ ...primary.input, mode: "explicit_map", citations: fourKeyRecords, idempotencyKey: undefined }), /SOURCE_MAP_MISMATCH/)
await assert.rejects(() => repairExactVersionCitationMetadata({ ...primary.input, mode: "explicit_map", citations: fiveKeyRecords, idempotencyKey: primary.input.idempotencyKey }), /IDEMPOTENCY_CONFLICT/)
await assert.rejects(() => prisma.citationRepairCertificate.update({ where: { id: applied.certificate.id }, data: { applicationOutcome: "rewritten" } }), /append-only/)

const identical = await fixture(fiveKeyRecords, VERSION_15_FINGERPRINT, `identical-${randomUUID()}`)
const identicalResults = await Promise.all([repairExactVersionCitationMetadata(identical.input), repairExactVersionCitationMetadata(identical.input)])
assert.deepEqual(new Set(identicalResults.map((result) => result.delivery_outcome)), new Set(["applied", "replayed"]))
assert.equal(identicalResults[0].certificate.id, identicalResults[1].certificate.id)
assert.equal(await prisma.citationRepairCertificate.count({ where: { manuscriptVersionId: identical.versionId } }), 1)

const divergent = await fixture(fiveKeyRecords, VERSION_15_FINGERPRINT)
const divergentResults = await Promise.allSettled([
  repairExactVersionCitationMetadata(divergent.input),
  repairExactVersionCitationMetadata({ ...divergent.input, mode: "explicit_map", citations: fiveKeyRecords })
])
assert.equal(divergentResults.filter((result) => result.status === "fulfilled").length, 1)
assert.equal(divergentResults.filter((result) => result.status === "rejected").length, 1)
assert.equal(await prisma.citationRepairCertificate.count({ where: { manuscriptVersionId: divergent.versionId } }), 1)

const drift = await fixture(fourKeyRecords, VERSION_10_FINGERPRINT, `drift-${randomUUID()}`)
await repairExactVersionCitationMetadata(drift.input)
await prisma.proofObligation.update({ where: { id: drift.obligationId }, data: { statementMarkdown: "Protected drift" } })
await assert.rejects(() => repairExactVersionCitationMetadata(drift.input), /REPLAY_STATE_DIVERGED/)

console.log("Exact-version citation metadata repair DB smoke passed")
await prisma.$disconnect()
