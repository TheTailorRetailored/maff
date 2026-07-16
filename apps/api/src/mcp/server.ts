import { createHash } from "node:crypto"
import type { Request, Response } from "express"
import type { WorkspaceRole } from "@prisma/client"
import { acceptedClientRolesForScope, scopes, hasBearerAuthorization } from "../auth/scopes.js"
import { requireWorkspaceRole } from "../auth/permissions.js"
import { config } from "../config.js"
import { readResource, listResources } from "./resources.js"
import { createLeanProject, createLeanStub, leanCheck, leanGoal } from "./tools/leanTools.js"
import { quartzStatus, rebuildQuartz } from "./tools/siteTools.js"
import { getPrompt, listPrompts } from "./prompts.js"
import * as runtime from "../research/runtime.js"

type ToolContext = { userId: string; claimsScope?: string; resourceAccess?: unknown; aud?: unknown; sub?: string; azp?: string; clientId?: string }
type JsonSchema = Record<string, unknown>
type JsonObject = Record<string, unknown>

const objectSchema = (properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema => ({ type: "object", properties, required, additionalProperties: false })
const s = { type: "string" } as const
const n = { type: "number" } as const
const anyObj = { type: "object", additionalProperties: true } as const
const strArray = { type: "array", items: s } as const
const connectorFileSchema = objectSchema({
  download_url: { type: "string", format: "uri" },
  file_id: s,
  mime_type: s,
  file_name: s
}, ["download_url", "file_id"])
const objectOutputSchema: JsonSchema = { type: "object", additionalProperties: true }
const searchKeys = ["claims", "routes", "gaps", "papers", "known_results", "research_deltas", "research_artifacts", "mechanisms", "spinout_candidates", "assumption_regimes", "theorem_contracts", "frontier_snapshots"]
const searchOutputSchema: JsonSchema = objectSchema(Object.fromEntries(searchKeys.map((key) => [key, { type: "array", items: objectOutputSchema }])), searchKeys)
const idObjectOutputSchema: JsonSchema = { type: "object", required: ["id"], properties: { id: s }, additionalProperties: true }
const listResultKeys: Record<string, string> = {
  list_workspaces: "workspaces",
  list_projects: "projects",
  list_project_goals: "goals",
  list_workstreams: "workstreams",
  list_review_rounds: "reviews",
  list_research_deltas: "deltas",
  list_research_artifacts: "artifacts",
  list_research_links: "links",
  list_mechanisms: "mechanisms",
  list_spinout_candidates: "spinouts",
  list_assumption_regimes: "assumptions",
  list_theorem_contracts: "contracts",
  list_frontier_snapshots: "snapshots",
  list_artifacts: "physical_artifacts"
}
const readOnlyToolNames = new Set(["get_my_maff_context", "list_workspaces", "get_project", "list_projects", "get_project_control_room", "compute_submission_readiness", "get_integration_coverage", "list_project_goals", "list_workstreams", "get_workstream", "get_agent_briefing", "list_review_rounds", "get_report", "get_object_graph", "search_research_objects", "list_research_deltas", "list_mechanisms", "list_spinout_candidates", "list_assumption_regimes", "list_theorem_contracts", "list_frontier_snapshots", "get_latest_frontier_snapshot", "list_research_artifacts", "get_research_artifact", "export_research_artifact_bundle", "list_research_links", "get_quartz_site_status", "get_artifact", "list_artifacts", "verify_artifact", "get_manuscript_version", "get_manuscript", "inspect_manuscript_build"])
const idempotentToolNames = new Set(["rebuild_quartz_site"])
const outputSchemaFor = (name: string): JsonSchema => {
  const listKey = listResultKeys[name]
  if (listKey) return objectSchema({ [listKey]: { type: "array", items: objectOutputSchema } }, [listKey])
  if (name === "search_research_objects") return searchOutputSchema
  if (["create_project", "create_research_delta", "create_research_artifact", "create_spinout_candidate", "create_research_link"].includes(name)) return idObjectOutputSchema
  return objectOutputSchema
}
const reviewVerdict = {
  type: "string",
  enum: [
    "approved",
    "needs_revision",
    "rejected",
    "blocked",
    "escalate",
    "approve",
    "accepted",
    "revision_required",
    "requires_revision",
    "needs_changes",
    "changes_requested",
    "reject",
    "block",
    "escalated"
  ]
} as const

type ToolDef = { name: string; description: string; scope: string; role: WorkspaceRole; inputSchema: JsonSchema; outputSchema: JsonSchema; annotations: JsonSchema; meta?: JsonSchema }
const tool = (name: string, description: string, role: WorkspaceRole, inputSchema: JsonSchema, scope: string = role === "viewer" ? scopes.maffRead : role === "admin" ? scopes.maffAdmin : scopes.maffWrite, meta?: JsonSchema): ToolDef => ({
  name,
  description,
  scope,
  role,
  inputSchema,
  outputSchema: outputSchemaFor(name),
  annotations: { readOnlyHint: readOnlyToolNames.has(name), openWorldHint: false, destructiveHint: false, idempotentHint: idempotentToolNames.has(name) },
  meta
})
export const mcpServerVersion = "1.6.4-gap-frontier-routing"
export const expectedMcpToolCount = 108

export const toolDefinitions: ToolDef[] = [
  tool("get_my_maff_context", "Recover where the user is up to. Infers the user's workspace, summarizes active projects, ready assignments, reports needing review, and suggested simple chat prompts.", "viewer", objectSchema({ workspace: s, project: s })),
  tool("claim_next_assignment", "No-id specialist entrypoint. Infers workspace and project, claims and starts the next assignment, and returns a briefing that must be executed immediately in the same turn. Claiming or announcing future work is not a deliverable.", "editor", objectSchema({ workspace: s, project: s, role: s, kind: s, session_id: s, model: s, lease_minutes: n, start_run: { type: "boolean" } })),
  tool("claim_next_review", "No-id reviewer entrypoint. Atomically claims and starts the next locked review. The returned review must be executed in the same turn; claiming it or announcing future review work is not a deliverable.", "editor", objectSchema({ workspace: s, project: s, session_id: s, model: s, lease_minutes: n })),

  tool("list_workspaces", "List workspaces visible to the authenticated user.", "viewer", objectSchema({})),
  tool("create_project", "Create a Maff research project. Projects coordinate approved goals and workstreams.", "editor", objectSchema({ workspace_id: s, title: s, area: s, statement: s, slug: s }, ["workspace_id", "title", "statement"])),
  tool("get_project", "Read a Maff project.", "viewer", objectSchema({ workspace_id: s, project_id: s }, ["workspace_id", "project_id"])),
  tool("list_projects", "List Maff projects in a workspace.", "viewer", objectSchema({ workspace_id: s }, ["workspace_id"])),
  tool("get_project_control_room", "Read the project control room: goals, workstreams, reviews, recent agent runs, key claims, gaps, and suggested next assignment.", "viewer", objectSchema({ workspace_id: s, project_id: s }, ["workspace_id", "project_id"])),
  tool("update_project_summary", "Update the Project Coordinator summary.", "editor", objectSchema({ workspace_id: s, project_id: s, coordinator_summary: s }, ["workspace_id", "project_id", "coordinator_summary"])),

  tool("propose_project_goal", "Propose an explicit project goal for user approval.", "editor", objectSchema({ workspace_id: s, project_id: s, title: s, statement: s, priority: n, success_criteria: strArray, dependencies: strArray }, ["workspace_id", "project_id", "title", "statement"])),
  tool("approve_project_goal", "Approve a proposed project goal so specialist workstreams may attach to it.", "editor", objectSchema({ workspace_id: s, goal_id: s }, ["workspace_id", "goal_id"])),
  tool("update_project_goal", "Patch a project goal.", "editor", objectSchema({ workspace_id: s, goal_id: s, patch: anyObj }, ["workspace_id", "goal_id", "patch"])),
  tool("list_project_goals", "List project goals.", "viewer", objectSchema({ workspace_id: s, project_id: s }, ["workspace_id", "project_id"])),

  tool("create_workstream", "Create a first-class role-bound workstream under an approved goal.", "editor", objectSchema({ workspace_id: s, project_id: s, goal_id: s, parent_workstream_id: s, title: s, kind: s, coordinator_role: s, priority: n, target_object_type: s, target_object_id: s, instructions: s, allowed_writes: strArray, forbidden_actions: strArray, success_criteria: strArray, review_policy: anyObj }, ["workspace_id", "project_id", "title", "kind", "instructions"])),
  tool("list_workstreams", "List workstreams.", "viewer", objectSchema({ workspace_id: s, project_id: s, status: s }, ["workspace_id"])),
  tool("get_workstream", "Read a workstream with reports, reviews, agent runs, messages, and artifacts.", "viewer", objectSchema({ workspace_id: s, workstream_id: s }, ["workspace_id", "workstream_id"])),
  tool("claim_agent_assignment", "Claim the next role-bound workstream assignment and receive a structured agent briefing.", "editor", objectSchema({ workspace_id: s, project_id: s, workstream_id: s, session_id: s, lease_minutes: n }, ["workspace_id", "session_id"])),
  tool("start_agent_run", "Start an AgentRun for a claimed workstream and return the exact briefing.", "editor", objectSchema({ workspace_id: s, workstream_id: s, session_id: s, model: s }, ["workspace_id", "workstream_id", "session_id"])),
  tool("get_agent_briefing", "Return the structured role briefing for a workstream.", "viewer", objectSchema({ workspace_id: s, workstream_id: s }, ["workspace_id", "workstream_id"])),
  tool("write_agent_observation", "Write a durable AgentMessage observation, blocker, handoff, or escalation.", "editor", objectSchema({ workspace_id: s, project_id: s, workstream_id: s, from_role: s, to_role: s, kind: s, body: s, artifact_refs: strArray }, ["workspace_id", "project_id", "from_role", "body"])),
  tool("mark_workstream_blocked", "Mark a workstream blocked with a durable blocker message.", "editor", objectSchema({ workspace_id: s, workstream_id: s, message: s }, ["workspace_id", "workstream_id", "message"])),
  tool("escalate_workstream", "Escalate a workstream to the Project Coordinator.", "editor", objectSchema({ workspace_id: s, workstream_id: s, message: s }, ["workspace_id", "workstream_id", "message"])),
  tool("request_workstream_revision", "Move a reviewed workstream to revision_required.", "editor", objectSchema({ workspace_id: s, workstream_id: s, message: s }, ["workspace_id", "workstream_id", "message"])),
  tool("approve_workstream", "Approve a workstream only after an approved ReviewRound exists.", "editor", objectSchema({ workspace_id: s, workstream_id: s }, ["workspace_id", "workstream_id"])),
  tool("complete_workstream", "Complete a workstream only after its review policy is satisfied.", "editor", objectSchema({ workspace_id: s, workstream_id: s }, ["workspace_id", "workstream_id"])),

  tool("create_or_update_workstream_report", "Create or update the primary report for a workstream.", "editor", objectSchema({ workspace_id: s, workstream_id: s, title: s, body_markdown: s, uncertainty_notes: strArray, linked_object_refs: strArray, artifact_refs: strArray }, ["workspace_id", "workstream_id", "title", "body_markdown"])),
  tool("submit_workstream_report", "Create/update a WorkstreamReport and submit it for mandatory review.", "editor", objectSchema({ workspace_id: s, workstream_id: s, title: s, body_markdown: s, uncertainty_notes: strArray, linked_object_refs: strArray, artifact_refs: strArray }, ["workspace_id", "workstream_id", "title", "body_markdown"])),
  tool("submit_report_for_review", "Submit an existing report for review. Pass report_id or workstream_id.", "editor", objectSchema({ workspace_id: s, report_id: s, workstream_id: s }, ["workspace_id"])),
  tool("record_review_round", "Record an internal assigned or externally sourced legacy/general review. Internal HostileReviewer runs require the review_assignment_id, submission_token, and created_by_agent_run_id returned by claim_next_review. Manuscript gates additionally require their substantive evidence contract. Independence is computed by Maff, never caller-selected.", "editor", objectSchema({ workspace_id: s, workstream_id: s, report_id: s, target_object_type: s, target_object_id: s, reviewer_role: s, verdict: reviewVerdict, review_type: s, target_version: s, scope: anyObj, inspected_artifact_ids: strArray, checked_obligation_ids: strArray, parent_math_reopenable: { type: "boolean" }, prior_approvals_evidence_only: { type: "boolean" }, obligation_checks: { type: "array", items: anyObj }, evidence_sections: { type: "array", items: anyObj }, issues: strArray, required_changes: strArray, checked_refs: strArray, body_markdown: s, created_by_agent_run_id: s, review_assignment_id: s, submission_token: s }, ["workspace_id", "workstream_id", "verdict", "body_markdown"]), scopes.maffReview),
  tool("record_object_contribution", "Append provenance showing that an AgentRun created, authored, edited, integrated, repaired, computed, compiled, read, reviewed, or triaged an exact object.", "editor", objectSchema({ workspace_id: s, project_id: s, agent_run_id: s, object_type: s, object_id: s, version_hash: s, contribution_type: s, metadata: anyObj }, ["workspace_id", "project_id", "agent_run_id", "object_type", "object_id", "contribution_type"])),
  tool("record_object_access", "Record verified evidence that a run actually opened or checked an exact object or Artifact. Required by locked manuscript reviews.", "editor", objectSchema({ workspace_id: s, project_id: s, agent_run_id: s, object_type: s, object_id: s, artifact_id: s, operation: s, content_hash: s, coverage: anyObj }, ["workspace_id", "project_id", "agent_run_id", "object_type", "object_id", "operation"])),
  tool("submit_run_outcome", "Complete an AgentRun with a durable state-owned handoff. Return only whether the user can say continue here or must start one fresh chat with the generic project-level instruction.", "editor", objectSchema({ workspace_id: s, agent_run_id: s, completed_work: strArray, changed_objects: strArray, evidence_generated: strArray, checks_performed: strArray, problems_encountered: strArray, unresolved_uncertainty: strArray, gaps_created: strArray, gaps_resolved: strArray, next_action: anyObj }, ["workspace_id", "agent_run_id", "completed_work", "changed_objects", "evidence_generated", "checks_performed", "problems_encountered", "unresolved_uncertainty", "gaps_created", "gaps_resolved", "next_action"])),
  tool("ensure_project_actionable", "Enforce that an active project has runnable work, pending review, an explicit waiting state, or a terminal justification; creates only an evidence-linked reconciliation task when necessary.", "editor", objectSchema({ workspace_id: s, project_id: s, create_if_missing: { type: "boolean" } }, ["workspace_id", "project_id"])),
  tool("list_review_rounds", "List ReviewRound records for a workstream.", "viewer", objectSchema({ workspace_id: s, workstream_id: s }, ["workspace_id", "workstream_id"])),
  tool("get_report", "Read a WorkstreamReport with review history.", "viewer", objectSchema({ workspace_id: s, report_id: s }, ["workspace_id", "report_id"])),

  tool("create_math_object", "Create a typed mathematical object: definition, object, construction, or notation.", "editor", objectSchema({ workspace_id: s, project_id: s, type: s, title: s, statement_markdown: s, status: s, metadata: anyObj }, ["workspace_id", "project_id", "type", "title", "statement_markdown"])),
  tool("create_claim", "Create a typed Claim object in a project.", "editor", objectSchema({ workspace_id: s, project_id: s, title: s, statement: s, statement_markdown: s, kind: s, claim_kind: s, status: s, actor_role: s, metadata: anyObj, confidence: n }, ["workspace_id", "project_id", "title"])),
  tool("update_claim_status", "Update a typed Claim status, enforcing role restrictions such as ProofAttemptAgent cannot mark claims proved.", "editor", objectSchema({ workspace_id: s, claim_id: s, status: s, actor_role: s, reason: s }, ["workspace_id", "claim_id", "status"])),
  tool("create_proof_route", "Create a typed ProofRoute for a Claim.", "editor", objectSchema({ workspace_id: s, project_id: s, claim_id: s, title: s, strategy_markdown: s, required_lemmas: strArray, first_testable_step: s, kill_condition: s, status: s, created_by_workstream_id: s, workstream_id: s }, ["workspace_id", "project_id", "claim_id", "kill_condition"])),
  tool("create_proof_attempt", "Create a typed ProofAttempt object. Failed attempts are durable first-class records.", "editor", objectSchema({ workspace_id: s, project_id: s, claim_id: s, route_id: s, workstream_id: s, body_markdown: s, status: s, gap_summary: s }, ["workspace_id", "project_id", "claim_id", "body_markdown"])),
  tool("create_gap", "Create a typed Gap targeted to a claim, exact manuscript, proof obligation, artifact, external review, or audit finding. Set resolution_kind and resolution_role for an executable specialist handoff. Set frontier_eligible=false to preserve a paused, bypassed, or spinout-only gap without dispatching it on this project's mainline.", "editor", objectSchema({ workspace_id: s, project_id: s, claim_id: s, proof_attempt_id: s, route_id: s, title: s, description_markdown: s, severity: s, status: s, suggested_resolution: s, resolution_kind: s, resolution_role: s, frontier_eligible: { type: "boolean" }, target_object_type: s, target_object_id: s, external_review_id: s, audit_finding_id: s }, ["workspace_id", "project_id", "severity"])),
  tool("resolve_gap", "Resolve a typed Gap object.", "editor", objectSchema({ workspace_id: s, gap_id: s, suggested_resolution: s }, ["workspace_id", "gap_id"])),
  tool("create_counterexample", "Create a typed Counterexample object.", "editor", objectSchema({ workspace_id: s, project_id: s, claim_id: s, title: s, construction_markdown: s, status: s, verification_artifact_id: s }, ["workspace_id", "project_id", "claim_id", "title", "construction_markdown"])),
  tool("create_experiment", "Create a typed Experiment object.", "editor", objectSchema({ workspace_id: s, project_id: s, workstream_id: s, title: s, hypothesis_markdown: s, method_markdown: s, result_markdown: s, reproducibility: anyObj, status: s }, ["workspace_id", "project_id", "title", "hypothesis_markdown", "method_markdown"])),
  tool("create_paper", "Create a Paper literature object.", "editor", objectSchema({ workspace_id: s, project_id: s, title: s, authors: strArray, year: n, venue: s, url: s, arxiv_id: s, doi: s, notes_markdown: s }, ["workspace_id", "title"])),
  tool("create_known_result", "Create a KnownResult linked to a paper or project.", "editor", objectSchema({ workspace_id: s, project_id: s, paper_id: s, title: s, statement_markdown: s, applicability_markdown: s, status: s }, ["workspace_id", "title", "statement_markdown", "applicability_markdown"])),
  tool("create_assumption", "Create a typed Assumption object.", "editor", objectSchema({ workspace_id: s, project_id: s, statement_markdown: s, status: s, reason: s, owner: s, discharge_plan: s }, ["workspace_id", "project_id", "statement_markdown", "status", "reason"])),
  tool("create_formalization_target", "Create a typed FormalizationTarget.", "editor", objectSchema({ workspace_id: s, project_id: s, claim_id: s, proof_attempt_id: s, statement_markdown: s, feasibility: s, required_definitions: strArray, theorem_stub: s, status: s }, ["workspace_id", "project_id"])),
  tool("create_lean_theorem", "Create a typed LeanTheorem object.", "editor", objectSchema({ workspace_id: s, project_id: s, formalization_target_id: s, lean_name: s, proof_file: s, statement_markdown: s, status: s, has_sorry: { type: "boolean" }, has_axiom: { type: "boolean" } }, ["workspace_id", "project_id", "lean_name", "proof_file", "statement_markdown"])),
  tool("link_objects", "Create a typed GraphEdge between mathematical or coordination objects.", "editor", objectSchema({ workspace_id: s, project_id: s, source_type: s, source_id: s, target_type: s, target_id: s, edge_type: s, metadata: anyObj }, ["workspace_id", "source_type", "source_id", "target_type", "target_id", "edge_type"])),
  tool("get_object_graph", "Read the typed mathematical object graph.", "viewer", objectSchema({ workspace_id: s, project_id: s, source_type: s, source_id: s }, ["workspace_id"])),
  tool("search_research_objects", "Search typed Maff research objects.", "viewer", objectSchema({ workspace_id: s, project_id: s, query: s, type: s }, ["workspace_id"])),
  tool("create_artifact", "Upload a connector file into immutable Maff storage, or register an external durable URI. For ChatGPT-generated /mnt/data outputs, pass the file parameter; Maff downloads the bytes, recomputes SHA-256, compares expected_sha256 when supplied, and returns a durable Artifact ID.", "editor", objectSchema({ workspace_id: s, project_id: s, workstream_id: s, research_artifact_id: s, kind: s, title: s, uri: s, file: connectorFileSchema, expected_sha256: s, mime_type: s, metadata: anyObj, created_by_agent_run_id: s }, ["workspace_id", "project_id", "title"]), undefined, { "openai/fileParams": ["file"] }),
  tool("get_artifact", "Fetch immutable physical Artifact metadata and direct ResearchArtifact/ManuscriptVersion links.", "viewer", objectSchema({ workspace_id: s, artifact_id: s }, ["workspace_id", "artifact_id"])),
  tool("list_artifacts", "List physical Artifacts by project, workstream, ResearchArtifact, or ManuscriptVersion.", "viewer", objectSchema({ workspace_id: s, project_id: s, workstream_id: s, research_artifact_id: s, manuscript_version_id: s }, ["workspace_id"])),
  tool("verify_artifact", "Recompute stored Artifact SHA-256 and byte size, failing explicitly for missing or corrupt managed data.", "viewer", objectSchema({ workspace_id: s, artifact_id: s }, ["workspace_id", "artifact_id"])),
  tool("get_manuscript_version", "Read an exact ManuscriptVersion with its directly linked immutable physical Artifacts and proof obligations.", "viewer", objectSchema({ workspace_id: s, manuscript_version_id: s }, ["workspace_id", "manuscript_version_id"])),

  tool("create_research_delta", "Capture a compact research delta: what changed, portable value, blockers, and next move. Low-friction by design.", "editor", objectSchema({ workspace_id: s, project_id: s, source_type: s, source_id: s, title: s, summary_markdown: s, what_changed_markdown: s, mainline_effect_markdown: s, reusable_ideas_markdown: s, blockers_markdown: s, next_move_markdown: s, confidence: s }, ["workspace_id", "title"])),
  tool("list_research_deltas", "List compact research deltas by workspace/project/source.", "viewer", objectSchema({ workspace_id: s, project_id: s, source_type: s, source_id: s, limit: n }, ["workspace_id"])),
  tool("create_mechanism", "Capture a reusable mathematical mechanism seed without requiring a full theorem workflow.", "editor", objectSchema({ workspace_id: s, project_id: s, title: s, slug: s, status: s, maturity: s, description_markdown: s, core_idea_markdown: s, where_it_worked_markdown: s, where_it_failed_markdown: s, possible_transfers_markdown: s, kill_conditions_markdown: s, centrality_score: n, portability_score: n, tractability_score: n, novelty_score: n, load_bearing_score: n }, ["workspace_id", "title"])),
  tool("list_mechanisms", "List reusable mechanisms by workspace/project/status.", "viewer", objectSchema({ workspace_id: s, project_id: s, status: s, maturity: s, limit: n }, ["workspace_id"])),
  tool("update_mechanism", "Patch a reusable mechanism.", "editor", objectSchema({ workspace_id: s, mechanism_id: s, patch: anyObj }, ["workspace_id", "mechanism_id", "patch"])),
  tool("create_spinout_candidate", "Capture a possible theorem or project discovered from the current research.", "editor", objectSchema({ workspace_id: s, project_id: s, origin_project_id: s, title: s, slug: s, status: s, statement_sketch_markdown: s, why_interesting_markdown: s, relation_to_origin_markdown: s, cheapest_next_test_markdown: s, possible_payoff_markdown: s, risk_markdown: s }, ["workspace_id", "title"])),
  tool("list_spinout_candidates", "List spinout theorem/project candidates.", "viewer", objectSchema({ workspace_id: s, project_id: s, status: s, limit: n }, ["workspace_id"])),
  tool("promote_spinout_candidate", "Promote a SpinoutCandidate into a Project while preserving a link back to the spinout.", "editor", objectSchema({ workspace_id: s, spinout_id: s }, ["workspace_id", "spinout_id"])),
  tool("create_assumption_regime", "Capture a theorem assumption regime or variant.", "editor", objectSchema({ workspace_id: s, project_id: s, title: s, slug: s, status: s, description_markdown: s, formal_statement_markdown: s, includes_markdown: s, excludes_markdown: s, motivation_markdown: s }, ["workspace_id", "title"])),
  tool("list_assumption_regimes", "List assumption regimes by workspace/project/status.", "viewer", objectSchema({ workspace_id: s, project_id: s, status: s, limit: n }, ["workspace_id"])),
  tool("create_theorem_contract", "Capture the current theorem target without making it a hard workflow gate.", "editor", objectSchema({ workspace_id: s, project_id: s, title: s, slug: s, status: s, theorem_statement_markdown: s, assumptions_markdown: s, conclusion_markdown: s, known_dependencies_markdown: s, known_blockers_markdown: s, proof_strategy_markdown: s, current_best_version_markdown: s, confidence: s }, ["workspace_id", "project_id", "title"])),
  tool("list_theorem_contracts", "List theorem contracts by workspace/project/status.", "viewer", objectSchema({ workspace_id: s, project_id: s, status: s, limit: n }, ["workspace_id"])),
  tool("create_frontier_snapshot", "Append a compressed frontier snapshot for a project or workspace.", "editor", objectSchema({ workspace_id: s, project_id: s, title: s, snapshot_markdown: s, strongest_current_theorem_markdown: s, strongest_conditional_theorem_markdown: s, active_blockers_markdown: s, active_mechanisms_markdown: s, spinouts_markdown: s, dead_or_paused_branches_markdown: s, recommended_next_moves_markdown: s, source: s }, ["workspace_id", "title"])),
  tool("list_frontier_snapshots", "List compressed frontier snapshots.", "viewer", objectSchema({ workspace_id: s, project_id: s, source: s, limit: n }, ["workspace_id"])),
  tool("get_latest_frontier_snapshot", "Read the latest compressed frontier snapshot.", "viewer", objectSchema({ workspace_id: s, project_id: s }, ["workspace_id"])),
  tool("create_research_artifact", "Register a durable research output such as a proof skeleton, memo, theorem map, or migration report.", "editor", objectSchema({ workspace_id: s, project_id: s, title: s, slug: s, kind: s, status: s, description_markdown: s, content_markdown: s, file_path: s, url: s }, ["workspace_id", "title"])),
  tool("get_manuscript", "Read the complete current structured manuscript, section revisions, obligation drafts, and citation-key map without surfacing a file.", "viewer", objectSchema({ workspace_id: s, project_id: s }, ["workspace_id", "project_id"])),
  tool("update_manuscript", "Replace the current structured manuscript with immutable section revisions and explicit proof-obligation drafts. This edits Maff content, not TeX/PDF files.", "editor", objectSchema({ workspace_id: s, project_id: s, agent_run_id: s, metadata: anyObj, sections: { type: "array", items: anyObj }, obligation_drafts: { type: "array", items: anyObj } }, ["workspace_id", "project_id", "agent_run_id", "sections"])),
  tool("build_manuscript", "Deterministically materialize the structured manuscript into internal TeX, bibliography, source bundle, and PDF; attach them automatically and surface nothing.", "editor", objectSchema({ workspace_id: s, project_id: s, agent_run_id: s, promote: { type: "boolean" } }, ["workspace_id", "project_id", "agent_run_id"])),
  tool("revise_manuscript_source", "Create an exact source-preserving child manuscript from an existing PaperBuild using bounded expected-text replacements, recompile it internally, clone its proof ledger, and surface nothing. Editorial-only carry-forward is permitted only for a server-verified LaTeX date-command delta authorized by an assigned editorial ReviewRound.", "editor", objectSchema({ workspace_id: s, project_id: s, agent_run_id: s, parent_build_id: s, source_review_round_id: s, revision_class: s, replacements: { type: "array", items: anyObj } }, ["workspace_id", "project_id", "agent_run_id", "parent_build_id", "source_review_round_id", "revision_class", "replacements"])),
  tool("inspect_manuscript_build", "Inspect the complete normalized manuscript, generated TeX, bibliography, manifest, and build log as text without surfacing source or PDF files.", "viewer", objectSchema({ workspace_id: s, build_id: s }, ["workspace_id", "build_id"])),
  tool("publish_manuscript", "Release the latest successful exact PaperBuild after publication readiness and surface only its final PDF.", "editor", objectSchema({ workspace_id: s, project_id: s, manuscript_version_id: s }, ["workspace_id", "project_id"]), scopes.maffReview),
  tool("create_proof_obligation", "Record an atomic exact-version proof obligation including assumptions, excluded regimes, boundary cases, semantic consequences, dependency/source ledger, and the author's non-verifying assertion. Mark load_bearing only during final manuscript assembly; it does not create a separate review task.", "editor", objectSchema({ workspace_id: s, project_id: s, manuscript_version_id: s, title: s, statement_markdown: s, dependencies: { type: "array", items: anyObj }, claim_id: s, source_artifact_id: s, proof_location: s, manuscript_location: s, external_theorems: { type: "array", items: anyObj }, external_assumptions_matched: { type: "boolean" }, exact_manuscript_proof_present: { type: "boolean" }, assumptions: strArray, excluded_regimes: strArray, boundary_cases: strArray, semantic_consequences: strArray, author_assertion: s, required: { type: "boolean" }, load_bearing: { type: "boolean" } }, ["workspace_id", "project_id", "manuscript_version_id", "title", "statement_markdown", "assumptions", "boundary_cases"])),
  tool("promote_manuscript_to_submission_candidate", "Promote an existing canonical exact ManuscriptVersion to submission_candidate without rebuilding or rewriting it. Uses supplied bounded load_bearing_obligation_ids, or infers them from an approved exact-version journal-verifiable proof-integration review. Retires stale predecessor-targeted review/submission workstreams and returns the resulting readiness gate plan.", "editor", objectSchema({ workspace_id: s, manuscript_version_id: s, load_bearing_obligation_ids: strArray }, ["workspace_id", "manuscript_version_id"]), scopes.maffReview),
  tool("import_external_review", "Immutable import of an externally performed review; it is not represented as a Maff AgentRun.", "editor", objectSchema({ workspace_id: s, project_id: s, manuscript_version_id: s, theorem_or_artifact_ref: s, original_review_text: s, original_review_uri: s, provenance: s, reviewer_identity: s, independence_statement: s, review_scope: s, verdict: reviewVerdict, issues: strArray, required_changes: strArray }, ["workspace_id", "project_id", "theorem_or_artifact_ref", "original_review_text", "provenance", "independence_statement", "review_scope", "verdict"]), scopes.maffReview),
  tool("triage_external_review", "In a fresh non-author context, disposition every finding in an imported negative review, create targeted blocking gaps, and clear only the untriaged-challenge state.", "editor", objectSchema({ workspace_id: s, project_id: s, external_review_id: s, agent_run_id: s, dispositions: { type: "array", items: anyObj } }, ["workspace_id", "project_id", "external_review_id", "agent_run_id", "dispositions"]), scopes.maffReview),
  tool("create_strategic_review", "Record an attributable fresh-context strategic assessment with required frontier, blocker, branch, next-move, and probability fields. Independence is verified from AgentRun provenance.", "editor", objectSchema({ workspace_id: s, project_id: s, verdict: s, reviewer_independence: s, what_changed_markdown: s, loop_diagnosis_markdown: s, blocker_structure_markdown: s, alternatives_markdown: s, branch_allocation: { type: "array", items: anyObj }, next_moves: { type: "array", items: anyObj }, probability_estimates: { type: "array", items: anyObj }, metrics: anyObj, created_by_agent_run_id: s }, ["workspace_id", "project_id", "verdict", "what_changed_markdown", "loop_diagnosis_markdown", "blocker_structure_markdown", "alternatives_markdown", "created_by_agent_run_id"]), scopes.maffReview),
  tool("get_project_health", "Read strategic-review epoch, warning metrics, branches, and circuit-breaker state.", "viewer", objectSchema({ workspace_id: s, project_id: s }, ["workspace_id", "project_id"])),
  tool("create_project_branch", "Create an explicit mainline/exploratory/paused/killed/spinout branch state.", "editor", objectSchema({ workspace_id: s, project_id: s, title: s, state: s, rationale_markdown: s, target_object_type: s, target_object_id: s }, ["workspace_id", "project_id", "title"])),
  tool("get_integration_coverage", "Return source-to-manuscript proof-obligation coverage for one manuscript version.", "viewer", objectSchema({ workspace_id: s, manuscript_version_id: s }, ["workspace_id", "manuscript_version_id"])),
  tool("compute_submission_readiness", "Return the single release-candidate gate plan: accepted and rejected evidence with exact reasons, fingerprint-safe novelty/bibliography reuse, obligation coverage, the one next action, and an anti-loop circuit breaker.", "viewer", objectSchema({ workspace_id: s, project_id: s }, ["workspace_id", "project_id"])),
  tool("list_research_artifacts", "List durable research artifacts.", "viewer", objectSchema({ workspace_id: s, project_id: s, kind: s, status: s, limit: n }, ["workspace_id"])),
  tool("get_research_artifact", "Read the complete stored body and metadata for one research artifact.", "viewer", objectSchema({ workspace_id: s, artifact_id: s }, ["workspace_id", "artifact_id"])),
  tool("export_research_artifact_bundle", "Export a deterministic, complete bundle of requested research artifacts. Fails if any requested artifact is unavailable.", "viewer", objectSchema({ workspace_id: s, artifact_ids: strArray }, ["workspace_id", "artifact_ids"])),
  tool("create_research_link", "Create a generic research relation between any two frontier or legacy objects.", "editor", objectSchema({ workspace_id: s, project_id: s, source_type: s, source_id: s, relation_type: s, target_type: s, target_id: s, note_markdown: s, confidence: s }, ["workspace_id", "source_type", "source_id", "relation_type", "target_type", "target_id"])),
  tool("list_research_links", "List generic research links by source, target, project, or workspace.", "viewer", objectSchema({ workspace_id: s, project_id: s, source_type: s, source_id: s, target_type: s, target_id: s, limit: n }, ["workspace_id"])),
  tool("run_legacy_distillation_preview", "Preview non-destructive legacy distillation into frontier objects. Writes an artifact file, not DB rows.", "editor", objectSchema({ workspace_id: s, output_path: s }, ["workspace_id"])),
  tool("run_legacy_distillation_apply", "Apply the idempotent legacy distillation seed layer into the database.", "editor", objectSchema({ workspace_id: s }, ["workspace_id"])),

  tool("begin_project_import", "Begin a staged immutable import for an existing non-Maff paper or research project.", "editor", objectSchema({ workspace_id: s, project_id: s, title: s, provenance: anyObj }, ["workspace_id", "title", "provenance"])),
  tool("analyze_project_import", "Store the previewed extraction map for a staged import without promoting assertions to verified state.", "editor", objectSchema({ workspace_id: s, import_id: s, artifact_ids: strArray, proposed_map: anyObj }, ["workspace_id", "import_id", "proposed_map"])),
  tool("preview_project_import", "Read the staged import map before transactional commit.", "viewer", objectSchema({ workspace_id: s, import_id: s }, ["workspace_id", "import_id"])),
  tool("commit_project_import", "Commit an analyzed import as imported_unverified and seed a fresh baseline-audit assignment.", "editor", objectSchema({ workspace_id: s, import_id: s, user_corrections: anyObj }, ["workspace_id", "import_id"])),
  tool("run_project_graph_audit", "Run an append-only invariant, release, migration, or forensic graph audit. It records an immutable report and makes no project mutations.", "editor", objectSchema({ workspace_id: s, project_id: s, mode: s, auditor_run_id: s }, ["workspace_id", "project_id", "mode"]), scopes.maffReview),
  tool("begin_repair_from_audit", "In a fresh repair chat, accept the latest audit's major findings, materialize linked gaps, and create the ordered repair campaign.", "editor", objectSchema({ workspace_id: s, project_id: s, audit_id: s }, ["workspace_id", "project_id"])),

  tool("create_lean_project", "Create a Lean project.", "editor", objectSchema({ workspace_id: s, project_name: s }, ["workspace_id", "project_name"])),
  tool("create_lean_stub", "Create a Lean theorem file and LeanTheorem record.", "editor", objectSchema({ workspace_id: s, formalization_target_id: s, theorem_statement: s, imports: strArray }, ["workspace_id", "formalization_target_id", "theorem_statement"])),
  tool("lean_check", "Run the Lean worker check for a typed LeanTheorem.", "editor", objectSchema({ workspace_id: s, lean_theorem_id: s }, ["workspace_id", "lean_theorem_id"])),
  tool("lean_goal", "Read a Lean goal if supported.", "editor", objectSchema({ workspace_id: s, lean_file_id: s, position: anyObj }, ["workspace_id", "lean_file_id", "position"])),
  tool("mark_lean_verified", "Conservatively mark a typed LeanTheorem verified only if latest check succeeds and no sorry/axiom/unproved assumptions remain.", "editor", objectSchema({ workspace_id: s, lean_theorem_id: s }, ["workspace_id", "lean_theorem_id"])),

  tool("rebuild_quartz_site", "Build a workspace Quartz site from current rendered research artifacts.", "editor", objectSchema({ workspace_id: s }, ["workspace_id"])),
  tool("get_quartz_site_status", "Read latest Quartz build status.", "viewer", objectSchema({ workspace_id: s }, ["workspace_id"]))
]

const toolByName = new Map(toolDefinitions.map((definition) => [definition.name, definition]))

function wwwAuthenticate(required: string) {
  const quoted = (value: string) => value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/[\u0000-\u001F\u007F]/g, " ")
  return `Bearer resource_metadata="${quoted(config.publicBaseUrl)}/.well-known/oauth-protected-resource", error="insufficient_scope", error_description="Missing required scope ${quoted(required)}", scope="${quoted(required)}"`
}

