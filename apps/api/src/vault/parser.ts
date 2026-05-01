import fs from "node:fs/promises"
import matter from "gray-matter"
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
  target: "targets"
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
  const parsed = matter(raw)
  const metadata = parsed.data as Record<string, unknown>
  const body = parsed.content.trimStart()
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
  return matter.stringify(body.trimStart(), metadata).trimEnd() + "\n"
}

