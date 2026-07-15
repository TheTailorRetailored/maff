import { createHash } from "node:crypto"
import { execFile } from "node:child_process"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import yazl from "yazl"
import type { Prisma } from "@prisma/client"
import { prisma } from "../db/prisma.js"
import { inferMimeType, ingestBytes, readZipEntryBytes } from "../artifacts/storage.js"

export const PAPER_BUILDER_VERSION = "1.0.0-tectonic"
const run = promisify(execFile)
const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex")
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
const generatedLatexExtensions = [".aux", ".bbl", ".bcf", ".blg", ".fdb_latexmk", ".fls", ".log", ".out", ".run.xml", ".synctex.gz", ".toc"]

export function sourcePreservingCompilationFiles(files: Record<string, Buffer>) {
  return Object.fromEntries(Object.entries(files).filter(([name]) => {
    const lower = name.replace(/\\/g, "/").toLowerCase()
    if (lower === "latexmkrc" || lower === ".latexmkrc" || lower.startsWith("build/")) return false
    return !generatedLatexExtensions.some((extension) => lower.endsWith(extension)) && lower !== "main.pdf" && lower !== "build-manifest.json"
  }))
}

export function validateSourcePreservingBuildLog(log: string) {
  const failures: Array<[RegExp, string]> = [
    [/LaTeX Warning: (?:Citation|Reference) .+ undefined/i, "unresolved citation or reference"],
    [/LaTeX Warning: There were undefined (?:citations|references)/i, "unresolved citations or references"],
    [/LaTeX Warning: Empty bibliography/i, "empty bibliography"],
    [/Package biblatex Warning: Empty bibliography/i, "empty bibliography"],
    [/Package biblatex Warning: Please \(re\)run Biber/i, "Biber rerun required"],
    [/(?:incompatible|wrong) .*\.bbl|\.bbl.*(?:incompatible|wrong format)/i, "incompatible bibliography output"]
  ]
  const found = failures.filter(([pattern]) => pattern.test(log)).map(([, description]) => description)
  if (found.length) throw new Error(`Source-preserving build final-log validation failed: ${[...new Set(found)].join(", ")}.`)
  return { ok: true }
}