function insufficientScopeError(required: string, _ctx: ToolContext, toolName: string) {
  console.warn("MCP missing scope", { required, tool: toolName })
  return Object.assign(new Error(`Missing required scope ${required}`), { status: 403, required, wwwAuthenticate: wwwAuthenticate(required) })
}

async function authorize(ctx: ToolContext, toolName: string, workspaceId?: string) {
  const definition = toolByName.get(toolName)
  if (!definition) throw new Error(`Unknown tool: ${toolName}`)
  if (!hasBearerAuthorization({ scopeText: ctx.claimsScope, resourceAccess: ctx.resourceAccess, roleClientId: config.oidc.roleClientId, required: definition.scope })) {
    throw insufficientScopeError(definition.scope, ctx, toolName)
  }
  if (workspaceId) await requireWorkspaceRole(ctx.userId, workspaceId, definition.role)
}

function workspaceIdFrom(args: any) {
  return args?.workspace_id ?? args?.workspaceId
}

export async function callTool(toolName: string, args: any, ctx: ToolContext) {
  await authorize(ctx, toolName, workspaceIdFrom(args))
  const workspaceId = workspaceIdFrom(args)
  const userId = ctx.userId
  switch (toolName) {
    case "get_my_maff_context": return runtime.getMyMaffContext({ userId, workspaceRef: args.workspace, project: args.project })
    case "claim_next_assignment": return runtime.claimNextAssignment({ userId, workspaceRef: args.workspace, project: args.project, role: args.role, kind: args.kind, sessionId: args.session_id, model: args.model, leaseMinutes: args.lease_minutes, startRun: args.start_run })
    case "claim_next_review": return runtime.claimNextReview({ userId, workspaceRef: args.workspace, project: args.project, sessionId: args.session_id, model: args.model, leaseMinutes: args.lease_minutes, startRun: args.start_run })
    case "list_workspaces": return runtime.listWorkspacesForUser(userId)
    case "create_project": return runtime.createProject({ workspaceId, slug: args.slug, title: args.title, area: args.area, statement: args.statement, userId })
    case "get_project": return runtime.getProject(workspaceId, args.project_id)
    case "list_projects": return runtime.listProjects(workspaceId)
    case "get_project_control_room": return runtime.getProjectControlRoom(workspaceId, args.project_id)
    case "update_project_summary": return runtime.updateProjectSummary({ workspaceId, projectId: args.project_id, coordinatorSummary: args.coordinator_summary })
    case "propose_project_goal": return runtime.proposeProjectGoal({ workspaceId, projectId: args.project_id, title: args.title, statement: args.statement, priority: args.priority, successCriteria: args.success_criteria, dependencies: args.dependencies })
    case "approve_project_goal": return runtime.approveProjectGoal({ workspaceId, goalId: args.goal_id, userId })
    case "update_project_goal": return runtime.updateProjectGoal({ workspaceId, goalId: args.goal_id, patch: args.patch })
    case "list_project_goals": return runtime.listProjectGoals(workspaceId, args.project_id)
    case "create_workstream": return runtime.createWorkstream({ workspaceId, projectId: args.project_id, goalId: args.goal_id, parentWorkstreamId: args.parent_workstream_id, title: args.title, kind: args.kind, coordinatorRole: args.coordinator_role, priority: args.priority, targetObjectType: args.target_object_type, targetObjectId: args.target_object_id, instructions: args.instructions, allowedWrites: args.allowed_writes, forbiddenActions: args.forbidden_actions, successCriteria: args.success_criteria, reviewPolicy: args.review_policy })
    case "list_workstreams": return runtime.listWorkstreams({ workspaceId, projectId: args.project_id, status: args.status })
    case "get_workstream": return runtime.getWorkstream(workspaceId, args.workstream_id)
    case "claim_agent_assignment": return runtime.claimAgentAssignment({ workspaceId, projectId: args.project_id, workstreamId: args.workstream_id, sessionId: args.session_id, userId, leaseMinutes: args.lease_minutes })
    case "start_agent_run": return runtime.startAgentRun({ workspaceId, workstreamId: args.workstream_id, sessionId: args.session_id, model: args.model })
    case "get_agent_briefing": return runtime.getAgentBriefing(workspaceId, args.workstream_id)
    case "write_agent_observation": return runtime.writeAgentObservation({ workspaceId, projectId: args.project_id, workstreamId: args.workstream_id, fromRole: args.from_role, toRole: args.to_role, kind: args.kind, body: args.body, artifactRefs: args.artifact_refs })
    case "create_or_update_workstream_report": return runtime.createOrUpdateWorkstreamReport({ workspaceId, workstreamId: args.workstream_id, title: args.title, bodyMarkdown: args.body_markdown, uncertaintyNotes: args.uncertainty_notes, linkedObjectRefs: args.linked_object_refs, artifactRefs: args.artifact_refs })
    case "submit_workstream_report": return runtime.submitWorkstreamReport({ workspaceId, workstreamId: args.workstream_id, title: args.title, bodyMarkdown: args.body_markdown, uncertaintyNotes: args.uncertainty_notes, linkedObjectRefs: args.linked_object_refs, artifactRefs: args.artifact_refs })
    case "mark_workstream_blocked": return runtime.markWorkstreamBlocked({ workspaceId, workstreamId: args.workstream_id, message: args.message })
    case "escalate_workstream": return runtime.escalateWorkstream({ workspaceId, workstreamId: args.workstream_id, message: args.message })
    case "request_workstream_revision": return runtime.requestWorkstreamRevision({ workspaceId, workstreamId: args.workstream_id, message: args.message })
    case "approve_workstream": return runtime.approveWorkstream({ workspaceId, workstreamId: args.workstream_id })
    case "complete_workstream": return runtime.completeWorkstream({ workspaceId, workstreamId: args.workstream_id })
    case "submit_report_for_review": return runtime.submitReportForReview({ workspaceId, reportId: args.report_id, workstreamId: args.workstream_id })
    case "record_review_round": return runtime.recordReviewRound({ workspaceId, workstreamId: args.workstream_id, reportId: args.report_id, targetObjectType: args.target_object_type, targetObjectId: args.target_object_id, reviewerRole: args.reviewer_role, verdict: args.verdict, reviewType: args.review_type, targetVersion: args.target_version, scope: args.scope, inspectedArtifactIds: args.inspected_artifact_ids, checkedObligationIds: args.checked_obligation_ids, parentMathReopenable: args.parent_math_reopenable, priorApprovalsEvidenceOnly: args.prior_approvals_evidence_only, obligationChecks: args.obligation_checks, evidenceSections: args.evidence_sections, issues: args.issues, requiredChanges: args.required_changes, checkedRefs: args.checked_refs, bodyMarkdown: args.body_markdown, createdByAgentRunId: args.created_by_agent_run_id, reviewAssignmentId: args.review_assignment_id, submissionToken: args.submission_token })
    case "record_object_contribution": return runtime.recordObjectContribution({ workspaceId, projectId: args.project_id, agentRunId: args.agent_run_id, objectType: args.object_type, objectId: args.object_id, versionHash: args.version_hash, type: args.contribution_type, metadata: args.metadata })
    case "record_object_access": return runtime.recordObjectAccess({ workspaceId, projectId: args.project_id, agentRunId: args.agent_run_id, objectType: args.object_type, objectId: args.object_id, artifactId: args.artifact_id, operation: args.operation, contentHash: args.content_hash, coverage: args.coverage })
    case "submit_run_outcome": return runtime.submitRunOutcome({ workspaceId, agentRunId: args.agent_run_id, completedWork: args.completed_work, changedObjects: args.changed_objects, evidenceGenerated: args.evidence_generated, checksPerformed: args.checks_performed, problemsEncountered: args.problems_encountered, unresolvedUncertainty: args.unresolved_uncertainty, gapsCreated: args.gaps_created, gapsResolved: args.gaps_resolved, nextAction: args.next_action })
    case "ensure_project_actionable": return runtime.ensureProjectActionable(workspaceId, args.project_id, args.create_if_missing !== false)
    case "list_review_rounds": return runtime.listReviewRounds(workspaceId, args.workstream_id)
    case "get_report": return runtime.getReport(workspaceId, args.report_id)
    case "create_math_object": return runtime.createMathObject({ workspaceId, projectId: args.project_id, type: args.type, title: args.title, statementMarkdown: args.statement_markdown, status: args.status, metadata: args.metadata })
    case "create_claim": return runtime.createClaim({ workspaceId, projectId: args.project_id, title: args.title, statementMarkdown: args.statement_markdown ?? args.statement, kind: args.claim_kind ?? args.kind, status: args.status, confidence: args.confidence, metadata: args.metadata, actorRole: args.actor_role })
    case "update_claim_status": return runtime.updateClaimStatus({ workspaceId, claimId: args.claim_id, status: args.status, actorRole: args.actor_role, reason: args.reason })
    case "create_proof_route": return runtime.createProofRoute({ workspaceId, projectId: args.project_id, claimId: args.claim_id, title: args.title, strategyMarkdown: args.strategy_markdown, requiredLemmas: args.required_lemmas, firstTestableStep: args.first_testable_step, killCondition: args.kill_condition, status: args.status, createdByWorkstreamId: args.created_by_workstream_id ?? args.workstream_id })
    case "create_proof_attempt": return runtime.createProofAttempt({ workspaceId, projectId: args.project_id, claimId: args.claim_id, routeId: args.route_id, workstreamId: args.workstream_id, bodyMarkdown: args.body_markdown, status: args.status, gapSummary: args.gap_summary })
    case "create_gap": return runtime.createGap({ workspaceId, projectId: args.project_id, claimId: args.claim_id, proofAttemptId: args.proof_attempt_id, routeId: args.route_id, title: args.title, descriptionMarkdown: args.description_markdown, severity: args.severity, status: args.status, suggestedResolution: args.suggested_resolution, resolutionKind: args.resolution_kind, resolutionRole: args.resolution_role, frontierEligible: args.frontier_eligible, targetObjectType: args.target_object_type, targetObjectId: args.target_object_id, externalReviewId: args.external_review_id, auditFindingId: args.audit_finding_id })
    case "resolve_gap": return runtime.resolveGap({ workspaceId, gapId: args.gap_id, suggestedResolution: args.suggested_resolution })
    case "create_counterexample": return runtime.createCounterexample({ workspaceId, projectId: args.project_id, claimId: args.claim_id, title: args.title, constructionMarkdown: args.construction_markdown, status: args.status, verificationArtifactId: args.verification_artifact_id })
    case "create_experiment": return runtime.createExperiment({ workspaceId, projectId: args.project_id, workstreamId: args.workstream_id, title: args.title, hypothesisMarkdown: args.hypothesis_markdown, methodMarkdown: args.method_markdown, resultMarkdown: args.result_markdown, reproducibility: args.reproducibility, status: args.status })
    case "create_paper": return runtime.createPaper({ workspaceId, projectId: args.project_id, title: args.title, authors: args.authors, year: args.year, venue: args.venue, url: args.url, arxivId: args.arxiv_id, doi: args.doi, notesMarkdown: args.notes_markdown })
    case "create_known_result": return runtime.createKnownResult({ workspaceId, projectId: args.project_id, paperId: args.paper_id, title: args.title, statementMarkdown: args.statement_markdown, applicabilityMarkdown: args.applicability_markdown, status: args.status })
    case "create_assumption": return runtime.createAssumption({ workspaceId, projectId: args.project_id, statementMarkdown: args.statement_markdown, status: args.status, reason: args.reason, owner: args.owner, dischargePlan: args.discharge_plan })
    case "create_formalization_target": return runtime.createFormalizationTarget({ workspaceId, projectId: args.project_id, claimId: args.claim_id, proofAttemptId: args.proof_attempt_id, statementMarkdown: args.statement_markdown, theoremStub: args.theorem_stub, requiredDefinitions: args.required_definitions, feasibility: args.feasibility, status: args.status })
    case "create_lean_theorem": return runtime.createLeanTheorem({ workspaceId, projectId: args.project_id, formalizationTargetId: args.formalization_target_id, leanName: args.lean_name, proofFile: args.proof_file, statementMarkdown: args.statement_markdown, status: args.status, hasSorry: args.has_sorry, hasAxiom: args.has_axiom })
    case "link_objects": return runtime.linkObjects({ workspaceId, projectId: args.project_id, sourceType: args.source_type, sourceId: args.source_id, targetType: args.target_type, targetId: args.target_id, edgeType: args.edge_type, metadata: args.metadata })
    case "get_object_graph": return runtime.getObjectGraph({ workspaceId, projectId: args.project_id, sourceType: args.source_type, sourceId: args.source_id })
    case "search_research_objects": return runtime.searchResearchObjects({ workspaceId, projectId: args.project_id, query: args.query, type: args.type })
    case "create_artifact": return runtime.createArtifact({ workspaceId, projectId: args.project_id, workstreamId: args.workstream_id, researchArtifactId: args.research_artifact_id, kind: args.kind, title: args.title, uri: args.uri, file: args.file, expectedSha256: args.expected_sha256, mimeType: args.mime_type, metadata: args.metadata, createdByAgentRunId: args.created_by_agent_run_id })
    case "create_artifact_from_path": {
      const serverPath = args.server_path ?? args.path
      if (!serverPath) throw Object.assign(new Error("create_artifact_from_path requires server_path. ChatGPT-generated files must be uploaded with create_artifact file, not passed as /mnt/data path strings."), { status: 400 })
      return runtime.createArtifactFromPath({ workspaceId, projectId: args.project_id, workstreamId: args.workstream_id, researchArtifactId: args.research_artifact_id, path: serverPath, title: args.title, kind: args.kind, expectedSha256: args.expected_sha256, mimeType: args.mime_type, metadata: args.metadata, createdByAgentRunId: args.created_by_agent_run_id })
    }
    case "get_artifact": return runtime.getArtifact(workspaceId, args.artifact_id)
    case "download_artifact": return runtime.downloadArtifactReference(workspaceId, args.artifact_id)
    case "list_artifacts": return runtime.listArtifacts({ workspaceId, projectId: args.project_id, workstreamId: args.workstream_id, researchArtifactId: args.research_artifact_id, manuscriptVersionId: args.manuscript_version_id })
    case "list_artifact_archive": return runtime.listArtifactArchive(workspaceId, args.artifact_id)
    case "read_artifact_archive_file": return runtime.artifactArchiveEntryContent(workspaceId, args.artifact_id, args.path)
    case "verify_artifact": return runtime.verifyArtifact(workspaceId, args.artifact_id)
    case "attach_artifact_to_manuscript_version": return runtime.attachArtifactToManuscriptVersion({ workspaceId, artifactId: args.artifact_id, manuscriptVersionId: args.manuscript_version_id, role: args.role })
    case "export_physical_artifacts": return runtime.exportPhysicalArtifacts({ workspaceId, workstreamId: args.workstream_id, manuscriptVersionId: args.manuscript_version_id })
    case "get_manuscript_version": return runtime.getManuscriptVersion(workspaceId, args.manuscript_version_id)
    case "create_research_delta": return runtime.createResearchDelta({ workspaceId, projectId: args.project_id, sourceType: args.source_type, sourceId: args.source_id, title: args.title, summaryMarkdown: args.summary_markdown, whatChangedMarkdown: args.what_changed_markdown, mainlineEffectMarkdown: args.mainline_effect_markdown, reusableIdeasMarkdown: args.reusable_ideas_markdown, blockersMarkdown: args.blockers_markdown, nextMoveMarkdown: args.next_move_markdown, confidence: args.confidence, createdByUserId: userId })
    case "list_research_deltas": return runtime.listResearchDeltas({ workspaceId, projectId: args.project_id, sourceType: args.source_type, sourceId: args.source_id, limit: args.limit })
    case "create_mechanism": return runtime.createMechanism({ workspaceId, projectId: args.project_id, title: args.title, slug: args.slug, status: args.status, maturity: args.maturity, descriptionMarkdown: args.description_markdown, coreIdeaMarkdown: args.core_idea_markdown, whereItWorkedMarkdown: args.where_it_worked_markdown, whereItFailedMarkdown: args.where_it_failed_markdown, possibleTransfersMarkdown: args.possible_transfers_markdown, killConditionsMarkdown: args.kill_conditions_markdown, centralityScore: args.centrality_score, portabilityScore: args.portability_score, tractabilityScore: args.tractability_score, noveltyScore: args.novelty_score, loadBearingScore: args.load_bearing_score, createdByUserId: userId })
    case "list_mechanisms": return runtime.listMechanisms({ workspaceId, projectId: args.project_id, status: args.status, maturity: args.maturity, limit: args.limit })
    case "update_mechanism": return runtime.updateMechanism({ workspaceId, id: args.mechanism_id, patch: args.patch })
    case "create_spinout_candidate": return runtime.createSpinoutCandidate({ workspaceId, projectId: args.project_id, originProjectId: args.origin_project_id, title: args.title, slug: args.slug, status: args.status, statementSketchMarkdown: args.statement_sketch_markdown, whyInterestingMarkdown: args.why_interesting_markdown, relationToOriginMarkdown: args.relation_to_origin_markdown, cheapestNextTestMarkdown: args.cheapest_next_test_markdown, possiblePayoffMarkdown: args.possible_payoff_markdown, riskMarkdown: args.risk_markdown, createdByUserId: userId })
    case "list_spinout_candidates": return runtime.listSpinoutCandidates({ workspaceId, projectId: args.project_id, status: args.status, limit: args.limit })
    case "promote_spinout_candidate": return runtime.promoteSpinoutCandidate({ workspaceId, id: args.spinout_id, userId })
    case "create_assumption_regime": return runtime.createAssumptionRegime({ workspaceId, projectId: args.project_id, title: args.title, slug: args.slug, status: args.status, descriptionMarkdown: args.description_markdown, formalStatementMarkdown: args.formal_statement_markdown, includesMarkdown: args.includes_markdown, excludesMarkdown: args.excludes_markdown, motivationMarkdown: args.motivation_markdown, createdByUserId: userId })
    case "list_assumption_regimes": return runtime.listAssumptionRegimes({ workspaceId, projectId: args.project_id, status: args.status, limit: args.limit })
    case "create_theorem_contract": return runtime.createTheoremContract({ workspaceId, projectId: args.project_id, title: args.title, slug: args.slug, status: args.status, theoremStatementMarkdown: args.theorem_statement_markdown, assumptionsMarkdown: args.assumptions_markdown, conclusionMarkdown: args.conclusion_markdown, knownDependenciesMarkdown: args.known_dependencies_markdown, knownBlockersMarkdown: args.known_blockers_markdown, proofStrategyMarkdown: args.proof_strategy_markdown, currentBestVersionMarkdown: args.current_best_version_markdown, confidence: args.confidence, createdByUserId: userId })
    case "list_theorem_contracts": return runtime.listTheoremContracts({ workspaceId, projectId: args.project_id, status: args.status, limit: args.limit })
    case "create_frontier_snapshot": return runtime.createFrontierSnapshot({ workspaceId, projectId: args.project_id, title: args.title, snapshotMarkdown: args.snapshot_markdown, strongestCurrentTheoremMarkdown: args.strongest_current_theorem_markdown, strongestConditionalTheoremMarkdown: args.strongest_conditional_theorem_markdown, activeBlockersMarkdown: args.active_blockers_markdown, activeMechanismsMarkdown: args.active_mechanisms_markdown, spinoutsMarkdown: args.spinouts_markdown, deadOrPausedBranchesMarkdown: args.dead_or_paused_branches_markdown, recommendedNextMovesMarkdown: args.recommended_next_moves_markdown, source: args.source, createdByUserId: userId })
    case "list_frontier_snapshots": return runtime.listFrontierSnapshots({ workspaceId, projectId: args.project_id, source: args.source, limit: args.limit })
    case "get_latest_frontier_snapshot": return runtime.getLatestFrontierSnapshot({ workspaceId, projectId: args.project_id })
    case "create_research_artifact": return runtime.createResearchArtifact({ workspaceId, projectId: args.project_id, title: args.title, slug: args.slug, kind: args.kind, status: args.status, descriptionMarkdown: args.description_markdown, contentMarkdown: args.content_markdown, filePath: args.file_path, url: args.url, createdByUserId: userId })
    case "get_manuscript": return runtime.getStructuredManuscript(workspaceId, args.project_id)
    case "update_manuscript": return runtime.updateStructuredManuscript({ workspaceId, projectId: args.project_id, agentRunId: args.agent_run_id, metadata: args.metadata, sections: args.sections, obligationDrafts: args.obligation_drafts })
    case "build_manuscript": return runtime.buildStructuredManuscript({ workspaceId, projectId: args.project_id, agentRunId: args.agent_run_id, promote: args.promote })
    case "revise_manuscript_source": return runtime.reviseManuscriptSource({ workspaceId, projectId: args.project_id, agentRunId: args.agent_run_id, parentBuildId: args.parent_build_id, sourceReviewRoundId: args.source_review_round_id, revisionClass: args.revision_class, replacements: args.replacements })
    case "inspect_manuscript_build": return runtime.inspectStructuredManuscriptBuild(workspaceId, args.build_id)
    case "publish_manuscript": return runtime.publishStructuredManuscript({ workspaceId, projectId: args.project_id, manuscriptVersionId: args.manuscript_version_id })
    case "promote_manuscript_to_submission_candidate": return runtime.promoteManuscriptToSubmissionCandidate({ workspaceId, manuscriptVersionId: args.manuscript_version_id, loadBearingObligationIds: args.load_bearing_obligation_ids })
    case "import_external_review": return runtime.importExternalReview({ workspaceId, projectId: args.project_id, manuscriptVersionId: args.manuscript_version_id, theoremOrArtifactRef: args.theorem_or_artifact_ref, originalReviewText: args.original_review_text, originalReviewUri: args.original_review_uri, provenance: args.provenance, reviewerIdentity: args.reviewer_identity, independenceStatement: args.independence_statement, reviewScope: args.review_scope, verdict: args.verdict, issues: args.issues, requiredChanges: args.required_changes })
    case "triage_external_review": return runtime.triageExternalReview({ workspaceId, projectId: args.project_id, externalReviewId: args.external_review_id, agentRunId: args.agent_run_id, dispositions: args.dispositions })
    case "create_strategic_review": return runtime.createStrategicReviewRound({ workspaceId, projectId: args.project_id, verdict: args.verdict, reviewerIndependence: args.reviewer_independence ?? "computed from AgentRun provenance", whatChangedMarkdown: args.what_changed_markdown, loopDiagnosisMarkdown: args.loop_diagnosis_markdown, blockerStructureMarkdown: args.blocker_structure_markdown, alternativesMarkdown: args.alternatives_markdown, branchAllocation: args.branch_allocation, nextMoves: args.next_moves, probabilityEstimates: args.probability_estimates, metrics: args.metrics, createdByAgentRunId: args.created_by_agent_run_id })
    case "get_project_health": return runtime.getProjectHealth(workspaceId, args.project_id)
    case "create_project_branch": return runtime.createProjectBranch({ workspaceId, projectId: args.project_id, title: args.title, state: args.state, rationaleMarkdown: args.rationale_markdown, targetObjectType: args.target_object_type, targetObjectId: args.target_object_id })
    case "create_proof_obligation": return runtime.createProofObligation({ workspaceId, projectId: args.project_id, manuscriptVersionId: args.manuscript_version_id, title: args.title, statementMarkdown: args.statement_markdown, dependencies: args.dependencies, claimId: args.claim_id, sourceArtifactId: args.source_artifact_id, proofLocation: args.proof_location, manuscriptLocation: args.manuscript_location, externalTheorems: args.external_theorems, externalAssumptionsMatched: args.external_assumptions_matched, exactManuscriptProofPresent: args.exact_manuscript_proof_present, assumptions: args.assumptions, excludedRegimes: args.excluded_regimes, boundaryCases: args.boundary_cases, semanticConsequences: args.semantic_consequences, authorAssertion: args.author_assertion, required: args.required, loadBearing: args.load_bearing })
    case "get_integration_coverage": return runtime.getIntegrationCoverage(workspaceId, args.manuscript_version_id)
    case "compute_submission_readiness": return runtime.computeProjectSubmissionReadiness(workspaceId, args.project_id)
    case "list_research_artifacts": return runtime.listResearchArtifacts({ workspaceId, projectId: args.project_id, kind: args.kind, status: args.status, limit: args.limit })
    case "get_research_artifact": return runtime.getResearchArtifact(workspaceId, args.artifact_id)
    case "export_research_artifact_bundle": return runtime.getResearchArtifactBundle(workspaceId, args.artifact_ids)
    case "create_research_link": return runtime.createResearchLink({ workspaceId, projectId: args.project_id, sourceType: args.source_type, sourceId: args.source_id, relationType: args.relation_type, targetType: args.target_type, targetId: args.target_id, noteMarkdown: args.note_markdown, confidence: args.confidence, createdByUserId: userId })
    case "list_research_links": return runtime.listResearchLinks({ workspaceId, projectId: args.project_id, sourceType: args.source_type, sourceId: args.source_id, targetType: args.target_type, targetId: args.target_id, limit: args.limit })
    case "run_legacy_distillation_preview": return runtime.runLegacyDistillationPreview({ workspaceId, outputPath: args.output_path })
    case "run_legacy_distillation_apply": return runtime.runLegacyDistillationApply({ workspaceId, userId })
    case "begin_project_import": return runtime.beginProjectImport({ workspaceId, projectId: args.project_id, title: args.title, provenance: args.provenance })
    case "analyze_project_import": return runtime.analyzeProjectImport({ workspaceId, importId: args.import_id, artifactIds: args.artifact_ids, proposedMap: args.proposed_map })
    case "preview_project_import": return runtime.getProjectImport(workspaceId, args.import_id)
    case "commit_project_import": return runtime.commitProjectImport({ workspaceId, importId: args.import_id, userCorrections: args.user_corrections })
    case "run_project_graph_audit": return runtime.runProjectGraphAudit({ workspaceId, projectId: args.project_id, mode: args.mode, auditorRunId: args.auditor_run_id })
    case "begin_repair_from_audit": return runtime.beginRepairFromAudit({ workspaceId, projectId: args.project_id, auditId: args.audit_id })
    case "create_lean_project": return createLeanProject({ workspaceId, projectName: args.project_name })
    case "create_lean_stub": return createLeanStub({ workspaceId, formalizationTargetId: args.formalization_target_id, theoremStatement: args.theorem_statement, imports: args.imports, userId })
    case "lean_check": return leanCheck({ workspaceId, leanTheoremId: args.lean_theorem_id, userId })
    case "lean_goal": return leanGoal({ workspaceId, leanFileId: args.lean_file_id, position: args.position })
    case "mark_lean_verified": return runtime.markLeanVerified({ workspaceId, leanTheoremId: args.lean_theorem_id })
    case "rebuild_quartz_site": return rebuildQuartz(workspaceId, userId)
    case "get_quartz_site_status": return quartzStatus(workspaceId)
    default: throw new Error(`Unknown tool: ${toolName}`)
  }
}

