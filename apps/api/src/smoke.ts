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

console.log("Maff smoke checks passed")
