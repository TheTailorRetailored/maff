import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { createWriteStream } from "node:fs"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { pipeline } from "node:stream/promises"
import yazl from "yazl"

const root = await mkdtemp(path.join(os.tmpdir(), "maff-storage-smoke-"))
process.env.DATA_DIR = path.join(root, "data")
const storage = await import("./storage.js")

try {
  const source = path.join(root, "bundle.zip")
  const zip = new yazl.ZipFile()
  const tex = Buffer.from("\\documentclass{article}\\begin{document}Exact\\end{document}\n")
  const pdf = Buffer.from("%PDF-1.4\n% exact smoke\n")
  zip.addBuffer(tex, "main.tex")
  zip.addBuffer(pdf, "main.pdf")
  zip.end()
  await pipeline(zip.outputStream, createWriteStream(source))
  const original = await readFile(source)
  const expectedHash = createHash("sha256").update(original).digest("hex")
  const ingested = await storage.ingestFile(source, "11111111-1111-1111-1111-111111111111")
  assert.equal(ingested.sha256, expectedHash)
  assert.equal(ingested.byteSize, original.length)

  await writeFile(source, "mutated source")
  await rm(source)
  assert.deepEqual(await readFile(storage.storagePath(ingested.storageKey)), original)
  assert.equal((await storage.verifyStoredFile(ingested.storageKey, expectedHash, original.length)).ok, true)
  const entries = await storage.listZipEntries(ingested.storageKey)
  assert.deepEqual(entries.map((entry) => entry.path), ["main.tex", "main.pdf"])
  const selected = await storage.openZipEntry(ingested.storageKey, "main.tex")
  const chunks: Buffer[] = []
  for await (const chunk of selected.stream) chunks.push(Buffer.from(chunk))
  assert.deepEqual(Buffer.concat(chunks), tex)
  const selectedPdf = await storage.openZipEntry(ingested.storageKey, "main.pdf")
  const pdfChunks: Buffer[] = []
  for await (const chunk of selectedPdf.stream) pdfChunks.push(Buffer.from(chunk))
  assert.deepEqual(Buffer.concat(pdfChunks), pdf)

  await writeFile(storage.storagePath(ingested.storageKey), "corrupt")
  assert.equal((await storage.verifyStoredFile(ingested.storageKey, expectedHash, original.length)).ok, false)
  await rm(storage.storagePath(ingested.storageKey))
  assert.equal((await storage.verifyStoredFile(ingested.storageKey, expectedHash, original.length)).status, "missing")
  console.log("Durable artifact storage smoke checks passed")
} finally {
  await rm(root, { recursive: true, force: true })
}