export function structuredContentForTool(toolName: string, value: unknown): JsonObject {
  const serialized = value === undefined ? null : JSON.parse(JSON.stringify(value))
  if (serialized !== null && typeof serialized === "object" && !Array.isArray(serialized)) return serialized as JsonObject

  const listKey = listResultKeys[toolName]
  if (listKey) return { [listKey]: Array.isArray(serialized) ? serialized : [] }
  if (Array.isArray(serialized)) return { items: serialized }
  return { result: serialized }
}

export function contentResult(toolName: string, value: unknown) {
  const structuredContent = structuredContentForTool(toolName, value)
  const embeddedResource = (structuredContent as any).embedded_resource
  if (toolName === "read_artifact_archive_file" && embeddedResource && typeof embeddedResource.uri === "string") {
    const metadata = { ...structuredContent } as any
    delete metadata.embedded_resource
    const resource = {
      uri: embeddedResource.uri,
      mimeType: embeddedResource.mime_type ?? metadata.mime_type ?? "application/octet-stream",
      ...(typeof embeddedResource.text === "string" ? { text: embeddedResource.text } : { blob: embeddedResource.blob })
    }
    return {
      structuredContent: metadata,
      content: [
        { type: "resource", resource },
        ...(typeof embeddedResource.text === "string" ? [{ type: "text", text: embeddedResource.text }] : []),
        { type: "text", text: JSON.stringify(metadata, null, 2) }
      ]
    }
  }
  const directUri = (structuredContent as any).uri
  const finalPdf = (structuredContent as any).final_pdf
  if (toolName === "publish_manuscript" && typeof finalPdf?.uri === "string") {
    return { structuredContent, content: [{ type: "resource_link", uri: finalPdf.uri, name: finalPdf.name ?? "final-manuscript.pdf", mimeType: finalPdf.mime_type ?? "application/pdf" }, { type: "text", text: JSON.stringify(structuredContent, null, 2) }] }
  }
  if (["download_artifact", "surface_artifact"].includes(toolName) && typeof directUri === "string") {
    return {
      structuredContent,
      content: [
        { type: "resource_link", uri: directUri, name: (structuredContent as any).name ?? (structuredContent as any).entry_path ?? "artifact", mimeType: (structuredContent as any).mime_type ?? "application/octet-stream" },
        { type: "text", text: JSON.stringify(structuredContent, null, 2) }
      ]
    }
  }
  return {
    structuredContent,
    content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }]
  }
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

