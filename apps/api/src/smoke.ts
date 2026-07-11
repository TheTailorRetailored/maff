import assert from "node:assert/strict"
import path from "node:path"
import { assertInsideRoot } from "./vault/paths.js"
import { dumpMarkdown, parseMarkdown } from "./vault/parser.js"
import { extractWikilinks } from "./vault/wikilinks.js"
import { emailMatchesRequiredDomain } from "./auth/auth0.js"
import { compactToolResult, contentResult, mcpServerVersion, mcpToolsListResult, structuredContentForTool, toolDefinitions } from "./mcp/server.js"

const root = path.resolve("tmp-workspace")
assert.equal(assertInsideRoot(root, path.join(root, "vault", "A.md")), path.resolve(root, "vault", "A.md"))
assert.throws(() => assertInsideRoot(root, path.resolve(root, "..", "escape.md")), /escapes/)
assert.deepEqual(extractWikilinks("See [[Problem - A]] and [[Lemma|alias]]."), ["Problem - A", "Lemma"])

const markdown = dumpMarkdown(
  { id: "claim-demo", type: "Claim", depends_on: ["[[Definition - Demo]]"], title: "Demo claim" },
  "# Demo claim\n\nSee [[Paper - Demo]]."
)
const parsedMarkdown = parseMarkdown(markdown)
assert.equal(parsedMarkdown.title, "Demo claim")
assert.equal(parsedMarkdown.metadata.id, "claim-demo")
assert.deepEqual(parsedMarkdown.wikilinks, ["Paper - Demo"])
assert.deepEqual(parsedMarkdown.edges.map((edge) => [edge.targetRef, edge.edgeType]), [
  ["Definition - Demo", "depends_on"],
  ["Paper - Demo", "links_to"]
])
assert.throws(() => parseMarkdown("---\n- invalid\n---\nBody"), /mapping/)
assert.equal(emailMatchesRequiredDomain(undefined, undefined), true)
assert.equal(emailMatchesRequiredDomain("Researcher@Example.com", "example.com"), true)
assert.equal(emailMatchesRequiredDomain("researcher@example.com", "@EXAMPLE.COM"), true)
assert.equal(emailMatchesRequiredDomain(undefined, "example.com"), false)
assert.equal(emailMatchesRequiredDomain("researcher@notexample.com", "example.com"), false)

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

const submitReport = toolDefinitions.find((tool) => tool.name === "submit_report_for_review")
assert.ok(submitReport, "missing MCP tool submit_report_for_review")
assert.deepEqual((submitReport.inputSchema as { required?: string[] }).required, ["workspace_id"])
const submitReportProps = submitReport.inputSchema.properties as Record<string, unknown>
for (const prop of ["report_id", "workstream_id"]) {
  assert.ok(submitReportProps[prop], `submit_report_for_review schema must advertise ${prop}`)
}

assert.equal(mcpServerVersion, "0.4.1-structured-content-objects")
const toolsList = mcpToolsListResult()
const toolsListNames = new Set(toolsList.tools.map((tool) => tool.name))
for (const name of ["get_my_maff_context", "claim_next_assignment", "claim_next_review", "create_project", "propose_project_goal", "approve_project_goal", "create_workstream", "claim_agent_assignment", "start_agent_run", "submit_workstream_report", "record_review_round", "complete_workstream", "create_claim", "create_proof_route", "create_proof_attempt", "create_gap"]) {
  assert.ok(toolsListNames.has(name), `tools/list missing ${name}`)
}
for (const name of ["maff_bootstrap", "start_workflow", "complete_workflow", "create_task", "claim_task", "get_node", "search_nodes", "list_problem_graphs", "update_node_metadata", "get_skill_pack"]) {
  assert.equal(toolsListNames.has(name), false, `${name} should not be exposed in Maff v2 tools/list`)
}

