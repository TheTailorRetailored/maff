import { createHash, randomUUID } from "node:crypto"
import { createReadStream, createWriteStream } from "node:fs"
import { mkdir, rename, rm, stat } from "node:fs/promises"
import path from "node:path"
import { pipeline } from "node:stream/promises"
import { Transform, type Readable } from "node:stream"
import yauzl, { type Entry, type ZipFile } from "yauzl"
import { config } from "../config.js"

const root = () => path.resolve(config.dataDir, "artifacts")

const mimeByExtension: Record<string, string> = {
  ".bib": "application/x-bibtex", ".csv": "text/csv", ".json": "application/json",
  ".md": "text/markdown", ".pdf": "application/pdf", ".png": "image/png",
  ".tex": "application/x-tex", ".txt": "text/plain", ".zip": "application/zip"
}

export function inferMimeType(filename: string, supplied?: string) {
  return supplied?.trim() || mimeByExtension[path.extname(filename).toLowerCase()] || "application/octet-stream"
}

export function storagePath(storageKey: string) {
  const resolved = path.resolve(root(), storageKey)
  const prefix = `${root()}${path.sep}`
  if (!resolved.startsWith(prefix)) throw new Error("Invalid artifact storage key.")
  return resolved
}

export async function ingestFile(sourcePath: string, workspaceId: string) {
  const source = path.resolve(sourcePath)
  const allowed = config.artifactIngestRoots.some((allowedRoot) => source === allowedRoot || source.startsWith(`${allowedRoot}${path.sep}`))
  if (!allowed) throw Object.assign(new Error(`Artifact source path is outside configured ingestion roots: ${sourcePath}`), { status: 400 })
  const sourceStat = await stat(source).catch(() => null)
  if (!sourceStat?.isFile()) throw Object.assign(new Error(`Artifact source file does not exist or is not a regular file: ${sourcePath}`), { status: 400 })
  const temporaryDir = path.join(root(), ".incoming")
  await mkdir(temporaryDir, { recursive: true })
  const temporaryPath = path.join(temporaryDir, randomUUID())
  const hash = createHash("sha256")
  let byteSize = 0
  const meter = new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk)
      byteSize += chunk.length
      callback(null, chunk)
    }
  })
  try {
    await pipeline(createReadStream(source), meter, createWriteStream(temporaryPath, { flags: "wx", mode: 0o600 }))
    const sha256 = hash.digest("hex")
    const storageKey = path.posix.join(workspaceId, sha256.slice(0, 2), sha256)
    const destination = storagePath(storageKey)
    await mkdir(path.dirname(destination), { recursive: true })
    try {
      await rename(temporaryPath, destination)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
      await rm(temporaryPath, { force: true })
    }
    return { storageKey, sha256, byteSize, originalFilename: path.basename(source) }
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
    throw error
  }
}

export async function verifyStoredFile(storageKey: string, expectedSha256: string, expectedSize: bigint | number | null) {
  const file = storagePath(storageKey)
  const fileStat = await stat(file).catch(() => null)
  if (!fileStat?.isFile()) return { ok: false, status: "missing" as const, actualSha256: null, actualByteSize: null }
  const hash = createHash("sha256")
  let byteSize = 0
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk)
    byteSize += chunk.length
  }
  const actualSha256 = hash.digest("hex")
  const size = expectedSize === null ? null : Number(expectedSize)
  const ok = actualSha256 === expectedSha256 && (size === null || size === byteSize)
  return { ok, status: ok ? "available" as const : "corrupt" as const, actualSha256, actualByteSize: byteSize }
}

export function storedFileStream(storageKey: string) {
  return createReadStream(storagePath(storageKey))
}

function openZip(storageKey: string): Promise<ZipFile> {
  return new Promise((resolve, reject) => yauzl.open(storagePath(storageKey), { lazyEntries: true, autoClose: true }, (error, zip) => error || !zip ? reject(error ?? new Error("Unable to open ZIP archive.")) : resolve(zip)))
}

export async function listZipEntries(storageKey: string) {
  const zip = await openZip(storageKey)
  return new Promise<Array<{ path: string; compressed_size: number; byte_size: number; directory: boolean }>>((resolve, reject) => {
    const entries: Array<{ path: string; compressed_size: number; byte_size: number; directory: boolean }> = []
    zip.on("entry", (entry: Entry) => {
      entries.push({ path: entry.fileName, compressed_size: entry.compressedSize, byte_size: entry.uncompressedSize, directory: entry.fileName.endsWith("/") })
      zip.readEntry()
    })
    zip.once("error", reject)
    zip.once("end", () => resolve(entries))
    zip.readEntry()
  })
}

export async function openZipEntry(storageKey: string, requestedPath: string): Promise<{ entry: Entry; stream: Readable }> {
  const zip = await openZip(storageKey)
  return new Promise((resolve, reject) => {
    let settled = false
    zip.on("entry", (entry: Entry) => {
      if (entry.fileName !== requestedPath) return zip.readEntry()
      if (entry.fileName.endsWith("/")) return reject(Object.assign(new Error("Archive entry is a directory."), { status: 400 }))
      zip.openReadStream(entry, (error, stream) => {
        settled = true
        if (error || !stream) reject(error ?? new Error("Unable to read archive entry."))
        else resolve({ entry, stream })
      })
    })
    zip.once("error", reject)
    zip.once("end", () => { if (!settled) reject(Object.assign(new Error("Archive entry not found."), { status: 404 })) })
    zip.readEntry()
  })
}