function isoTimestamp(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

export function formatResearchArtifact(artifact: any) {
  const contentMarkdown = artifact.contentMarkdown ?? null
  return {
    id: artifact.id,
    workspace_id: artifact.workspaceId,
    project_id: artifact.projectId,
    title: artifact.title,
    slug: artifact.slug,
    kind: artifact.kind,
    status: artifact.status,
    description_markdown: artifact.descriptionMarkdown ?? null,
    content_markdown: contentMarkdown,
    file_path: artifact.filePath ?? null,
    file_status: artifact.fileStatus ?? (artifact.filePath ? "provenance_only" : "not_applicable"),
    file_diagnostic: artifact.fileDiagnostic ?? null,
    physical_artifacts: Array.isArray(artifact.physicalArtifacts) ? artifact.physicalArtifacts.map((physical: any) => ({ id: physical.id, original_filename: physical.originalFilename, mime_type: physical.mimeType, byte_size: physical.byteSize === null ? null : Number(physical.byteSize), sha256: physical.sha256, storage_status: physical.storageStatus, workstream_id: physical.workstreamId, manuscript_version_ids: (physical.manuscriptLinks ?? []).map((link: any) => link.manuscriptVersionId) })) : [],
    url: artifact.url ?? null,
    created_at: isoTimestamp(artifact.createdAt),
    updated_at: isoTimestamp(artifact.updatedAt),
    content_hash: sha256(contentMarkdown ?? "")
  }
}

function formatResearchArtifactBundle(artifacts: any[]) {
  const orderedArtifacts = artifacts.map(formatResearchArtifact).sort((a, b) => a.id.localeCompare(b.id))
  const manifest = orderedArtifacts.map(({ id, content_hash }) => ({ id, content_hash }))
  return { export_type: "research_metadata_with_linked_physical_artifact_references", note: "ResearchArtifact content is metadata/report content. Physical bytes must be retrieved through download_artifact or export_physical_artifacts.", artifacts: orderedArtifacts, manifest_hash: sha256(JSON.stringify(manifest)) }
}

function clip(text: unknown, max = 280) {
  if (typeof text !== "string") return undefined
  return text.length > max ? `${text.slice(0, max - 1)}...` : text
}

function compactWorkspace(workspace: any) {
  if (!workspace) return workspace
  return { id: workspace.id, slug: workspace.slug, name: workspace.name, type: workspace.type }
}

function compactProject(project: any) {
  if (!project) return project
  return {
    id: project.id,
    slug: project.slug,
    title: project.title,
    area: project.area,
    status: project.status,
    statement_preview: clip(project.statement, 220),
    coordinator_summary_preview: clip(project.coordinatorSummary, 220),
    current_working_paper_id: project.currentWorkingPaperId
  }
}

function compactGoal(goal: any) {
  if (!goal) return goal
  return {
    id: goal.id,
    title: goal.title,
    status: goal.status,
    priority: goal.priority,
    statement_preview: clip(goal.statement, 220),
    success_criteria_count: Array.isArray(goal.successCriteria) ? goal.successCriteria.length : undefined,
    dependency_count: Array.isArray(goal.dependencies) ? goal.dependencies.length : undefined
  }
}

function compactWorkstream(workstream: any) {
  if (!workstream) return workstream
  return {
    id: workstream.id,
    title: workstream.title,
    kind: workstream.kind,
    status: workstream.status,
    priority: workstream.priority,
    coordinator_role: workstream.coordinatorRole,
    report_id: workstream.reportId,
    goal_id: workstream.goalId,
    target_object_type: workstream.targetObjectType,
    target_object_id: workstream.targetObjectId,
    instructions_preview: clip(workstream.instructions, 220),
    success_criteria_count: Array.isArray(workstream.successCriteria) ? workstream.successCriteria.length : undefined,
    allowed_write_count: Array.isArray(workstream.allowedWrites) ? workstream.allowedWrites.length : undefined,
    forbidden_action_count: Array.isArray(workstream.forbiddenActions) ? workstream.forbiddenActions.length : undefined
  }
}

function compactReport(report: any, options: { includeBody?: boolean; includeRefs?: boolean } = {}) {
  if (!report) return report
  const linkedRefs = Array.isArray(report.linkedObjectRefs) ? report.linkedObjectRefs.length : undefined
  const artifactRefs = Array.isArray(report.artifactRefs) ? report.artifactRefs.length : undefined
  const uncertaintyNotes = Array.isArray(report.uncertaintyNotes) ? report.uncertaintyNotes.length : undefined
  const compacted: Record<string, unknown> = {
    id: report.id,
    title: report.title,
    status: report.status,
    submitted_at: report.submittedAt,
    updated_at: report.updatedAt,
    body_preview: clip(report.bodyMarkdown, 220),
    linked_object_ref_count: linkedRefs,
    artifact_ref_count: artifactRefs,
    uncertainty_note_count: uncertaintyNotes,
    review_count: Array.isArray(report.reviews) ? report.reviews.length : undefined
  }
  if (options.includeBody) compacted.body_markdown = report.bodyMarkdown
  if (options.includeRefs) {
    compacted.linked_object_refs = Array.isArray(report.linkedObjectRefs) ? report.linkedObjectRefs : []
    compacted.artifact_refs = Array.isArray(report.artifactRefs) ? report.artifactRefs : []
    compacted.uncertainty_notes = Array.isArray(report.uncertaintyNotes) ? report.uncertaintyNotes : []
  }
  return compacted
}

function compactReview(review: any) {
  if (!review) return review
  return {
    id: review.id,
    report_id: review.reportId,
    target_object_type: review.targetObjectType,
    target_object_id: review.targetObjectId,
    review_type: review.reviewType,
    target_version: review.targetVersion,
    independence: review.independence,
    parent_math_reopenable: review.parentMathReopenable,
    prior_approvals_evidence_only: review.priorApprovalsEvidenceOnly,
    inspected_artifact_count: Array.isArray(review.inspectedArtifactIds) ? review.inspectedArtifactIds.length : undefined,
    checked_obligation_count: Array.isArray(review.checkedObligationIds) ? review.checkedObligationIds.length : undefined,
    reviewer_role: review.reviewerRole,
    verdict: review.verdict,
    issue_count: Array.isArray(review.issues) ? review.issues.length : undefined,
    required_change_count: Array.isArray(review.requiredChanges) ? review.requiredChanges.length : undefined,
    checked_ref_count: Array.isArray(review.checkedRefs) ? review.checkedRefs.length : undefined,
    body_preview: clip(review.bodyMarkdown, 220),
    created_at: review.createdAt
  }
}

function compactAgentRun(agentRun: any) {
  if (!agentRun) return agentRun
  return {
    id: agentRun.id,
    role: agentRun.role,
    status: agentRun.status,
    model: agentRun.model,
    session_id: agentRun.sessionId,
    started_at: agentRun.startedAt,
    finished_at: agentRun.finishedAt,
    output_summary_preview: clip(agentRun.outputSummary, 220),
    tool_call_count: Array.isArray(agentRun.toolCalls) ? agentRun.toolCalls.length : undefined
  }
}

function compactBriefing(briefing: any) {
  if (!briefing) return briefing
  return {
    role: briefing.role,
    project: compactProject(briefing.project),
    goal: compactGoal(briefing.goal),
    workstream: compactWorkstream(briefing.workstream),
    parent_context: compactWorkstream(briefing.parent_context),
    role_recipe_preview: clip(briefing.role_recipe, 220),
    report: compactReport(briefing.report, { includeBody: true, includeRefs: true }),
    target_objects: Array.isArray(briefing.target_objects) ? briefing.target_objects.map(compactResearchObject) : undefined,
    relevant_reports: Array.isArray(briefing.relevant_reports) ? briefing.relevant_reports.map(compactReport) : undefined,
    open_gaps: Array.isArray(briefing.open_gaps) ? briefing.open_gaps.map(compactResearchObject) : undefined,
    allowed_writes: briefing.allowed_writes,
    forbidden_actions: briefing.forbidden_actions,
    success_criteria: briefing.success_criteria,
    output_contract: briefing.output_contract,
    review_assignment_policy: briefing.review_assignment_policy,
    manuscript_inspection: briefing.manuscript_inspection,
    execution_start_rule: briefing.execution_start_rule,
    completion_options: briefing.completion_options,
    related_known_result_count: Array.isArray(briefing.related_known_results) ? briefing.related_known_results.length : undefined,
    related_known_results: Array.isArray(briefing.related_known_results) ? takeList(briefing.related_known_results, 8, compactResearchObject) : undefined
  }
}

function compactReviewAssignment(value: any) {
  if (!value?.assignment) return value
  return {
    assignment: {
      id: value.assignment.id,
      workstream_id: value.assignment.workstreamId,
      reviewer_run_id: value.assignment.reviewerRunId,
      review_type: value.assignment.reviewType,
      target_object_type: value.assignment.targetObjectType,
      target_object_id: value.assignment.targetObjectId,
      target_hash: value.assignment.targetHash,
      manuscript_version_id: value.assignment.manuscriptVersionId,
      independence: value.assignment.independence,
      permitted_artifact_ids: value.assignment.permittedArtifactIds,
      status: value.assignment.status,
      lease_expires_at: value.assignment.leaseExpiresAt
    },
    submission_token: value.submission_token,
    eligibility: value.eligibility
  }
}

function compactMessage(message: any) {
  if (!message) return message
  return {
    id: message.id,
    from_role: message.fromRole,
    to_role: message.toRole,
    kind: message.kind,
    body_preview: clip(message.body, 220),
    artifact_ref_count: Array.isArray(message.artifactRefs) ? message.artifactRefs.length : undefined,
    created_at: message.createdAt
  }
}

function compactArtifact(artifact: any) {
  if (!artifact) return artifact
  return {
    id: artifact.id,
    kind: artifact.kind,
    title: artifact.title,
    uri: artifact.uri,
    original_filename: artifact.originalFilename,
    mime_type: artifact.mimeType,
    byte_size: artifact.byteSize === null || artifact.byteSize === undefined ? null : Number(artifact.byteSize),
    sha256: artifact.sha256,
    storage_status: artifact.storageStatus,
    verification: artifact.verification,
    download: artifact.download,
    workstream_id: artifact.workstreamId,
    research_artifact_id: artifact.researchArtifactId,
    source_path_provenance: artifact.path,
    created_at: artifact.createdAt
  }
}

function compactGraphEdge(edge: any) {
  if (!edge) return edge
  return {
    source_type: edge.sourceType,
    source_id: edge.sourceId,
    target_type: edge.targetType,
    target_id: edge.targetId,
    edge_type: edge.edgeType
  }
}

function compactLeanCheckResult(value: any) {
  return {
    result: value.result ? {
      success: value.result.success,
      has_sorry: value.result.hasSorry,
      has_axiom: value.result.hasAxiom,
      diagnostics_count: Array.isArray(value.result.diagnostics) ? value.result.diagnostics.length : undefined
    } : undefined,
    job: value.job ? {
      id: value.job.id,
      type: value.job.type,
      status: value.job.status,
      started_at: value.job.startedAt,
      finished_at: value.job.finishedAt
    } : undefined,
    lean_theorem: compactResearchObject(value.leanTheorem),
    verification_gate: value.verificationGate ? {
      has_sorry: value.verificationGate.hasSorry,
      has_axiom: value.verificationGate.hasAxiom,
      active_temporary_or_unproved_assumptions: value.verificationGate.activeTemporaryOrUnprovedAssumptions
    } : undefined
  }
}

function compactResearchObject(value: any) {
  if (!value) return value
  if ("summaryMarkdown" in value && "whatChangedMarkdown" in value) {
    return { id: value.id, type: "ResearchDelta", title: value.title, confidence: value.confidence, summary_preview: clip(value.summaryMarkdown, 180), what_changed_preview: clip(value.whatChangedMarkdown, 180) }
  }
  if ("contentMarkdown" in value && "filePath" in value) {
    return { id: value.id, type: "ResearchArtifact", title: value.title, kind: value.kind, status: value.status, description_preview: clip(value.descriptionMarkdown, 180), content_preview: clip(value.contentMarkdown, 180), file_path: value.filePath, url: value.url }
  }
  if ("maturity" in value && "coreIdeaMarkdown" in value) {
    return { id: value.id, type: "Mechanism", title: value.title, status: value.status, maturity: value.maturity, description_preview: clip(value.descriptionMarkdown, 180), core_idea_preview: clip(value.coreIdeaMarkdown, 180) }
  }
  if ("statementSketchMarkdown" in value) {
    return { id: value.id, type: "SpinoutCandidate", title: value.title, status: value.status, statement_preview: clip(value.statementSketchMarkdown, 180), why_interesting_preview: clip(value.whyInterestingMarkdown, 180) }
  }
  if ("formalStatementMarkdown" in value && "includesMarkdown" in value) {
    return { id: value.id, type: "AssumptionRegime", title: value.title, status: value.status, description_preview: clip(value.descriptionMarkdown, 180), formal_statement_preview: clip(value.formalStatementMarkdown, 180) }
  }
  if ("theoremStatementMarkdown" in value) {
    return { id: value.id, type: "TheoremContract", title: value.title, status: value.status, confidence: value.confidence, theorem_statement_preview: clip(value.theoremStatementMarkdown, 180) }
  }
  if ("snapshotMarkdown" in value) {
    return { id: value.id, type: "ResearchFrontierSnapshot", title: value.title, source: value.source, snapshot_preview: clip(value.snapshotMarkdown, 180) }
  }
  if ("claimKind" in value || "confidence" in value) {
    return { id: value.id, type: "Claim", title: value.title, status: value.status, kind: value.kind, confidence: value.confidence, statement_preview: clip(value.statementMarkdown, 180) }
  }
  if ("strategyMarkdown" in value) {
    return { id: value.id, type: "ProofRoute", title: value.title, status: value.status, first_testable_step: value.firstTestableStep, kill_condition: value.killCondition, strategy_preview: clip(value.strategyMarkdown, 180) }
  }
  if ("descriptionMarkdown" in value && "severity" in value) {
    return { id: value.id, type: "Gap", title: value.title, status: value.status, severity: value.severity, description_preview: clip(value.descriptionMarkdown, 180) }
  }
  if ("statementMarkdown" in value && "applicabilityMarkdown" in value) {
    return { id: value.id, type: "KnownResult", title: value.title, status: value.status, statement_preview: clip(value.statementMarkdown, 180), applicability_preview: clip(value.applicabilityMarkdown, 180) }
  }
  if ("notesMarkdown" in value && "authors" in value) {
    return { id: value.id, type: "Paper", title: value.title, year: value.year, venue: value.venue, url: value.url, notes_preview: clip(value.notesMarkdown, 180) }
  }
  if ("statementMarkdown" in value && "type" in value) {
    return { id: value.id, type: value.type, title: value.title, status: value.status, statement_preview: clip(value.statementMarkdown, 180) }
  }
  if ("bodyMarkdown" in value && "routeId" in value) {
    return { id: value.id, type: "ProofAttempt", status: value.status, gap_summary: clip(value.gapSummary, 180), body_preview: clip(value.bodyMarkdown, 180) }
  }
  if ("constructionMarkdown" in value) {
    return { id: value.id, type: "Counterexample", title: value.title, status: value.status, construction_preview: clip(value.constructionMarkdown, 180) }
  }
  if ("hypothesisMarkdown" in value && "methodMarkdown" in value) {
    return { id: value.id, type: "Experiment", title: value.title, status: value.status, hypothesis_preview: clip(value.hypothesisMarkdown, 180), method_preview: clip(value.methodMarkdown, 180) }
  }
  if ("dischargePlan" in value) {
    return { id: value.id, type: "Assumption", status: value.status, statement_preview: clip(value.statementMarkdown, 180), owner: value.owner, discharge_plan_preview: clip(value.dischargePlan, 180) }
  }
  if ("theoremStub" in value) {
    return { id: value.id, type: "FormalizationTarget", status: value.status, feasibility: value.feasibility, statement_preview: clip(value.statementMarkdown, 180), theorem_stub_preview: clip(value.theoremStub, 180) }
  }
  if ("leanName" in value) {
    return { id: value.id, type: "LeanTheorem", lean_name: value.leanName, status: value.status, proof_file: value.proofFile, has_sorry: value.hasSorry, has_axiom: value.hasAxiom, statement_preview: clip(value.statementMarkdown, 180) }
  }
  return value
}

function compactList(values: any[] | undefined, itemCompactor: (value: any) => any) {
  return Array.isArray(values) ? values.map(itemCompactor) : values
}

function takeList(values: any[] | undefined, limit: number, itemCompactor: (value: any) => any) {
  return Array.isArray(values) ? values.slice(0, limit).map(itemCompactor) : values
}

function compactContext(value: any) {
  return {
    workspace: compactWorkspace(value.workspace),
    active_project: compactProject(value.active_project),
    projects: takeList(value.projects, 5, compactProject),
    control_rooms: takeList(value.control_rooms, 3, compactControlRoomSummary),
    next_assignments: takeList(value.next_assignments, 5, compactWorkstream),
    review_queue: takeList(value.review_queue, 5, compactReviewQueueItem),
    attention: {
      needs_review: value.attention?.needs_review,
      ready_or_revision_assignments: value.attention?.ready_or_revision_assignments,
      running_or_blocked_count: Array.isArray(value.attention?.running_or_blocked) ? value.attention.running_or_blocked.length : undefined,
      running_or_blocked: takeList(value.attention?.running_or_blocked, 5, compactWorkstream)
    },
    suggested_chat_prompts: value.suggested_chat_prompts
  }
}

function compactReviewQueueItem(workstream: any) {
  if (!workstream) return workstream
  return {
    ...compactWorkstream(workstream),
    project: compactProject(workstream.project),
    latest_report: compactReport(Array.isArray(workstream.reports) ? workstream.reports[0] : undefined)
  }
}

function compactControlRoom(value: any) {
  return {
    project: compactProject(value.project),
    goal_counts_by_status: Object.fromEntries(Object.entries(value.goals_by_status ?? {}).map(([k, v]) => [k, Array.isArray(v) ? v.length : 0])),
    workstream_counts_by_status: Object.fromEntries(Object.entries(value.workstreams_by_status ?? {}).map(([k, v]) => [k, Array.isArray(v) ? v.length : 0])),
    goals_by_status: Object.fromEntries(Object.entries(value.goals_by_status ?? {}).map(([k, v]) => [k, takeList(v as any[], 2, compactGoal)])),
    workstreams_by_status: Object.fromEntries(Object.entries(value.workstreams_by_status ?? {}).map(([k, v]) => [k, takeList(v as any[], 3, compactWorkstream)])),
    needs_review: takeList(value.needs_review, 3, compactWorkstream),
    blocked_or_escalated: takeList(value.blocked_or_escalated, 3, compactWorkstream),
    recent_agent_runs: takeList(value.recent_agent_runs, 3, compactAgentRun),
    key_claims: takeList(value.key_claims, 3, compactResearchObject),
    open_gaps: takeList(value.open_gaps, 3, compactResearchObject),
    recent_reviews: takeList(value.recent_reviews, 3, compactReview),
    canonical_working_paper: value.canonical_working_paper ? { id: value.canonical_working_paper.id, version: value.canonical_working_paper.version, content_hash: value.canonical_working_paper.content_hash, theorem_fingerprint: value.canonical_working_paper.theorem_fingerprint } : null,
    readiness: value.readiness ? { submission_ready: value.readiness.submission_ready, status: value.readiness.status, missing_gate_references: value.readiness.missing_gate_references, reasons: value.readiness.reasons, gates: Object.fromEntries(Object.entries(value.readiness.gates ?? {}).map(([name, gate]: [string, any]) => [name, { satisfied: gate.satisfied, missing_obligation_ids: gate.missing_obligation_ids, missing_claim_ids: gate.missing_claim_ids }])), stale_review_count: Array.isArray(value.readiness.stale_review_references) ? value.readiness.stale_review_references.length : 0, blocking_object_count: Array.isArray(value.readiness.blocking_object_references) ? value.readiness.blocking_object_references.length : 0 } : undefined,
    workstream_dependency_states: takeList(value.workstream_dependency_states, 12, (state) => state),
    project_health: value.project_health,
    suggested_next_assignment: compactWorkstream(value.suggested_next_assignment),
    suggested_chat_prompts: value.suggested_chat_prompts
  }
}

function compactControlRoomSummary(value: any) {
  return {
    project: compactProject(value.project),
    goal_counts_by_status: Object.fromEntries(Object.entries(value.goals_by_status ?? {}).map(([k, v]) => [k, Array.isArray(v) ? v.length : 0])),
    workstream_counts_by_status: Object.fromEntries(Object.entries(value.workstreams_by_status ?? {}).map(([k, v]) => [k, Array.isArray(v) ? v.length : 0])),
    needs_review_count: Array.isArray(value.needs_review) ? value.needs_review.length : 0,
    blocked_or_escalated_count: Array.isArray(value.blocked_or_escalated) ? value.blocked_or_escalated.length : 0,
    recent_review_count: Array.isArray(value.recent_reviews) ? value.recent_reviews.length : 0,
    suggested_next_assignment: compactWorkstream(value.suggested_next_assignment)
  }
}

function compactWorkstreamDetail(value: any) {
  return {
    workstream: compactWorkstream(value),
    project: compactProject(value.project),
    goal: compactGoal(value.goal),
    reports: compactList(value.reports, (report) => compactReport(report, { includeBody: true, includeRefs: true })),
    reviews: compactList(value.reviews, compactReview),
    agent_runs: compactList(value.agentRuns, compactAgentRun),
    messages: compactList(value.messages, compactMessage),
    artifacts: compactList(value.artifacts, compactArtifact)
  }
}

function compactReportDetail(value: any) {
  return {
    report: compactReport(value, { includeBody: true, includeRefs: true }),
    workstream: compactWorkstream(value.workstream),
    reviews: compactList(value.reviews, compactReview)
  }
}

function compactClaimResponse(value: any) {
  return {
    workspace: compactWorkspace(value.workspace),
    project: compactProject(value.project),
    assignment: compactWorkstream(value.assignment),
    briefing: compactBriefing(value.briefing),
    agent_run: compactAgentRun(value.agent_run),
    review_assignment: compactReviewAssignment(value.review_assignment),
    session_id: value.session_id,
    prompt_to_agent: value.prompt_to_agent,
    message: value.message ?? undefined,
    details_hint: value.assignment ? "Use get_workstream or get_report for full report/review details if needed." : undefined
  }
}

export function compactToolResult(toolName: string, value: unknown) {
  if (value && typeof value === "object") {
    if (toolName === "get_research_artifact") return formatResearchArtifact(value)
    if (toolName === "export_research_artifact_bundle") return formatResearchArtifactBundle(value as any[])
    if (toolName === "list_workspaces") return { workspaces: compactList(value as any[], compactWorkspace) ?? [] }
    if (toolName === "create_project" || toolName === "get_project") return compactProject(value)
    if (toolName === "list_projects") return { projects: compactList(value as any[], compactProject) ?? [] }
    if (toolName === "get_project_control_room") return compactControlRoom(value)
    if (toolName === "propose_project_goal" || toolName === "approve_project_goal" || toolName === "update_project_goal") return compactGoal(value)
    if (toolName === "list_project_goals") return { goals: compactList(value as any[], compactGoal) ?? [] }
    if (toolName === "create_workstream") return compactWorkstream(value)
    if (toolName === "list_workstreams") return { workstreams: compactList(value as any[], compactWorkstream) ?? [] }
    if (toolName === "get_workstream") return compactWorkstreamDetail(value)
    if (toolName === "claim_next_review" || toolName === "claim_next_assignment") return compactClaimResponse(value)
    if (toolName === "get_agent_briefing") return compactBriefing(value)
    if (toolName === "claim_agent_assignment") return { assignment: compactWorkstream((value as any).assignment), briefing: compactBriefing((value as any).briefing) }
    if (toolName === "start_agent_run") return { agent_run: compactAgentRun((value as any).agentRun), briefing: compactBriefing((value as any).briefing) }
    if (toolName === "get_my_maff_context") return compactContext(value)
    if (toolName === "write_agent_observation") return compactMessage(value)
    if (toolName === "mark_workstream_blocked" || toolName === "escalate_workstream" || toolName === "request_workstream_revision" || toolName === "approve_workstream" || toolName === "complete_workstream") return compactWorkstream(value)
    if (toolName === "create_or_update_workstream_report" || toolName === "submit_workstream_report") return compactReport(value)
    if (toolName === "record_review_round") return compactReview(value)
    if (toolName === "list_review_rounds") return { reviews: compactList(value as any[], compactReview) ?? [] }
    if (toolName === "get_report") return compactReportDetail(value)
    if (toolName === "create_artifact") return compactArtifact(value)
    if (toolName === "link_objects") return compactGraphEdge(value)
    if (toolName === "lean_check") return compactLeanCheckResult(value)
    if (toolName === "create_lean_stub") return { result: (value as any).result, lean_theorem: compactResearchObject((value as any).leanTheorem) }
    if (["list_research_deltas", "list_research_artifacts", "list_mechanisms", "list_spinout_candidates", "list_assumption_regimes", "list_theorem_contracts", "list_frontier_snapshots"].includes(toolName)) return compactList(value as any[], compactResearchObject)
    if (toolName === "mark_lean_verified") return compactResearchObject(value)
    if (toolName.startsWith("create_") || toolName === "update_claim_status" || toolName === "resolve_gap") return compactResearchObject(value)
    if (toolName === "get_object_graph") {
      const nodes = compactList((value as any).nodes, compactResearchObject)
      return {
        source: compactResearchObject((value as any).source),
        edges: compactList((value as any).edges, compactGraphEdge),
        nodes,
        objects: nodes
      }
    }
    if (toolName === "search_research_objects") return {
      claims: compactList((value as any).claims, compactResearchObject),
      routes: compactList((value as any).routes, compactResearchObject),
      gaps: compactList((value as any).gaps, compactResearchObject),
      papers: compactList((value as any).papers, compactResearchObject),
      known_results: compactList((value as any).known_results ?? (value as any).knownResults, compactResearchObject),
      research_deltas: compactList((value as any).research_deltas, compactResearchObject),
      research_artifacts: compactList((value as any).research_artifacts, compactResearchObject),
      mechanisms: compactList((value as any).mechanisms, compactResearchObject),
      spinout_candidates: compactList((value as any).spinout_candidates, compactResearchObject),
      assumption_regimes: compactList((value as any).assumption_regimes, compactResearchObject),
      theorem_contracts: compactList((value as any).theorem_contracts, compactResearchObject),
      frontier_snapshots: compactList((value as any).frontier_snapshots, compactResearchObject)
    }
  }
  return value
}

function resourceResult(uri: string, value: unknown) {
  return { contents: [{ uri, mimeType: "application/json", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] }
}

function toolForList(definition: ToolDef) {
  const securitySchemes = [{ type: "oauth2", scopes: [definition.scope] }]
  const meta = { securitySchemes, ...(definition.meta ?? {}) }
  return {
    name: definition.name,
    description: definition.description,
    inputSchema: definition.inputSchema,
    input_schema: definition.inputSchema,
    outputSchema: definition.outputSchema,
    annotations: definition.annotations,
    securitySchemes,
    _meta: meta
  }
}

export function mcpToolsListResult() {
  return { tools: toolDefinitions.map(toolForList) }
}

export function mcpAuthorizationMatrix() {
  return toolDefinitions.map(({ name, scope, role }) => ({ name, scope, clientRoles: acceptedClientRolesForScope(scope), workspaceRole: role }))
}

export async function mcpHandler(req: Request, res: Response) {
  try {
    if (!req.auth) return res.status(401).json({ error: "missing_token" })
    const { id, method, params } = req.body ?? {}
    const ctx: ToolContext = {
      userId: req.auth.user.id,
      claimsScope: req.auth.claims.scope,
      resourceAccess: req.auth.claims.resource_access,
      aud: req.auth.claims.aud,
      sub: req.auth.claims.sub,
      azp: typeof req.auth.claims.azp === "string" ? req.auth.claims.azp : undefined,
      clientId: typeof req.auth.claims.client_id === "string" ? req.auth.claims.client_id : undefined
    }
    const resourceCtx = { userId: req.auth.user.id, claims: req.auth.claims }
    if (method === "initialize") return res.json({ jsonrpc: "2.0", id, result: { protocolVersion: "2024-11-05", serverInfo: { name: "Maff", version: mcpServerVersion }, capabilities: { tools: { listChanged: true }, resources: {}, prompts: {} } } })
    if (method === "tools/list") return res.json({ jsonrpc: "2.0", id, result: mcpToolsListResult() })
    if (method === "tools/call") {
      const raw = await callTool(params.name, params.arguments ?? {}, ctx)
      return res.json({ jsonrpc: "2.0", id, result: contentResult(params.name, compactToolResult(params.name, raw)) })
    }
    if (method === "resources/list") return res.json({ jsonrpc: "2.0", id, result: await listResources(resourceCtx) })
    if (method === "resources/read") return res.json({ jsonrpc: "2.0", id, result: resourceResult(params.uri, await readResource(params.uri, resourceCtx)) })
    if (method === "prompts/list") {
      const prompts = await listPrompts()
      return res.json({ jsonrpc: "2.0", id, result: { prompts: prompts.map((name) => ({ name, description: `Maff role recipe or prompt: ${name}` })) } })
    }
    if (method === "prompts/get") {
      const text = await getPrompt(params.name)
      return res.json({ jsonrpc: "2.0", id, result: { description: `Maff role recipe or prompt: ${params.name}`, messages: [{ role: "user", content: { type: "text", text } }] } })
    }
    return res.json({ jsonrpc: "2.0", id, result: { ok: true } })
  } catch (error) {
    const err = error as Error & { status?: number; wwwAuthenticate?: string }
    if (err.wwwAuthenticate) res.setHeader("WWW-Authenticate", err.wwwAuthenticate)
    res.status(err.status ?? 400).json({
      jsonrpc: "2.0",
      id: req.body?.id,
      error: {
        message: err.message,
        data: err.wwwAuthenticate ? { _meta: { "mcp/www_authenticate": err.wwwAuthenticate } } : undefined
      }
    })
  }
}