for (const listedTool of toolsList.tools) {
  assert.equal(listedTool.outputSchema.type, "object", `${listedTool.name} must advertise an object outputSchema`)
  assert.equal(typeof listedTool.annotations.readOnlyHint, "boolean", `${listedTool.name} must advertise tool annotations`)
}

assert.deepEqual(structuredContentForTool("list_research_deltas", [{ id: "delta-1" }]), { deltas: [{ id: "delta-1" }] })
assert.deepEqual(structuredContentForTool("list_research_artifacts", []), { artifacts: [] })
assert.deepEqual(structuredContentForTool("list_research_links", [{ id: "link-1" }]), { links: [{ id: "link-1" }] })
assert.deepEqual(structuredContentForTool("list_mechanisms", []), { mechanisms: [] })
assert.deepEqual(structuredContentForTool("list_spinout_candidates", []), { spinouts: [] })
assert.deepEqual(structuredContentForTool("list_assumption_regimes", []), { assumptions: [] })
assert.deepEqual(structuredContentForTool("list_theorem_contracts", []), { contracts: [] })
assert.deepEqual(structuredContentForTool("unknown_array_tool", [1, 2]), { items: [1, 2] })
assert.deepEqual(structuredContentForTool("unknown_string_tool", "ok"), { result: "ok" })
assert.deepEqual(structuredContentForTool("unknown_null_tool", null), { result: null })
assert.deepEqual(contentResult("list_research_deltas", [{ id: "delta-1" }]).structuredContent, { deltas: [{ id: "delta-1" }] })

for (const [name, key] of [
  ["list_workspaces", "workspaces"],
  ["list_projects", "projects"],
  ["list_project_goals", "goals"],
  ["list_workstreams", "workstreams"],
  ["list_review_rounds", "reviews"]
] as const) {
  const compacted = compactToolResult(name, []) as Record<string, unknown>
  assert.deepEqual(compacted[key], [], `${name} must wrap its list in ${key}`)
}

const markLeanVerified = toolDefinitions.find((tool) => tool.name === "mark_lean_verified")
assert.ok(markLeanVerified, "missing mark_lean_verified")
assert.ok((markLeanVerified.inputSchema.properties as Record<string, unknown>).lean_theorem_id, "mark_lean_verified must advertise typed lean_theorem_id")

const leanCheck = toolDefinitions.find((tool) => tool.name === "lean_check")
assert.ok(leanCheck, "missing lean_check")
assert.ok((leanCheck.inputSchema.properties as Record<string, unknown>).lean_theorem_id, "lean_check must advertise typed lean_theorem_id")

const compactReviewClaim = compactToolResult("claim_next_review", {
  workspace: { id: "w", slug: "s", name: "Workspace", type: "private", ownerUserId: "u" },
  project: { id: "p", slug: "proj", title: "Project", area: "math", statement: "Long statement", status: "active", coordinatorSummary: "Long summary" },
  assignment: { id: "ws", title: "review", kind: "literature_review", status: "needs_review", priority: 1, coordinatorRole: "LiteratureAgent", reportId: "r", instructions: "Long instructions" },
  briefing: {
    role: "HostileReviewer",
    project: { id: "p", slug: "proj", title: "Project", area: "math", statement: "Long statement", status: "active", coordinatorSummary: "Long summary" },
    workstream: { id: "ws", title: "review", kind: "literature_review", status: "needs_review", priority: 1, coordinatorRole: "LiteratureAgent", reportId: "r", instructions: "Long instructions" },
    report: { id: "r", title: "Report", status: "submitted", bodyMarkdown: "Very long body", linkedObjectRefs: ["a"], artifactRefs: [], uncertaintyNotes: [] },
    related_known_results: [{ id: "k1" }, { id: "k2" }]
  },
  agent_run: { id: "run", role: "HostileReviewer", status: "running", model: "gpt", sessionId: "sess", startedAt: "now" },
  session_id: "sess"
}) as Record<string, any>
assert.equal(compactReviewClaim.assignment.report_id, "r")
assert.equal(compactReviewClaim.briefing.report.bodyMarkdown, undefined)
assert.equal(compactReviewClaim.briefing.report.body_markdown, "Very long body")
assert.deepEqual(compactReviewClaim.briefing.report.linked_object_refs, ["a"])
assert.equal(compactReviewClaim.briefing.related_known_result_count, 2)
assert.deepEqual(compactReviewClaim.briefing.related_known_results.map((item: any) => item.id), ["k1", "k2"])