function escapeLatexText(value: string) {
  return value.replace(/([#$%&_{}])/g, "\\$1").replace(/~/g, "\\textasciitilde{}").replace(/\^/g, "\\textasciicircum{}")
}

function inlineMarkdown(value: string) {
  const tokens: string[] = []
  const protectedText = value.replace(/(\$\$[\s\S]*?\$\$|\$[^$\n]+\$|\\(?:cite|ref|eqref|label)\{[^}]*\}|\[@[A-Za-z0-9:._-]+\])/g, (match) => {
    const normalized = match.startsWith("[@") ? `\\cite{${match.slice(2, -1)}}` : match
    tokens.push(normalized)
    return `MAFFTOKEN${tokens.length - 1}END`
  })
  return escapeLatexText(protectedText)
    .replace(/\*\*([^*]+)\*\*/g, "\\textbf{$1}")
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "\\emph{$1}")
    .replace(/MAFFTOKEN(\d+)END/g, (_match, index) => tokens[Number(index)])
}

export function markdownToLatex(markdown: string) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n")
  const output: string[] = []
  let list: "itemize" | "enumerate" | null = null
  const closeList = () => { if (list) output.push(`\\end{${list}}`); list = null }
  for (const line of lines) {
    const bullet = line.match(/^\s*[-*]\s+(.+)$/)
    const numbered = line.match(/^\s*\d+[.)]\s+(.+)$/)
    if (bullet || numbered) {
      const needed = bullet ? "itemize" : "enumerate"
      if (list !== needed) { closeList(); list = needed; output.push(`\\begin{${needed}}`) }
      output.push(`\\item ${inlineMarkdown((bullet ?? numbered)![1])}`)
      continue
    }
    closeList()
    const heading = line.match(/^(#{1,3})\s+(.+)$/)
    if (heading) {
      const command = heading[1].length === 1 ? "section" : heading[1].length === 2 ? "subsection" : "subsubsection"
      output.push(`\\${command}{${inlineMarkdown(heading[2])}}`)
    } else if (line.trim()) output.push(inlineMarkdown(line))
    else output.push("")
  }
  closeList()
  return output.join("\n")
}

function bibEscape(value: string) { return value.replace(/[{}]/g, "").replace(/&/g, "\\&") }
export function citationKey(paper: { id: string; authors: unknown; year: number | null; title: string }) {
  const author = strings(paper.authors)[0]?.split(/[ ,]/).filter(Boolean).at(-1) ?? "source"
  const word = paper.title.toLowerCase().match(/[a-z0-9]{4,}/)?.[0] ?? paper.id.slice(0, 8)
  return `${author.replace(/[^A-Za-z0-9]/g, "")}${paper.year ?? "nd"}${word}`
}

export function renderPaper(input: {
  title: string
  authors: string[]
  abstractMarkdown: string
  keywords: string[]
  sections: Array<{ stableKey: string; revision: number; ordinal: number; kind: string; title: string | null; contentMarkdown: string; sourceFormat: string; claimIds: unknown; citationKeys: unknown }>
  papers: Array<{ id: string; authors: unknown; year: number | null; title: string; venue: string | null; doi: string | null; url: string | null }>
}) {
  const body = input.sections.map((section) => {
    const title = section.title?.trim()
    const heading = title ? `\\section{${inlineMarkdown(title)}}\n` : ""
    const content = section.sourceFormat === "latex" ? section.contentMarkdown : markdownToLatex(section.contentMarkdown)
    return `% maff-section:${section.stableKey}@${section.revision}\n${heading}${content}`
  }).join("\n\n")
  const bibliography = input.papers.map((paper) => {
    const authors = strings(paper.authors).join(" and ") || "Unknown"
    const fields = [
      `  title = {${bibEscape(paper.title)}}`,
      `  author = {${bibEscape(authors)}}`,
      paper.year ? `  year = {${paper.year}}` : null,
      paper.venue ? `  journal = {${bibEscape(paper.venue)}}` : null,
      paper.doi ? `  doi = {${paper.doi}}` : null,
      paper.url ? `  url = {${paper.url}}` : null
    ].filter(Boolean)
    return `@article{${citationKey(paper)},\n${fields.join(",\n")}\n}`
  }).join("\n\n")
  const tex = `\\documentclass[11pt]{article}
\\usepackage[margin=1in]{geometry}
\\usepackage{amsmath,amssymb,amsthm,mathtools}
\\usepackage{hyperref}
\\usepackage{microtype}
\\newtheorem{theorem}{Theorem}[section]
\\newtheorem{lemma}[theorem]{Lemma}
\\newtheorem{proposition}[theorem]{Proposition}
\\newtheorem{corollary}[theorem]{Corollary}
\\theoremstyle{definition}
\\newtheorem{definition}[theorem]{Definition}
\\title{${inlineMarkdown(input.title)}}
\\author{${input.authors.length ? input.authors.map(inlineMarkdown).join(" \\and ") : "Anonymous"}}
\\date{}
\\begin{document}
\\maketitle
\\begin{abstract}
${markdownToLatex(input.abstractMarkdown)}
\\end{abstract}
${input.keywords.length ? `\\noindent\\textbf{Keywords:} ${input.keywords.map(inlineMarkdown).join(", ")}\n` : ""}
${body}
${bibliography ? "\\bibliographystyle{plain}\n\\bibliography{references}" : ""}
\\end{document}
`
  return { tex, bibliography }
}

async function zipSources(files: Record<string, string>) {
  const zip = new yazl.ZipFile()
  for (const [name, content] of Object.entries(files)) zip.addBuffer(Buffer.from(content, "utf8"), name)
  zip.end()
  const chunks: Buffer[] = []
  for await (const chunk of zip.outputStream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return Buffer.concat(chunks)
}

async function zipSourceBuffers(files: Record<string, Buffer>) {
  const zip = new yazl.ZipFile()
  for (const name of Object.keys(files).sort()) zip.addBuffer(files[name], name)
  zip.end()
  const chunks: Buffer[] = []
  for await (const chunk of zip.outputStream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return Buffer.concat(chunks)
}

async function createManagedArtifact(input: { workspaceId: string; projectId: string; workstreamId?: string; agentRunId?: string; title: string; filename: string; kind: "latex" | "pdf"; bytes: Buffer; metadata: Record<string, unknown> }) {
  const ingested = await ingestBytes(input.bytes, input.workspaceId, input.filename)
  return prisma.artifact.create({ data: {
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    workstreamId: input.workstreamId,
    createdByAgentRunId: input.agentRunId,
    title: input.title,
    kind: input.kind,
    originalFilename: input.filename,
    mimeType: inferMimeType(input.filename),
    byteSize: ingested.byteSize,
    sha256: ingested.sha256,
    contentHash: ingested.sha256,
    storageKey: ingested.storageKey,
    storageStatus: "available",
    visibility: "internal",
    metadata: input.metadata as Prisma.InputJsonValue
  } })
}

export async function executePaperBuild(input: { workspaceId: string; projectId: string; manuscriptVersionId: string; workstreamId?: string; agentRunId?: string; tex: string; bibliography: string; manifest: Record<string, unknown> }) {
  const sourceHash = sha256(`${input.tex}\n---references---\n${input.bibliography}`)
  const existing = await prisma.paperBuild.findUnique({ where: { manuscriptVersionId_builderVersion_sourceHash: { manuscriptVersionId: input.manuscriptVersionId, builderVersion: PAPER_BUILDER_VERSION, sourceHash } } })
  if (existing?.status === "succeeded") return existing
  const build = existing
    ? await prisma.paperBuild.update({ where: { id: existing.id }, data: { status: "running", logText: null, startedAt: new Date(), completedAt: null } })
    : await prisma.paperBuild.create({ data: { workspaceId: input.workspaceId, projectId: input.projectId, manuscriptVersionId: input.manuscriptVersionId, status: "running", builderVersion: PAPER_BUILDER_VERSION, sourceHash, buildManifest: input.manifest as Prisma.InputJsonValue } })
  const temp = await mkdtemp(path.join(os.tmpdir(), "maff-paper-"))
  try {
    const output = path.join(temp, "build")
    await mkdir(output)
    const main = path.join(temp, "main.tex")
    await writeFile(main, input.tex, "utf8")
    await writeFile(path.join(temp, "references.bib"), input.bibliography, "utf8")
    let stdout = "", stderr = ""
    try {
      const result = await run(process.env.TECTONIC_BIN ?? "tectonic", ["--outdir", output, "--keep-logs", main], { cwd: temp, timeout: 180_000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, XDG_CACHE_HOME: process.env.XDG_CACHE_HOME ?? "/data/tectonic-cache" } })
      stdout = result.stdout; stderr = result.stderr
    } catch (error: any) {
      stdout = String(error?.stdout ?? ""); stderr = String(error?.stderr ?? error?.message ?? error)
      await prisma.paperBuild.update({ where: { id: build.id }, data: { status: "failed", logText: `${stdout}\n${stderr}`.trim(), completedAt: new Date() } })
      throw new Error(`PaperBuilder compilation failed. Inspect build ${build.id}; no file was surfaced to the user.`)
    }
    const pdf = await readFile(path.join(output, "main.pdf"))
    const completeManifest = { ...input.manifest, builder_version: PAPER_BUILDER_VERSION, source_hash: sourceHash, manuscript_version_id: input.manuscriptVersionId }
    const sourceZip = await zipSources({ "main.tex": input.tex, "references.bib": input.bibliography, "build-manifest.json": `${JSON.stringify(completeManifest, null, 2)}\n` })
    const sourceArtifact = await createManagedArtifact({ ...input, title: "PaperBuilder source bundle", filename: "manuscript-source.zip", kind: "latex", bytes: sourceZip, metadata: { role: "source_bundle", required_files: ["main.tex", "references.bib", "build-manifest.json"], paper_build_id: build.id } })
    const pdfArtifact = await createManagedArtifact({ ...input, title: "PaperBuilder compiled manuscript", filename: "manuscript.pdf", kind: "pdf", bytes: pdf, metadata: { role: "compiled_pdf", paper_build_id: build.id } })
    await prisma.$transaction([
      prisma.artifactManuscriptVersion.upsert({ where: { artifactId_manuscriptVersionId_role: { artifactId: sourceArtifact.id, manuscriptVersionId: input.manuscriptVersionId, role: "source_bundle" } }, create: { workspaceId: input.workspaceId, artifactId: sourceArtifact.id, manuscriptVersionId: input.manuscriptVersionId, role: "source_bundle" }, update: {} }),
      prisma.artifactManuscriptVersion.upsert({ where: { artifactId_manuscriptVersionId_role: { artifactId: pdfArtifact.id, manuscriptVersionId: input.manuscriptVersionId, role: "compiled_pdf" } }, create: { workspaceId: input.workspaceId, artifactId: pdfArtifact.id, manuscriptVersionId: input.manuscriptVersionId, role: "compiled_pdf" }, update: {} }),
      prisma.paperBuild.update({ where: { id: build.id }, data: { status: "succeeded", sourceArtifactId: sourceArtifact.id, pdfArtifactId: pdfArtifact.id, buildManifest: completeManifest as Prisma.InputJsonValue, logText: `${stdout}\n${stderr}`.trim(), completedAt: new Date() } })
    ])
    return prisma.paperBuild.findUniqueOrThrow({ where: { id: build.id } })
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}

export async function executeSourcePreservingBuild(input: { workspaceId: string; projectId: string; manuscriptVersionId: string; workstreamId: string; agentRunId: string; files: Record<string, Buffer>; manifest: Record<string, unknown> }) {
  const safeEntries = Object.entries(input.files).filter(([name]) => name && !name.startsWith("/") && !name.startsWith("\\") && !name.split(/[\\/]/).includes(".."))
  if (safeEntries.length !== Object.keys(input.files).length || !input.files["main.tex"] || !input.files["references.bib"]) throw new Error("Source-preserving builds require safe archive paths with root main.tex and references.bib.")
  const sourceInputs = safeEntries.filter(([name]) => !["main.pdf", "main.log", "build-manifest.json"].includes(name)).sort(([a], [b]) => a.localeCompare(b))
  const sourceHash = sha256(Buffer.concat(sourceInputs.flatMap(([name, bytes]) => [Buffer.from(`${name}\0${bytes.length}\0`), bytes])))
  const builderVersion = "1.1.1-biber-validated"
  const existing = await prisma.paperBuild.findUnique({ where: { manuscriptVersionId_builderVersion_sourceHash: { manuscriptVersionId: input.manuscriptVersionId, builderVersion, sourceHash } } })
  if (existing?.status === "succeeded") return existing
  const build = existing
    ? await prisma.paperBuild.update({ where: { id: existing.id }, data: { status: "running", logText: null, startedAt: new Date(), completedAt: null } })
    : await prisma.paperBuild.create({ data: { workspaceId: input.workspaceId, projectId: input.projectId, manuscriptVersionId: input.manuscriptVersionId, status: "running", builderVersion, sourceHash, buildManifest: input.manifest as Prisma.InputJsonValue } })
  const temp = await mkdtemp(path.join(os.tmpdir(), "maff-source-successor-"))
  try {
    const compilationFiles = sourcePreservingCompilationFiles(Object.fromEntries(safeEntries))
    const ignoredCompilationInputs = safeEntries.map(([name]) => name).filter((name) => !Object.hasOwn(compilationFiles, name))
    for (const [name, bytes] of Object.entries(compilationFiles)) {
      const destination = path.join(temp, ...name.split("/"))
      await mkdir(path.dirname(destination), { recursive: true })
      await writeFile(destination, bytes)
    }
    const output = path.join(temp, "build")
    await mkdir(output)
    let stdout = "", stderr = ""
    try {
      const result = await run(process.env.LATEXMK_BIN ?? "latexmk", ["-norc", "-pdf", "-interaction=nonstopmode", "-halt-on-error", `-outdir=${output}`, path.join(temp, "main.tex")], { cwd: temp, timeout: 240_000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, XDG_CACHE_HOME: process.env.XDG_CACHE_HOME ?? "/data/tectonic-cache" } })
      stdout = result.stdout; stderr = result.stderr
    } catch (error: any) {
      stdout = String(error?.stdout ?? ""); stderr = String(error?.stderr ?? error?.message ?? error)
      await prisma.paperBuild.update({ where: { id: build.id }, data: { status: "failed", logText: `${stdout}\n${stderr}`.trim(), completedAt: new Date() } })
      throw new Error(`Source-preserving PaperBuilder compilation failed under latexmk. Inspect build ${build.id}; no file was surfaced to the user.`)
    }
    let finalLog = ""
    let pdf: Buffer
    try {
      finalLog = await readFile(path.join(output, "main.log"), "utf8")
      validateSourcePreservingBuildLog(finalLog)
      pdf = await readFile(path.join(output, "main.pdf"))
    } catch (error: any) {
      const failure = String(error?.message ?? error)
      await prisma.paperBuild.update({ where: { id: build.id }, data: { status: "failed", logText: `${finalLog}\n${failure}`.trim(), completedAt: new Date() } })
      throw new Error(`Source-preserving PaperBuilder final-output validation failed. Inspect build ${build.id}; no file was surfaced to the user.`)
    }
    const completeManifest = { ...input.manifest, builder_version: builderVersion, source_hash: sourceHash, manuscript_version_id: input.manuscriptVersionId, ignored_compilation_inputs: ignoredCompilationInputs }
    const bundledFiles = { ...input.files, "main.pdf": pdf, "build-manifest.json": Buffer.from(`${JSON.stringify(completeManifest, null, 2)}\n`) }
    const sourceZip = await zipSourceBuffers(bundledFiles)
    const sourceArtifact = await createManagedArtifact({ ...input, title: "PaperBuilder source-preserving successor bundle", filename: "manuscript-source.zip", kind: "latex", bytes: sourceZip, metadata: { role: "source_bundle", required_files: ["main.tex", "references.bib", "build-manifest.json"], paper_build_id: build.id, source_preserving: true } })
    const pdfArtifact = await createManagedArtifact({ ...input, title: "PaperBuilder source-preserving compiled manuscript", filename: "manuscript.pdf", kind: "pdf", bytes: pdf, metadata: { role: "compiled_pdf", paper_build_id: build.id, source_preserving: true } })
    await prisma.$transaction([
      prisma.artifactManuscriptVersion.upsert({ where: { artifactId_manuscriptVersionId_role: { artifactId: sourceArtifact.id, manuscriptVersionId: input.manuscriptVersionId, role: "source_bundle" } }, create: { workspaceId: input.workspaceId, artifactId: sourceArtifact.id, manuscriptVersionId: input.manuscriptVersionId, role: "source_bundle" }, update: {} }),
      prisma.artifactManuscriptVersion.upsert({ where: { artifactId_manuscriptVersionId_role: { artifactId: pdfArtifact.id, manuscriptVersionId: input.manuscriptVersionId, role: "compiled_pdf" } }, create: { workspaceId: input.workspaceId, artifactId: pdfArtifact.id, manuscriptVersionId: input.manuscriptVersionId, role: "compiled_pdf" }, update: {} }),
      prisma.paperBuild.update({ where: { id: build.id }, data: { status: "succeeded", sourceArtifactId: sourceArtifact.id, pdfArtifactId: pdfArtifact.id, buildManifest: completeManifest as Prisma.InputJsonValue, logText: finalLog, completedAt: new Date() } })
    ])
    return prisma.paperBuild.findUniqueOrThrow({ where: { id: build.id } })
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}

export async function inspectPaperBuild(workspaceId: string, buildId: string) {
  const build = await prisma.paperBuild.findFirstOrThrow({ where: { workspaceId, id: buildId }, include: { manuscriptVersion: { include: { artifact: true } }, sourceArtifact: true, pdfArtifact: true } })
  let tex: string | null = null, bibliography: string | null = null
  if (build.sourceArtifact?.storageKey) {
    tex = (await readZipEntryBytes(build.sourceArtifact.storageKey, "main.tex")).bytes.toString("utf8")
    bibliography = (await readZipEntryBytes(build.sourceArtifact.storageKey, "references.bib")).bytes.toString("utf8")
  }
  return {
    id: build.id,
    status: build.status,
    manuscript_version_id: build.manuscriptVersionId,
    manuscript_content_hash: build.manuscriptVersion.contentHash,
    builder_version: build.builderVersion,
    source_hash: build.sourceHash,
    normalized_manuscript_markdown: build.manuscriptVersion.artifact.contentMarkdown,
    tex,
    bibliography,
    build_log: build.logText,
    manifest: build.buildManifest,
    pdf: build.pdfArtifact ? { artifact_id: build.pdfArtifact.id, sha256: build.pdfArtifact.sha256, byte_size: build.pdfArtifact.byteSize === null ? null : Number(build.pdfArtifact.byteSize), surfaced: false } : null
  }
}
