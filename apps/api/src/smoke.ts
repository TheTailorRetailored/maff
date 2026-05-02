import assert from "node:assert/strict"
import path from "node:path"
import { assertInsideRoot } from "./vault/paths.js"
import { extractWikilinks } from "./vault/wikilinks.js"
import { toolDefinitions } from "./mcp/server.js"

const root = path.resolve("tmp-workspace")
assert.equal(assertInsideRoot(root, path.join(root, "vault", "A.md")), path.resolve(root, "vault", "A.md"))
assert.throws(() => assertInsideRoot(root, path.resolve(root, "..", "escape.md")), /escapes/)
assert.deepEqual(extractWikilinks("See [[Problem - A]] and [[Lemma|alias]]."), ["Problem - A", "Lemma"])

for (const name of ["maff_bootstrap", "start_research_session", "create_conjecture"]) {
  if (name === "tools/list") continue
  assert.ok(toolDefinitions.some((tool) => tool.name === name), `missing MCP tool ${name}`)
}

const updateMetadata = toolDefinitions.find((tool) => tool.name === "update_node_metadata")
assert.ok(updateMetadata, "missing MCP tool update_node_metadata")
assert.ok((updateMetadata.inputSchema.properties as Record<string, unknown>).patch, "update_node_metadata schema must advertise patch")

const createClaim = toolDefinitions.find((tool) => tool.name === "create_claim")
assert.ok(createClaim, "missing MCP tool create_claim")
const createClaimProps = createClaim.inputSchema.properties as Record<string, unknown>
for (const prop of ["problem_id", "title", "statement", "claim_kind", "role", "claim_status", "proof_status", "lean_status", "depends_on", "supports", "blocked_by", "area", "short_title", "body_sections"]) {
  assert.ok(createClaimProps[prop], `create_claim schema must advertise ${prop}`)
}

console.log("Maff smoke checks passed")