const compactReport = compactToolResult("get_report", {
  id: "r",
  title: "Report",
  status: "submitted",
  bodyMarkdown: "A".repeat(500),
  linkedObjectRefs: ["a", "b"],
  artifactRefs: [],
  uncertaintyNotes: ["u"],
  workstream: { id: "ws", title: "w", kind: "literature_review", status: "needs_review", priority: 1, coordinatorRole: "LiteratureAgent" },
  reviews: [{ id: "rev", verdict: "approved", bodyMarkdown: "Looks good" }]
}) as Record<string, any>
assert.equal(compactReport.report.bodyMarkdown, undefined)
assert.equal(compactReport.report.body_markdown, "A".repeat(500))
assert.deepEqual(compactReport.report.linked_object_refs, ["a", "b"])
assert.deepEqual(compactReport.report.uncertainty_notes, ["u"])
assert.equal(compactReport.report.review_count, 1)
assert.equal(compactReport.workstream.id, "ws")

const compactWorkstream = compactToolResult("get_workstream", {
  id: "ws",
  title: "w",
  kind: "literature_review",
  status: "needs_review",
  priority: 1,
  coordinatorRole: "LiteratureAgent",
  reports: [{ id: "r", title: "Report", status: "submitted", bodyMarkdown: "Full workstream report", linkedObjectRefs: ["k1"], artifactRefs: [], uncertaintyNotes: [] }],
  reviews: [],
  agentRuns: [],
  messages: [],
  artifacts: []
}) as Record<string, any>
assert.equal(compactWorkstream.reports[0].body_markdown, "Full workstream report")
assert.deepEqual(compactWorkstream.reports[0].linked_object_refs, ["k1"])

const compactGraph = compactToolResult("get_object_graph", {
  nodes: [{ id: "k1", title: "Known result", statementMarkdown: "Statement", applicabilityMarkdown: "Applies under X", status: "cited" }],
  edges: [{ sourceType: "WorkstreamReport", sourceId: "r", targetType: "KnownResult", targetId: "k1", edgeType: "cites" }]
}) as Record<string, any>
assert.equal(compactGraph.nodes.length, 1)
assert.equal(compactGraph.nodes[0].type, "KnownResult")
assert.equal(compactGraph.objects.length, 1)

