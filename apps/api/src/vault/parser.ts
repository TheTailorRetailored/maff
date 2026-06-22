import fs from "node:fs/promises"
import YAML from "yaml"
import { extractWikilinks } from "./wikilinks.js"

export const typedEdgeFields: Record<string, string> = {
  problem: "problem",
  parent: "parent",
  depends_on: "depends_on",
  supports: "supports",
  contradicts: "contradicts",
  disproves: "disproves",
  blocked_by: "blocked_by",
  routes: "route",
  attempts: "attempt",
  related_papers: "cites",
  formalizes: "formalizes",
  source_proof: "formalizes",
  target: "targets",
  main_claims: "main_claim"
}

export type ParsedNode = {
  metadata: Record<string, unknown>
  body: string
  title: string
  wikilinks: string[]
  edges: { targetRef: string; edgeType: string; sourceField?: string }[]
}

function firstH1(body: string) {
  return body.split(/\r?\n/).find((line) => line.startsWith("# "))?.replace(/^#\s+/, "").trim()
}

function valueLinks(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(valueLinks)
  if (typeof value === "string") return extractWikilinks(value).length ? extractWikilinks(value) : [value]
  return []
}

export function parseMarkdown(raw: string): ParsedNode {
  const normalized = raw.replace(/^\uFEFF/, "")
  const frontmatter = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  const parsedMetadata = frontmatter ? YAML.parse(frontmatter[1]) : {}
  if (parsedMetadata !== null && (typeof parsedMetadata !== "object" || Array.isArray(parsedMetadata))) {
    throw new Error("Markdown frontmatter must be a YAML mapping")
  }
  const metadata = (parsedMetadata ?? {}) as Record<string, unknown>
  const body = (frontmatter ? normalized.slice(frontmatter[0].length) : normalized).trimStart()
  const title = String(metadata.title ?? firstH1(body) ?? metadata.id ?? "Untitled")
  const bodyLinks = extractWikilinks(body)
  const edges: ParsedNode["edges"] = []
  for (const [field, edgeType] of Object.entries(typedEdgeFields)) {
    for (const targetRef of valueLinks(metadata[field])) edges.push({ targetRef, edgeType, sourceField: field })
  }
  for (const targetRef of bodyLinks) edges.push({ targetRef, edgeType: "links_to" })
  return { metadata, body, title, wikilinks: bodyLinks, edges }
}

export async function parseMarkdownFile(filePath: string) {
  return parseMarkdown(await fs.readFile(filePath, "utf8"))
}

export function dumpMarkdown(metadata: Record<string, unknown>, body: string) {
  const frontmatter = YAML.stringify(metadata, { lineWidth: 0 }).trimEnd()
  return `---\n${frontmatter}\n---\n${body.trimStart().trimEnd()}\n`
}
