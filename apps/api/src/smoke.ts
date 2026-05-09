import assert from "node:assert/strict"
import path from "node:path"
import { assertInsideRoot } from "./vault/paths.js"
import { extractWikilinks } from "./vault/wikilinks.js"
import { mcpServerVersion, mcpToolsListResult, toolDefinitions } from "./mcp/server.js"

const root = path.resolve("tmp-workspace")
assert.equal(assertInsideRoot(root, path.join(root, "vault", "A.md")), path.resolve(root, "vault", "A.md"))
assert.throws(() => assertInsideRoot(root, path.resolve(root, "..", "escape.md")), /escapes/)
assert.deepEqual(extractWikilinks("See [[Problem - A]] and [[Lemma|alias]]."), ["Problem - A", "Lemma"])

for (const name of [
  "create_project",
  "get_my_maff_context",
  "claim_next_assignment",
  "claim_next_review",
  "propose_project_goal",
  "approve_project_goal",
  "create_workstream",
  "claim_agent_assignment",
  "start_agent_run",
  "get_agent_briefing",
  "create_claim",
  "create_proof_route",
  "create_or_update_workstream_report",
  "submit_report_for_review",
  "record_review_round",
  "complete_workstream",
  "update_claim_status",
  "create_lean_theorem",
  "mark_lean_verified",
  "get_project_control_room"
]) {
  if (name === "tools/list") continue
  assert.ok(toolDefinitions.some((tool) => tool.name === name), `missing MCP tool ${name}`)
}

const createClaim = toolDefinitions.find((tool) => tool.name === "create_claim")
assert.ok(createClaim, "missing MCP tool create_claim")
const createClaimProps = createClaim.inputSchema.properties as Record<string, unknown>
for (const prop of ["project_id", "title", "statement", "statement_markdown", "claim_kind", "kind", "status", "actor_role", "metadata"]) {
  assert.ok(createClaimProps[prop], `create_claim schema must advertise ${prop}`)
}
assert.equal(createClaimProps.supports, undefined, "create_claim schema should not advertise reverse Claim-to-Claim supports")

const routeTool = toolDefinitions.find((tool) => tool.name === "create_proof_route")
assert.ok(routeTool, "missing MCP tool create_proof_route")
const routeProps = routeTool.inputSchema.properties as Record<string, unknown>
for (const prop of ["project_id", "claim_id", "strategy_markdown", "required_lemmas", "first_testable_step", "kill_condition", "workstream_id"]) {
  assert.ok(routeProps[prop], `create_proof_route schema must advertise ${prop}`)
}

assert.equal(mcpServerVersion, "0.4.0-co-mathematician-runtime")
const toolsList = mcpToolsListResult()
const toolsListNames = new Set(toolsList.tools.map((tool) => tool.name))
for (const name of ["get_my_maff_context", "claim_next_assignment", "claim_next_review", "create_project", "propose_project_goal", "approve_project_goal", "create_workstream", "claim_agent_assignment", "start_agent_run", "submit_workstream_report", "record_review_round", "complete_workstream", "create_claim", "create_proof_route", "create_proof_attempt", "create_gap"]) {
  assert.ok(toolsListNames.has(name), `tools/list missing ${name}`)
}
for (const name of ["maff_bootstrap", "start_workflow", "complete_workflow", "create_task", "claim_task", "get_node", "search_nodes", "list_problem_graphs", "update_node_metadata", "get_skill_pack"]) {
  assert.equal(toolsListNames.has(name), false, `${name} should not be exposed in Maff v2 tools/list`)
}

const markLeanVerified = toolDefinitions.find((tool) => tool.name === "mark_lean_verified")
assert.ok(markLeanVerified, "missing mark_lean_verified")
assert.ok((markLeanVerified.inputSchema.properties as Record<string, unknown>).lean_theorem_id, "mark_lean_verified must advertise typed lean_theorem_id")

const leanCheck = toolDefinitions.find((tool) => tool.name === "lean_check")
assert.ok(leanCheck, "missing lean_check")
assert.ok((leanCheck.inputSchema.properties as Record<string, unknown>).lean_theorem_id, "lean_check must advertise typed lean_theorem_id")

console.log("Maff v2 smoke checks passed")