const compactFrontierSearch = compactToolResult("search_research_objects", {
  claims: [], routes: [], gaps: [], papers: [], known_results: [],
  research_deltas: [{ id: "d1", title: "Gittins delta", summaryMarkdown: "Summary", whatChangedMarkdown: "Changed" }],
  research_artifacts: [{ id: "a1", title: "Artifact", slug: "artifact", kind: "memo", contentMarkdown: "Content", filePath: null }],
  mechanisms: [{ id: "m1", title: "Mechanism", slug: "mechanism", maturity: "sketched", coreIdeaMarkdown: "Idea" }],
  spinout_candidates: [{ id: "s1", title: "Spinout", slug: "spinout", statementSketchMarkdown: "Statement" }],
  assumption_regimes: [{ id: "r1", title: "Regime", slug: "regime", formalStatementMarkdown: "Assume", includesMarkdown: null }],
  theorem_contracts: [{ id: "t1", title: "Contract", slug: "contract", theoremStatementMarkdown: "Theorem" }],
  frontier_snapshots: [{ id: "f1", title: "Snapshot", snapshotMarkdown: "Frontier", source: "test" }]
}) as Record<string, any>
assert.deepEqual(Object.keys(compactFrontierSearch).sort(), ["assumption_regimes", "claims", "frontier_snapshots", "gaps", "known_results", "mechanisms", "papers", "research_artifacts", "research_deltas", "routes", "spinout_candidates", "theorem_contracts"])
assert.equal(compactFrontierSearch.research_deltas[0].id, "d1")
assert.equal(compactFrontierSearch.mechanisms[0].id, "m1")
assert.equal(compactFrontierSearch.research_deltas[0].type, "ResearchDelta")
assert.equal(compactFrontierSearch.research_artifacts[0].type, "ResearchArtifact")
assert.equal(compactFrontierSearch.mechanisms[0].type, "Mechanism")
assert.equal(compactFrontierSearch.spinout_candidates[0].type, "SpinoutCandidate")
assert.equal(compactFrontierSearch.assumption_regimes[0].type, "AssumptionRegime")
assert.equal(compactFrontierSearch.theorem_contracts[0].type, "TheoremContract")
assert.equal(compactFrontierSearch.frontier_snapshots[0].type, "ResearchFrontierSnapshot")
const compactMechanismList = compactToolResult("list_mechanisms", [{ id: "m2", title: "Listed mechanism", maturity: "sketched", coreIdeaMarkdown: "Idea" }]) as any[]
assert.equal(compactMechanismList[0].type, "Mechanism")
const compactRegimeList = compactToolResult("list_assumption_regimes", [{ id: "r2", title: "Listed regime", formalStatementMarkdown: "Assume", includesMarkdown: null }]) as any[]
assert.equal(compactRegimeList[0].type, "AssumptionRegime")
const compactSpinoutList = compactToolResult("list_spinout_candidates", [{ id: "s2", title: "Listed spinout", statementSketchMarkdown: "Statement" }]) as any[]
assert.equal(compactSpinoutList[0].type, "SpinoutCandidate")

for (const name of ["create_project", "create_research_delta", "list_research_deltas", "create_research_artifact", "get_research_artifact", "update_research_artifact", "list_research_artifacts", "create_spinout_candidate", "create_research_link", "list_research_links", "list_mechanisms", "list_assumption_regimes", "list_spinout_candidates", "list_theorem_contracts", "list_frontier_snapshots", "search_research_objects", "rebuild_quartz_site"]) {
  const descriptor = toolsList.tools.find((tool) => tool.name === name) as Record<string, any> | undefined
  assert.ok(descriptor?.outputSchema, `${name} must advertise outputSchema`)
  assert.ok(descriptor?.annotations, `${name} must advertise annotations`)
}
assert.equal((toolsList.tools.find((tool) => tool.name === "search_research_objects") as any).annotations.readOnlyHint, true)
assert.equal((toolsList.tools.find((tool) => tool.name === "get_research_artifact") as any).annotations.readOnlyHint, true)
assert.equal((toolsList.tools.find((tool) => tool.name === "rebuild_quartz_site") as any).annotations.idempotentHint, true)

const fullArtifactBody = "A".repeat(12_000)
const fullArtifact = compactToolResult("get_research_artifact", {
  id: "artifact-1",
  projectId: "project-1",
  title: "Manuscript",
  slug: "manuscript",
  kind: "paper_draft",
  status: "draft",
  descriptionMarkdown: "A paper draft",
  contentMarkdown: fullArtifactBody,
  filePath: "manuscripts/paper.tex",
  url: null,
  createdAt: "2026-07-11T00:00:00.000Z",
  updatedAt: "2026-07-11T01:00:00.000Z"
}) as Record<string, any>
assert.equal(fullArtifact.content_markdown, fullArtifactBody, "get_research_artifact must not truncate manuscript bodies")
assert.equal(fullArtifact.file_path, "manuscripts/paper.tex")

console.log("Maff v2 smoke checks passed")
