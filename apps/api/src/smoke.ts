import assert from "node:assert/strict"
import path from "node:path"
import { assertInsideRoot } from "./vault/paths.js"
import { extractWikilinks } from "./vault/wikilinks.js"
import { mcpServerVersion, mcpToolsListResult, toolDefinitions } from "./mcp/server.js"

const root = path.resolve("tmp-workspace")
assert.equal(assertInsideRoot(root, path.join(root, "vault", "A.md")), path.resolve(root, "vault", "A.md"))
assert.throws(() => assertInsideRoot(root, path.resolve(root, "..", "escape.md")), /escapes/)
assert.deepEqual(extractWikilinks("See [[Problem - A]] and [[Lemma|alias]]."), ["Problem - A", "Lemma"])

for (const name of ["maff_bootstrap", "start_research_session", "create_conjecture", "create_claim", "add_route_to_claim", "append_proof_attempt_to_claim", "add_inline_gap_to_claim", "archive_node", "get_problem_graph", "list_problem_graphs"]) {
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

const routeTool = toolDefinitions.find((tool) => tool.name === "add_route_to_claim")
assert.ok(routeTool, "missing MCP tool add_route_to_claim")
const routeProps = routeTool.inputSchema.properties as Record<string, unknown>
assert.ok(routeProps.blockers, "add_route_to_claim schema must advertise blockers")
assert.ok(routeProps.proposed_decomposition, "add_route_to_claim schema must advertise proposed_decomposition")

assert.equal(mcpServerVersion, "0.3.0-claim-graph")
const toolsList = mcpToolsListResult()
const toolsListNames = new Set(toolsList.tools.map((tool) => tool.name))
for (const name of ["create_claim", "add_route_to_claim", "append_proof_attempt_to_claim", "add_inline_gap_to_claim", "archive_node", "get_problem_graph", "list_problem_graphs"]) {
  assert.ok(toolsListNames.has(name), `tools/list missing ${name}`)
}
const listedUpdateMetadata = toolsList.tools.find((tool) => tool.name === "update_node_metadata")
const listedInputSchemaProps = listedUpdateMetadata?.inputSchema.properties as Record<string, unknown> | undefined
const listedInputSnakeSchemaProps = listedUpdateMetadata?.input_schema.properties as Record<string, unknown> | undefined
assert.ok(listedInputSchemaProps?.patch, "tools/list update_node_metadata must advertise inputSchema.patch")
assert.ok(listedInputSnakeSchemaProps?.patch, "tools/list update_node_metadata must advertise input_schema.patch")

console.log("Maff smoke checks passed")
