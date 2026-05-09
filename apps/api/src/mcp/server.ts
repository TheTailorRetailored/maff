import type { Request, Response } from "express"
import type { WorkspaceRole } from "@prisma/client"
import { scopes, hasPermission } from "../auth/scopes.js"
import { requireWorkspaceRole } from "../auth/permissions.js"
import { config } from "../config.js"
import { readResource, listResources } from "./resources.js"
import { listWorkspaces, maffBootstrap, startResearchSession, startWorkflow } from "./tools/sessionTools.js"
import { getActiveRoutes, getNeighbors, getOpenGaps, getProblemGraph, getStaleNodes, listProblemGraphs, searchNodes } from "./tools/graphTools.js"
import { appendToNodeTool, createNodeTool, getNode, linkNodesTool, replaceNodeSectionTool, setNodeStatus, updateNodeMetadataTool } from "./tools/nodeTools.js"
import { claimTask, completeTask, createTask, getNextTask, heartbeatTask, releaseTask, snoozeTask } from "./tools/taskTools.js"
import { addInformalProofToClaim, addInlineGapToClaim, addRouteToClaim, appendProofAttemptToClaim, archiveNode, completeWorkflow, computeClaimReadiness, createClaim, createConjecture, createGap, createProblem, createProofRoute, createRichClaim, decomposeClaim, decomposeClaimRich, logProofAttempt, promoteInlineSubclaimToClaim, promoteInlineSubclaimToClaimRich, promoteRouteToNode, researchExtras, updateClaimLeanStatus, updateClaimLeanStatusWithReason, updateClaimMetadata, updateClaimProofStatus, updateClaimRoute } from "./tools/researchTools.js"
import { createFormalizationTarget, createLeanProject, createLeanStub, leanCheck, leanExtras, leanGoal } from "./tools/leanTools.js"
import { quartzStatus, rebuildIndex, rebuildQuartz } from "./tools/siteTools.js"
import { getSkillPack } from "../skills/skillRouter.js"
import { getPrompt, listPrompts } from "./prompts.js"
import * as runtime from "../research/runtime.js"

type ToolContext = { userId: string; claimsScope?: string; permissions?: string[]; aud?: unknown; sub?: string; azp?: string; clientId?: string }
type JsonSchema = Record<string, unknown>

const objectSchema = (properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema => ({ type: "object", properties, required, additionalProperties: false })
const s = { type: "string" } as const
const n = { type: "number" } as const
const anyObj = { type: "object", additionalProperties: true } as const
const strArray = { type: "array", items: s } as const
const strOrArray = { oneOf: [s, strArray] } as const

type ToolDef = { name: string; description: string; scope: string; role: WorkspaceRole; inputSchema: JsonSchema }
const tool = (name: string, description: string, role: WorkspaceRole, inputSchema: JsonSchema, scope = scopes.maffAccess): ToolDef => ({ name, description, scope, role, inputSchema })
export const mcpServerVersion = "0.4.0-co-mathematician-runtime"

export const toolDefinitions: ToolDef[] = [
  tool("list_workspaces", "List workspaces visible to the authenticated user.", "viewer", objectSchema({})),
  tool("create_project", "Create a Maff v2 research project. Projects coordinate approved goals and workstreams; they are not claim-centric Problem nodes.", "editor", objectSchema({ workspace_id: s, title: s, area: s, statement: s, slug: s }, ["workspace_id", "title", "statement"])),
  tool("get_project", "Read a Maff v2 project.", "viewer", objectSchema({ workspace_id: s, project_id: s }, ["workspace_id", "project_id"])),
  tool("list_projects", "List Maff v2 projects in a workspace.", "viewer", objectSchema({ workspace_id: s }, ["workspace_id"])),
  tool("get_project_control_room", "Read the project control room: goals, workstreams, reviews, recent agent runs, key claims, gaps, and suggested next assignment.", "viewer", objectSchema({ workspace_id: s, project_id: s }, ["workspace_id", "project_id"])),
  tool("update_project_summary", "Update the Project Coordinator summary.", "editor", objectSchema({ workspace_id: s, project_id: s, coordinator_summary: s }, ["workspace_id", "project_id", "coordinator_summary"])),
  tool("propose_project_goal", "Propose an explicit project goal for user approval.", "editor", objectSchema({ workspace_id: s, project_id: s, title: s, statement: s, priority: n, success_criteria: strArray, dependencies: strArray }, ["workspace_id", "project_id", "title", "statement"])),
  tool("approve_project_goal", "Approve a proposed project goal so specialist workstreams may attach to it.", "editor", objectSchema({ workspace_id: s, goal_id: s }, ["workspace_id", "goal_id"])),
  tool("update_project_goal", "Patch a project goal.", "editor", objectSchema({ workspace_id: s, goal_id: s, patch: anyObj }, ["workspace_id", "goal_id", "patch"])),
  tool("list_project_goals", "List project goals.", "viewer", objectSchema({ workspace_id: s, project_id: s }, ["workspace_id", "project_id"])),
  tool("create_workstream", "Create a first-class role-bound workstream under an approved goal.", "editor", objectSchema({ workspace_id: s, project_id: s, goal_id: s, parent_workstream_id: s, title: s, kind: s, coordinator_role: s, priority: n, target_object_type: s, target_object_id: s, instructions: s, allowed_writes: strArray, forbidden_actions: strArray, success_criteria: strArray, review_policy: anyObj }, ["workspace_id", "project_id", "title", "kind", "instructions"])),
  tool("list_workstreams", "List Maff v2 workstreams.", "viewer", objectSchema({ workspace_id: s, project_id: s, status: s }, ["workspace_id"])),
  tool("get_workstream", "Read a workstream with reports, reviews, agent runs, messages, and artifacts.", "viewer", objectSchema({ workspace_id: s, workstream_id: s }, ["workspace_id", "workstream_id"])),
  tool("claim_agent_assignment", "Claim the next role-bound workstream assignment and receive a structured agent briefing.", "editor", objectSchema({ workspace_id: s, project_id: s, workstream_id: s, session_id: s, lease_minutes: n }, ["workspace_id", "session_id"])),
  tool("start_agent_run", "Start an AgentRun for a claimed workstream and return the exact briefing.", "editor", objectSchema({ workspace_id: s, workstream_id: s, session_id: s, model: s }, ["workspace_id", "workstream_id", "session_id"])),
  tool("get_agent_briefing", "Return the structured role briefing for a workstream.", "viewer", objectSchema({ workspace_id: s, workstream_id: s }, ["workspace_id", "workstream_id"])),
  tool("write_agent_observation", "Write a durable AgentMessage observation, blocker, handoff, or escalation.", "editor", objectSchema({ workspace_id: s, project_id: s, workstream_id: s, from_role: s, to_role: s, kind: s, body: s, artifact_refs: strArray }, ["workspace_id", "project_id", "from_role", "body"])),
  tool("create_or_update_workstream_report", "Create or update the primary report for a workstream.", "editor", objectSchema({ workspace_id: s, workstream_id: s, title: s, body_markdown: s, uncertainty_notes: strArray, linked_object_refs: strArray, artifact_refs: strArray }, ["workspace_id", "workstream_id", "title", "body_markdown"])),
  tool("submit_workstream_report", "Create/update a WorkstreamReport and submit it for mandatory review.", "editor", objectSchema({ workspace_id: s, workstream_id: s, title: s, body_markdown: s, uncertainty_notes: strArray, linked_object_refs: strArray, artifact_refs: strArray }, ["workspace_id", "workstream_id", "title", "body_markdown"])),
  tool("mark_workstream_blocked", "Mark a workstream blocked with a durable blocker message.", "editor", objectSchema({ workspace_id: s, workstream_id: s, message: s }, ["workspace_id", "workstream_id", "message"])),
  tool("escalate_workstream", "Escalate a workstream to the Project Coordinator.", "editor", objectSchema({ workspace_id: s, workstream_id: s, message: s }, ["workspace_id", "workstream_id", "message"])),
  tool("request_workstream_revision", "Move a reviewed workstream to revision_required.", "editor", objectSchema({ workspace_id: s, workstream_id: s, message: s }, ["workspace_id", "workstream_id", "message"])),
  tool("approve_workstream", "Approve a workstream only after an approved ReviewRound exists.", "editor", objectSchema({ workspace_id: s, workstream_id: s }, ["workspace_id", "workstream_id"])),
  tool("complete_workstream", "Complete a workstream only after its review policy is satisfied.", "editor", objectSchema({ workspace_id: s, workstream_id: s }, ["workspace_id", "workstream_id"])),
  tool("submit_report_for_review", "Submit an existing report for review.", "editor", objectSchema({ workspace_id: s, report_id: s, workstream_id: s }, ["workspace_id"])),
  tool("record_review_round", "Record a mandatory review verdict. Reviewer agents may create ReviewRound records only.", "editor", objectSchema({ workspace_id: s, workstream_id: s, report_id: s, target_object_type: s, target_object_id: s, reviewer_role: s, verdict: s, issues: strArray, required_changes: strArray, checked_refs: strArray, body_markdown: s, created_by_agent_run_id: s }, ["workspace_id", "workstream_id", "verdict", "body_markdown"])),
  tool("list_review_rounds", "List ReviewRound records for a workstream.", "viewer", objectSchema({ workspace_id: s, workstream_id: s }, ["workspace_id", "workstream_id"])),
  tool("get_report", "Read a WorkstreamReport with review history.", "viewer", objectSchema({ workspace_id: s, report_id: s }, ["workspace_id", "report_id"])),
  tool("create_math_object", "Create a typed mathematical object: definition, object, construction, or notation.", "editor", objectSchema({ workspace_id: s, project_id: s, type: s, title: s, statement_markdown: s, status: s, metadata: anyObj }, ["workspace_id", "project_id", "type", "title", "statement_markdown"])),
  tool("update_claim_status", "Update a typed Claim status, enforcing role restrictions such as ProofAttemptAgent cannot mark claims proved.", "editor", objectSchema({ workspace_id: s, claim_id: s, status: s, actor_role: s, reason: s }, ["workspace_id", "claim_id", "status"])),
  tool("create_proof_attempt", "Create a typed ProofAttempt object. Failed attempts are durable first-class records.", "editor", objectSchema({ workspace_id: s, project_id: s, claim_id: s, route_id: s, workstream_id: s, body_markdown: s, status: s, gap_summary: s }, ["workspace_id", "project_id", "claim_id", "body_markdown"])),
  tool("resolve_gap", "Resolve a typed Gap object.", "editor", objectSchema({ workspace_id: s, gap_id: s, suggested_resolution: s }, ["workspace_id", "gap_id"])),
  tool("create_paper", "Create a Paper literature object.", "editor", objectSchema({ workspace_id: s, project_id: s, title: s, authors: strArray, year: n, venue: s, url: s, arxiv_id: s, doi: s, notes_markdown: s }, ["workspace_id", "title"])),
  tool("create_known_result", "Create a KnownResult linked to a paper or project.", "editor", objectSchema({ workspace_id: s, project_id: s, paper_id: s, title: s, statement_markdown: s, applicability_markdown: s, status: s }, ["workspace_id", "title", "statement_markdown", "applicability_markdown"])),
  tool("create_assumption", "Create a typed Assumption object.", "editor", objectSchema({ workspace_id: s, project_id: s, statement_markdown: s, status: s, reason: s, owner: s, discharge_plan: s }, ["workspace_id", "project_id", "statement_markdown", "status", "reason"])),
  tool("create_lean_theorem", "Create a typed LeanTheorem object.", "editor", objectSchema({ workspace_id: s, project_id: s, formalization_target_id: s, lean_name: s, proof_file: s, statement_markdown: s, status: s, has_sorry: { type: "boolean" }, has_axiom: { type: "boolean" } }, ["workspace_id", "project_id", "lean_name", "proof_file", "statement_markdown"])),
  tool("link_objects", "Create a typed GraphEdge between mathematical or coordination objects.", "editor", objectSchema({ workspace_id: s, project_id: s, source_type: s, source_id: s, target_type: s, target_id: s, edge_type: s, metadata: anyObj }, ["workspace_id", "source_type", "source_id", "target_type", "target_id", "edge_type"])),
  tool("get_object_graph", "Read the typed mathematical object graph.", "viewer", objectSchema({ workspace_id: s, project_id: s, source_type: s, source_id: s }, ["workspace_id"])),
  tool("search_research_objects", "Search typed Maff v2 research objects, not just NodeIndex.", "viewer", objectSchema({ workspace_id: s, project_id: s, query: s, type: s }, ["workspace_id"])),
  tool("create_artifact", "Register a durable artifact without arbitrary file writes.", "editor", objectSchema({ workspace_id: s, project_id: s, workstream_id: s, kind: s, title: s, uri: s, path: s, content_hash: s, metadata: anyObj, created_by_agent_run_id: s }, ["workspace_id", "project_id", "title"])),
  tool("maff_bootstrap", "Deprecated compatibility wrapper. Returns get_project_control_room plus claim_agent_assignment when project/workstream ids are supplied; use v2 project/workstream tools directly.", "viewer", objectSchema({ workspace_id: s, project_id: s, workstream_id: s, session_id: s, node_ref: s, user_goal: s, workflow_type: s, mode: s, create_if_missing: { type: "boolean" }, title: s, area: s, rough_statement: s }, [])),
  tool("start_research_session", "Resolve a node or task and return recommended workflow context.", "viewer", objectSchema({ workspace_id: s, node_ref: s, user_goal: s }, ["workspace_id"])),
  tool("start_workflow", "Start a named workflow for a node.", "viewer", objectSchema({ workspace_id: s, workflow_type: s, node_id: s }, ["workspace_id", "workflow_type", "node_id"])),
  tool("list_prompts", "List available Maff workflow prompts. Normally call maff_bootstrap first unless the user explicitly asks for prompt names.", "viewer", objectSchema({})),
  tool("get_prompt", "Read a Maff workflow prompt by name. Normally call maff_bootstrap first unless the user explicitly asks for this exact prompt.", "viewer", objectSchema({ name: s }, ["name"])),
  tool("get_skill_pack", "Return compact skills relevant to a workflow and node.", "viewer", objectSchema({ workspace_id: s, node_id: s, workflow_type: s }, ["workspace_id", "workflow_type"])),
  tool("search_nodes", "Search indexed research nodes.", "viewer", objectSchema({ workspace_id: s, query: s, filters: anyObj }, ["workspace_id"])),
  tool("get_node", "Read a parsed Markdown node.", "viewer", objectSchema({ workspace_id: s, node_id: s }, ["workspace_id", "node_id"])),
  tool("get_neighbors", "Read local graph neighbors for a node.", "viewer", objectSchema({ workspace_id: s, node_id: s, depth: n, edge_types: strArray }, ["workspace_id", "node_id"])),
  tool("list_problem_graphs", "List Problem graph roots in a workspace with summary counts. Use this before opening a graph when the workspace has multiple problems.", "viewer", objectSchema({ workspace_id: s, status_filter: strArray }, ["workspace_id"])),
  tool("get_problem_graph", "Return a problem-scoped claim graph with nodes, edges, and layout hints. Default graph mode is one Problem plus its Claim dependency graph.", "viewer", objectSchema({ workspace_id: s, problem_id: s, mode: s, selected_node_id: s, depth: n, include_archived: { type: "boolean" }, include_tasks: { type: "boolean" }, include_routes: { type: "boolean" }, include_attempts: { type: "boolean" }, include_gaps: { type: "boolean" }, include_body_wikilinks: { type: "boolean" } }, ["workspace_id", "problem_id"])),
  tool("get_open_gaps", "Read open gaps, optionally scoped to a problem or target.", "viewer", objectSchema({ workspace_id: s, problem_id: s }, ["workspace_id"])),
  tool("get_active_routes", "Read active proof routes.", "viewer", objectSchema({ workspace_id: s, problem_id: s }, ["workspace_id"])),
  tool("get_stale_nodes", "Read stale indexed nodes.", "viewer", objectSchema({ workspace_id: s, days: n }, ["workspace_id", "days"])),
  tool("create_node", "Create a safe Markdown node.", "editor", objectSchema({ workspace_id: s, type: s, title: s, metadata: anyObj, body: s }, ["workspace_id", "type", "title"])),
  tool("append_to_node", "Append content to a Markdown section.", "editor", objectSchema({ workspace_id: s, node_id: s, section: s, content: s }, ["workspace_id", "node_id", "section", "content"])),
  tool("replace_node_section", "Replace one Markdown section after backing up the file.", "editor", objectSchema({ workspace_id: s, node_id: s, section: s, content: s }, ["workspace_id", "node_id", "section", "content"])),
  tool("update_node_metadata", "Patch YAML/frontmatter metadata for a node, then reindex it.", "editor", objectSchema({ workspace_id: s, node_id: s, patch: anyObj }, ["workspace_id", "node_id", "patch"])),
  tool("link_nodes", "Add a typed link between nodes.", "editor", objectSchema({ workspace_id: s, source_node_id: s, target_node_id: s, edge_type: s, note: s }, ["workspace_id", "source_node_id", "target_node_id", "edge_type"])),
  tool("set_node_status", "Set node status and append a decision log entry.", "editor", objectSchema({ workspace_id: s, node_id: s, status: s, reason: s }, ["workspace_id", "node_id", "status", "reason"])),
  tool("create_problem", "Create a Problem node.", "editor", objectSchema({ workspace_id: s, title: s, area: s, rough_statement: s, motivation: s, initial_sources: strArray }, ["workspace_id", "title", "area", "rough_statement", "motivation"])),
  tool("create_claim", "Create a typed Maff v2 Claim when project_id is provided. Deprecated compatibility still supports old problem_id Claim node creation.", "editor", objectSchema({ workspace_id: s, project_id: s, problem_id: s, title: s, statement: s, statement_markdown: s, motivation: s, kind: s, claim_kind: s, status: s, actor_role: s, role: s, claim_status: s, proof_status: s, lean_status: s, depends_on: strArray, blocked_by: strArray, area: s, short_title: s, body_sections: anyObj, metadata: anyObj, confidence: n }, ["workspace_id", "title"])),
  tool("create_conjecture", "Alias for create_claim with claim_kind=conjecture.", "editor", objectSchema({ workspace_id: s, problem_id: s, statement: s, motivation: s, confidence: n }, ["workspace_id", "problem_id", "statement", "motivation", "confidence"])),
  tool("create_theorem_candidate", "Alias for create_claim with claim_kind=theorem.", "editor", objectSchema({ workspace_id: s, problem_id: s, statement: s, motivation: s, confidence: n }, ["workspace_id", "statement"])),
  tool("create_lemma_candidate", "Alias for create_claim with claim_kind=lemma.", "editor", objectSchema({ workspace_id: s, problem_id: s, statement: s, motivation: s, confidence: n }, ["workspace_id", "statement"])),
  tool("add_route_to_claim", "Add a structured proof route inside a Claim note. Routes stay inline by default and do not become graph nodes.", "editor", objectSchema({ workspace_id: s, claim_id: s, route_title: s, status: s, confidence: s, method: s, strategy: s, proposed_decomposition: strOrArray, blockers: strOrArray }, ["workspace_id", "claim_id", "route_title", "status", "strategy"])),
  tool("update_claim_route", "Append an update to a structured route inside a Claim note.", "editor", objectSchema({ workspace_id: s, claim_id: s, route_title_or_id: s, patch: anyObj }, ["workspace_id", "claim_id", "route_title_or_id", "patch"])),
  tool("promote_route_to_node", "Promote an inline route to a standalone ProofRoute node only when it is substantial or explicitly requested.", "editor", objectSchema({ workspace_id: s, claim_id: s, route_title_or_id: s, reason: s }, ["workspace_id", "claim_id", "route_title_or_id"])),
  tool("update_claim_metadata", "Patch Claim frontmatter and append a decision-log entry.", "editor", objectSchema({ workspace_id: s, claim_id: s, patch: anyObj }, ["workspace_id", "claim_id", "patch"])),
  tool("update_claim_proof_status", "Deprecated compatibility wrapper. For typed claims use update_claim_status.", "editor", objectSchema({ workspace_id: s, claim_id: s, status: s, actor_role: s, proof_status: s, claim_status: s, reason: s }, ["workspace_id", "claim_id", "reason"])),
  tool("add_informal_proof_to_claim", "Replace the Claim's Informal proof section and update proof status.", "editor", objectSchema({ workspace_id: s, claim_id: s, proof: s, remaining_caveats: strArray }, ["workspace_id", "claim_id", "proof"])),
  tool("update_claim_lean_status", "Update the Claim's Lean formalization section and Lean metadata.", "editor", objectSchema({ workspace_id: s, claim_id: s, lean_status: s, lean_file: s, lean_name: s, diagnostics: s, notes: s, reason: s }, ["workspace_id", "claim_id", "lean_status"])),
  tool("decompose_claim", "Decompose a Claim into inline subclaims and/or new supporting Claim nodes.", "editor", objectSchema({ workspace_id: s, claim_id: s, route_title_or_id: s, subclaims: { type: "array", items: anyObj } }, ["workspace_id", "claim_id", "subclaims"])),
  tool("promote_inline_subclaim_to_claim", "Promote a nontrivial inline subclaim to its own Claim node and link it as a dependency.", "editor", objectSchema({ workspace_id: s, parent_claim_id: s, section: s, item_text: s, title: s, statement: s, claim_kind: s, role: s, reason: s }, ["workspace_id", "parent_claim_id", "title", "statement"])),
  tool("append_proof_attempt_to_claim", "Append a proof attempt inside a Claim or route section. ProofAttempt nodes are not created by default.", "editor", objectSchema({ workspace_id: s, claim_id: s, route_title_or_id: s, summary: s, result: s, details: s, next_steps: strArray }, ["workspace_id", "claim_id", "summary", "result"])),
  tool("add_inline_gap_to_claim", "Append a minor or local gap inside a Claim. Major blockers should become Claim nodes when they are clean mathematical statements.", "editor", objectSchema({ workspace_id: s, claim_id: s, route_title_or_id: s, severity: s, statement: s, possible_resolutions: strArray }, ["workspace_id", "claim_id", "severity", "statement"])),
  tool("compute_claim_readiness", "Compute proof/Lean readiness for a Claim.", "viewer", objectSchema({ workspace_id: s, claim_id: s }, ["workspace_id", "claim_id"])),
  tool("create_proof_route", "Create a typed ProofRoute when project_id is provided. Deprecated compatibility can still append an inline route to an old Claim node.", "editor", objectSchema({ workspace_id: s, project_id: s, claim_id: s, target_node_id: s, title: s, method: s, strategy_markdown: s, plan: s, required_lemmas: strArray, first_testable_step: s, kill_condition: s, status: s, created_by_workstream_id: s, workstream_id: s }, ["workspace_id", "kill_condition"])),
  tool("log_proof_attempt", "Create a typed ProofAttempt when project_id is provided. Deprecated compatibility can still append an attempt to an old Claim node.", "editor", objectSchema({ workspace_id: s, project_id: s, claim_id: s, target_node_id: s, route_id: s, route_node_id: s, workstream_id: s, body_markdown: s, summary: s, status: s, result: s, gap_summary: s, failure_reason: s, new_gaps: strArray }, ["workspace_id"])),
  tool("create_gap", "Create a typed Gap when project_id is provided. Deprecated compatibility can still append an inline gap to an old Claim node.", "editor", objectSchema({ workspace_id: s, project_id: s, claim_id: s, target_node_id: s, proof_attempt_id: s, route_id: s, title: s, description_markdown: s, statement: s, severity: s, status: s, suggested_resolution: s, possible_resolutions: strArray }, ["workspace_id", "severity"])),
  tool("create_task", "Create an operational queue task attached to a target node or section. Tasks do not appear as graph nodes.", "editor", objectSchema({ workspace_id: s, target_node_id: s, target_section: s, workflow: s, workflow_type: s, title: s, priority: n, instructions: s }, ["workspace_id", "target_node_id", "priority", "instructions"])),
  tool("get_next_task", "Read the next queued task, optionally scoped to a target node.", "viewer", objectSchema({ workspace_id: s, target_node_id: s }, ["workspace_id"])),
  tool("claim_task", "Claim a task with a lease. Normally call maff_bootstrap first unless the user explicitly supplied a workspace_id/task_id and requested this exact operation.", "editor", objectSchema({ workspace_id: s, task_id: s, claimed_session_id: s, workflow: s }, ["workspace_id"])),
  tool("heartbeat_task", "Extend a claimed task lease. Normally call maff_bootstrap first unless the user explicitly supplied a workspace_id/task_id and requested this exact operation.", "editor", objectSchema({ workspace_id: s, task_id: s, claimed_session_id: s, workflow: s }, ["workspace_id", "task_id"])),
  tool("complete_task", "Complete a task.", "editor", objectSchema({ workspace_id: s, task_id: s, claimed_session_id: s, outcome_summary: s }, ["workspace_id", "task_id", "outcome_summary"])),
  tool("release_task", "Release a claimed task back to the open queue. Normally call maff_bootstrap first unless the user explicitly supplied a workspace_id/task_id and requested this exact operation.", "editor", objectSchema({ workspace_id: s, task_id: s, claimed_session_id: s, reason: s }, ["workspace_id", "task_id"])),
  tool("snooze_task", "Snooze a task.", "editor", objectSchema({ workspace_id: s, task_id: s, reason: s, until: s }, ["workspace_id", "task_id", "reason"])),
  tool("archive_node", "Safely archive a node by marking it archived/killed and appending a decision-log entry. This is not a hard delete.", "editor", objectSchema({ workspace_id: s, node_id: s, reason: s }, ["workspace_id", "node_id", "reason"])),
  tool("complete_workflow", "Deprecated. Fails with guidance unless a workstream_id is supplied and the v2 review gate has passed.", "editor", objectSchema({ workspace_id: s, workstream_id: s, node_id: s, workflow_type: s, summary: s, graph_updates: anyObj }, ["workspace_id"])),
  tool("create_counterexample", "Create a Counterexample node. Normally call maff_bootstrap first unless the user explicitly supplied a workspace_id/node_id and requested this exact operation.", "editor", objectSchema({ workspace_id: s, target_node_id: s, construction: s, explanation: s, artifacts: strArray }, ["workspace_id", "target_node_id", "construction", "explanation"])),
  tool("create_experiment", "Create an Experiment node. Normally call maff_bootstrap first unless the user explicitly supplied a workspace_id/node_id and requested this exact operation.", "editor", objectSchema({ workspace_id: s, problem_id: s, title: s, hypothesis: s, code_ref: s, parameters: anyObj }, ["workspace_id", "problem_id", "title", "hypothesis"])),
  tool("log_experiment_result", "Log an Experiment result. Normally call maff_bootstrap first unless the user explicitly supplied a workspace_id/experiment_id and requested this exact operation.", "editor", objectSchema({ workspace_id: s, experiment_id: s, result_summary: s, artifacts: strArray, implications: s }, ["workspace_id", "experiment_id", "result_summary"])),
  tool("create_literature_source", "Create a Paper literature source node. Normally call maff_bootstrap first unless the user explicitly supplied a workspace_id and requested this exact operation.", "editor", objectSchema({ workspace_id: s, title: s, authors: strArray, year: n, citation: s, relevance: s, notes: s }, ["workspace_id", "title", "authors", "year", "citation", "relevance", "notes"])),
  tool("mark_claim_novelty", "Append a novelty verdict to a claim. Normally call maff_bootstrap first unless the user explicitly supplied a workspace_id/claim_id and requested this exact operation.", "editor", objectSchema({ workspace_id: s, claim_id: s, novelty_status: s, evidence: s }, ["workspace_id", "claim_id", "novelty_status", "evidence"])),
  tool("promote_to_theorem_candidate", "Promote a conjecture toward theorem-candidate status. Normally call maff_bootstrap first unless the user explicitly supplied ids and requested this exact operation.", "editor", objectSchema({ workspace_id: s, conjecture_id: s, theorem_statement: s, reason: s }, ["workspace_id", "conjecture_id", "reason"])),
  tool("promote_to_informal_proof", "Create an InformalProof node from a proof candidate. Normally call maff_bootstrap first unless the user explicitly supplied ids and requested this exact operation.", "editor", objectSchema({ workspace_id: s, claim_id: s, proof_node_body: s, remaining_caveats: strArray }, ["workspace_id", "claim_id", "proof_node_body"])),
  tool("pause_project", "Pause a project without deleting it. Normally call maff_bootstrap first unless the user explicitly supplied ids and requested this exact operation.", "owner", objectSchema({ workspace_id: s, node_id: s, reason: s, revival_trigger: s }, ["workspace_id", "node_id", "reason", "revival_trigger"])),
  tool("kill_project", "Mark a project killed without deleting it. Normally call maff_bootstrap first unless the user explicitly supplied ids and requested this exact operation.", "owner", objectSchema({ workspace_id: s, node_id: s, reason: s, salvage_value: s }, ["workspace_id", "node_id", "reason", "salvage_value"])),
  tool("rebuild_index", "Rebuild a workspace index.", "editor", objectSchema({ workspace_id: s }, ["workspace_id"])),
  tool("rebuild_quartz_site", "Build a workspace Quartz site.", "editor", objectSchema({ workspace_id: s }, ["workspace_id"])),
  tool("get_quartz_site_status", "Read latest Quartz build status.", "viewer", objectSchema({ workspace_id: s }, ["workspace_id"])),
  tool("create_formalization_target", "Create a typed FormalizationTarget when project_id is provided. Deprecated compatibility can still create a Markdown node.", "editor", objectSchema({ workspace_id: s, project_id: s, claim_id: s, proof_attempt_id: s, statement_markdown: s, informal_proof_id: s, feasibility: s, lean_feasibility: s, required_definitions: strArray, theorem_stub: s, status: s }, ["workspace_id"])),
  tool("create_lean_project", "Create a Lean project.", "editor", objectSchema({ workspace_id: s, project_name: s }, ["workspace_id", "project_name"])),
  tool("create_lean_stub", "Create a Lean theorem file and LeanTheorem node.", "editor", objectSchema({ workspace_id: s, formalization_target_id: s, theorem_statement: s, imports: strArray }, ["workspace_id", "formalization_target_id", "theorem_statement"])),
  tool("lean_check", "Run the Lean worker check for a typed LeanTheorem or deprecated LeanTheorem node.", "editor", objectSchema({ workspace_id: s, lean_theorem_id: s, lean_file_id: s }, ["workspace_id"])),
  tool("lean_goal", "Read a Lean goal if supported.", "editor", objectSchema({ workspace_id: s, lean_file_id: s, position: anyObj }, ["workspace_id", "lean_file_id", "position"])),
  tool("lean_search_mathlib", "Search Mathlib or local notes for formalization hints.", "viewer", objectSchema({ workspace_id: s, query: s }, ["workspace_id", "query"])),
  tool("lean_multi_attempt", "Try multiple Lean tactics if supported by the worker. Normally call maff_bootstrap first unless the user explicitly supplied Lean ids.", "editor", objectSchema({ workspace_id: s, lean_file_id: s, position: anyObj, tactics: strArray }, ["workspace_id", "lean_file_id", "position", "tactics"])),
  tool("log_lean_attempt", "Log a Lean formalization attempt. Normally call maff_bootstrap first unless the user explicitly supplied formalization ids.", "editor", objectSchema({ workspace_id: s, formalization_target_id: s, result: s, diagnostics: anyObj, next_gap: s }, ["workspace_id", "formalization_target_id", "result", "diagnostics"])),
  tool("mark_lean_verified", "Conservatively mark a typed LeanTheorem verified only if latest check succeeds and no sorry/axiom/unproved assumptions remain.", "editor", objectSchema({ workspace_id: s, lean_theorem_id: s, lean_theorem_node_id: s, file_ref: s, theorem_name: s }, ["workspace_id"])),
  tool("create_assumption_entry", "Create a formalization assumption or axiom hygiene entry. Normally call maff_bootstrap first unless the user explicitly requested this exact operation.", "editor", objectSchema({ workspace_id: s, statement: s, reason: s, status: s }, ["workspace_id", "statement", "reason", "status"])),
  tool("create_local_theorem_library_entry", "Create a local Lean theorem library entry. Normally call maff_bootstrap first unless the user explicitly requested this exact operation.", "editor", objectSchema({ workspace_id: s, lean_theorem_name: s, statement: s, proof_file: s }, ["workspace_id", "lean_theorem_name", "statement", "proof_file"]))
]

const toolByName = new Map(toolDefinitions.map((definition) => [definition.name, definition]))

function wwwAuthenticate(required: string) {
  return `Bearer resource_metadata="${config.publicBaseUrl}/.well-known/oauth-protected-resource", error="insufficient_scope", error_description="Missing required scope ${required}", scope="${required}"`
}

function insufficientScopeError(required: string, ctx: ToolContext, toolName: string) {
  console.warn("MCP missing scope", { required, scope: ctx.claimsScope, permissions: ctx.permissions, aud: ctx.aud, sub: ctx.sub, azp: ctx.azp, client_id: ctx.clientId, tool: toolName })
  return Object.assign(new Error(`Missing required scope ${required}`), { status: 403, required, wwwAuthenticate: wwwAuthenticate(required) })
}

async function authorize(ctx: ToolContext, toolName: string, workspaceId?: string) {
  const definition = toolByName.get(toolName)
  const required = definition?.scope ?? scopes.maffAccess
  if (!hasPermission({ scopeText: ctx.claimsScope, permissions: ctx.permissions, required })) {
    throw insufficientScopeError(required, ctx, toolName)
  }
  if (workspaceId) await requireWorkspaceRole(ctx.userId, workspaceId, definition?.role ?? "viewer")
}

function workspaceIdFrom(args: any) {
  return args?.workspace_id ?? args?.workspaceId
}

async function callTool(toolName: string, args: any, ctx: ToolContext) {
  await authorize(ctx, toolName, workspaceIdFrom(args))
  const workspaceId = workspaceIdFrom(args)
  const userId = ctx.userId
  switch (toolName) {
    case "list_workspaces": return runtime.listWorkspacesForUser(userId)
    case "create_project": return runtime.createProject({ workspaceId, title: args.title, area: args.area, statement: args.statement, slug: args.slug, userId })
    case "get_project": return runtime.getProject(workspaceId, args.project_id)
    case "list_projects": return runtime.listProjects(workspaceId)
    case "get_project_control_room": return runtime.getProjectControlRoom(workspaceId, args.project_id)
    case "update_project_summary": return runtime.updateProjectSummary({ workspaceId, projectId: args.project_id, coordinatorSummary: args.coordinator_summary })
    case "propose_project_goal": return runtime.proposeProjectGoal({ workspaceId, projectId: args.project_id, title: args.title, statement: args.statement, priority: args.priority, successCriteria: args.success_criteria, dependencies: args.dependencies })
    case "approve_project_goal": return runtime.approveProjectGoal({ workspaceId, goalId: args.goal_id, userId })
    case "update_project_goal": return runtime.updateProjectGoal({ workspaceId, goalId: args.goal_id, patch: args.patch, userId })
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
    case "record_review_round": return runtime.recordReviewRound({ workspaceId, workstreamId: args.workstream_id, reportId: args.report_id, targetObjectType: args.target_object_type, targetObjectId: args.target_object_id, reviewerRole: args.reviewer_role, verdict: args.verdict, issues: args.issues, requiredChanges: args.required_changes, checkedRefs: args.checked_refs, bodyMarkdown: args.body_markdown, createdByAgentRunId: args.created_by_agent_run_id })
    case "list_review_rounds": return runtime.listReviewRounds(workspaceId, args.workstream_id)
    case "get_report": return runtime.getReport(workspaceId, args.report_id)
    case "create_math_object": return runtime.createMathObject({ workspaceId, projectId: args.project_id, type: args.type, title: args.title, statementMarkdown: args.statement_markdown, status: args.status, metadata: args.metadata })
    case "update_claim_status": return runtime.updateClaimStatus({ workspaceId, claimId: args.claim_id, status: args.status, actorRole: args.actor_role, reason: args.reason })
    case "resolve_gap": return runtime.resolveGap({ workspaceId, gapId: args.gap_id, suggestedResolution: args.suggested_resolution })
    case "create_paper": return runtime.createPaper({ workspaceId, projectId: args.project_id, title: args.title, authors: args.authors, year: args.year, venue: args.venue, url: args.url, arxivId: args.arxiv_id, doi: args.doi, notesMarkdown: args.notes_markdown })
    case "create_known_result": return runtime.createKnownResult({ workspaceId, projectId: args.project_id, paperId: args.paper_id, title: args.title, statementMarkdown: args.statement_markdown, applicabilityMarkdown: args.applicability_markdown, status: args.status })
    case "create_assumption": return runtime.createAssumption({ workspaceId, projectId: args.project_id, statementMarkdown: args.statement_markdown, status: args.status, reason: args.reason, owner: args.owner, dischargePlan: args.discharge_plan })
    case "create_lean_theorem": return runtime.createLeanTheorem({ workspaceId, projectId: args.project_id, formalizationTargetId: args.formalization_target_id, leanName: args.lean_name, proofFile: args.proof_file, statementMarkdown: args.statement_markdown, status: args.status, hasSorry: args.has_sorry, hasAxiom: args.has_axiom })
    case "link_objects": return runtime.linkObjects({ workspaceId, projectId: args.project_id, sourceType: args.source_type, sourceId: args.source_id, targetType: args.target_type, targetId: args.target_id, edgeType: args.edge_type, metadata: args.metadata })
    case "get_object_graph": return runtime.getObjectGraph({ workspaceId, projectId: args.project_id, sourceType: args.source_type, sourceId: args.source_id })
    case "search_research_objects": return runtime.searchResearchObjects({ workspaceId, projectId: args.project_id, query: args.query, type: args.type })
    case "create_artifact": return runtime.createArtifact({ workspaceId, projectId: args.project_id, workstreamId: args.workstream_id, kind: args.kind, title: args.title, uri: args.uri, path: args.path, contentHash: args.content_hash, metadata: args.metadata, createdByAgentRunId: args.created_by_agent_run_id })
    case "maff_bootstrap": return args.project_id ? { control_room: await runtime.getProjectControlRoom(workspaceId, args.project_id), assignment: args.session_id ? await runtime.claimAgentAssignment({ workspaceId, projectId: args.project_id, workstreamId: args.workstream_id, sessionId: args.session_id, userId }) : null, deprecated: "maff_bootstrap is deprecated; use get_project_control_room and claim_agent_assignment." } : maffBootstrap({ userId, workspaceId, nodeRef: args.node_ref, userGoal: args.user_goal, workflowType: args.workflow_type, mode: args.mode, createIfMissing: args.create_if_missing, title: args.title, area: args.area, roughStatement: args.rough_statement })
    case "start_research_session": return startResearchSession({ userId, workspaceId, nodeRef: args.node_ref, userGoal: args.user_goal })
    case "start_workflow": return args.project_id ? runtime.createWorkstream({ workspaceId, projectId: args.project_id, goalId: args.goal_id, title: args.title ?? `Workflow: ${args.workflow_type}`, kind: args.workflow_type, instructions: args.instructions ?? `Deprecated start_workflow wrapper for ${args.workflow_type}` }) : startWorkflow(workspaceId, args.node_id, args.workflow_type)
    case "list_prompts": return { prompts: await listPrompts() }
    case "get_prompt": return { name: args.name, text: await getPrompt(args.name) }
    case "get_skill_pack": return getSkillPack(workspaceId, args.node_id, args.workflow_type)
    case "search_nodes": return searchNodes(workspaceId, args.query, args.filters)
    case "get_node": return getNode(workspaceId, args.node_id)
    case "get_neighbors": return getNeighbors(workspaceId, args.node_id, args.depth, args.edge_types)
    case "list_problem_graphs": return listProblemGraphs(workspaceId, args.status_filter)
    case "get_problem_graph": return getProblemGraph({ workspaceId, problemId: args.problem_id, mode: args.mode, selectedNodeId: args.selected_node_id, depth: args.depth, includeArchived: args.include_archived, includeTasks: args.include_tasks, includeRoutes: args.include_routes, includeAttempts: args.include_attempts, includeGaps: args.include_gaps, includeBodyWikilinks: args.include_body_wikilinks })
    case "get_open_gaps": return getOpenGaps(workspaceId, args.problem_id)
    case "get_active_routes": return getActiveRoutes(workspaceId, args.problem_id)
    case "get_stale_nodes": return getStaleNodes(workspaceId, args.days)
    case "create_node": return createNodeTool({ workspaceId, type: args.type, title: args.title, metadata: args.metadata, body: args.body, userId })
    case "update_node_metadata": return updateNodeMetadataTool({ workspaceId, nodeId: args.node_id, patch: args.patch, userId })
    case "append_to_node": return appendToNodeTool({ workspaceId, nodeId: args.node_id, section: args.section, content: args.content, userId })
    case "replace_node_section": return replaceNodeSectionTool({ workspaceId, nodeId: args.node_id, section: args.section, content: args.content, userId })
    case "link_nodes": return linkNodesTool({ workspaceId, sourceNodeId: args.source_node_id, targetNodeId: args.target_node_id, edgeType: args.edge_type, note: args.note, userId })
    case "set_node_status": return setNodeStatus({ workspaceId, nodeId: args.node_id, status: args.status, reason: args.reason, userId })
    case "create_problem": return createProblem({ workspaceId, title: args.title, area: args.area, roughStatement: args.rough_statement, motivation: args.motivation, initialSources: args.initial_sources, userId })
    case "create_claim": return args.project_id ? runtime.createClaim({ workspaceId, projectId: args.project_id, title: args.title, statementMarkdown: args.statement_markdown ?? args.statement, kind: args.claim_kind ?? args.kind, status: args.status ?? args.claim_status, confidence: args.confidence, metadata: args.metadata, actorRole: args.actor_role }) : createRichClaim({ workspaceId, problemId: args.problem_id, title: args.title, statement: args.statement, claimKind: args.claim_kind, role: args.role, claimStatus: args.claim_status, proofStatus: args.proof_status, leanStatus: args.lean_status, dependsOn: args.depends_on, blockedBy: args.blocked_by, area: args.area, shortTitle: args.short_title, bodySections: args.body_sections, userId })
    case "create_conjecture": return createConjecture({ workspaceId, problemId: args.problem_id, statement: args.statement, motivation: args.motivation, confidence: args.confidence, userId })
    case "create_theorem_candidate": return createClaim({ workspaceId, problemId: args.problem_id, statement: args.statement, motivation: args.motivation, claimKind: "theorem", role: "main_result", confidence: args.confidence, userId })
    case "create_lemma_candidate": return createClaim({ workspaceId, problemId: args.problem_id, statement: args.statement, motivation: args.motivation, claimKind: "lemma", role: "supporting_lemma", confidence: args.confidence, userId })
    case "add_route_to_claim": return addRouteToClaim({ workspaceId, claimId: args.claim_id, routeTitle: args.route_title, status: args.status, confidence: args.confidence, method: args.method, strategy: args.strategy, proposedDecomposition: args.proposed_decomposition, blockers: args.blockers, userId })
    case "update_claim_route": return updateClaimRoute({ workspaceId, claimId: args.claim_id, routeTitleOrId: args.route_title_or_id, patch: args.patch, userId })
    case "promote_route_to_node": return promoteRouteToNode({ workspaceId, claimId: args.claim_id, routeTitleOrId: args.route_title_or_id, reason: args.reason, userId })
    case "update_claim_metadata": return updateClaimMetadata({ workspaceId, claimId: args.claim_id, patch: args.patch, userId })
    case "update_claim_proof_status": return args.status ? runtime.updateClaimStatus({ workspaceId, claimId: args.claim_id, status: args.status, actorRole: args.actor_role, reason: args.reason }) : updateClaimProofStatus({ workspaceId, claimId: args.claim_id, proofStatus: args.proof_status, claimStatus: args.claim_status, reason: args.reason, userId })
    case "add_informal_proof_to_claim": return addInformalProofToClaim({ workspaceId, claimId: args.claim_id, proof: args.proof, remainingCaveats: args.remaining_caveats, userId })
    case "update_claim_lean_status": return args.reason && !args.diagnostics && !args.notes ? updateClaimLeanStatusWithReason({ workspaceId, claimId: args.claim_id, leanStatus: args.lean_status, leanFile: args.lean_file, leanName: args.lean_name, reason: args.reason, userId }) : updateClaimLeanStatus({ workspaceId, claimId: args.claim_id, leanStatus: args.lean_status, leanFile: args.lean_file, leanName: args.lean_name, diagnostics: args.diagnostics, notes: args.notes ?? args.reason, userId })
    case "decompose_claim": return Array.isArray(args.subclaims) && args.subclaims.some((item: unknown) => typeof item === "object") ? decomposeClaimRich({ workspaceId, claimId: args.claim_id, routeTitleOrId: args.route_title_or_id, subclaims: args.subclaims, userId }) : decomposeClaim({ workspaceId, claimId: args.claim_id, subclaims: args.subclaims, userId })
    case "promote_inline_subclaim_to_claim": return args.title ? promoteInlineSubclaimToClaimRich({ workspaceId, parentClaimId: args.parent_claim_id, section: args.section, itemText: args.item_text, title: args.title, statement: args.statement, claimKind: args.claim_kind, role: args.role, reason: args.reason, userId }) : promoteInlineSubclaimToClaim({ workspaceId, parentClaimId: args.parent_claim_id, statement: args.statement, role: args.role, userId })
    case "append_proof_attempt_to_claim": return appendProofAttemptToClaim({ workspaceId, claimId: args.claim_id, routeTitleOrId: args.route_title_or_id, summary: args.summary, result: args.result, details: args.details, nextSteps: args.next_steps, userId })
    case "add_inline_gap_to_claim": return addInlineGapToClaim({ workspaceId, claimId: args.claim_id, routeTitleOrId: args.route_title_or_id, severity: args.severity, statement: args.statement, possibleResolutions: args.possible_resolutions, userId })
    case "compute_claim_readiness": return computeClaimReadiness({ workspaceId, claimId: args.claim_id })
    case "create_proof_route": return args.project_id ? runtime.createProofRoute({ workspaceId, projectId: args.project_id, claimId: args.claim_id ?? args.target_node_id, title: args.title ?? args.method, strategyMarkdown: args.strategy_markdown ?? args.plan, requiredLemmas: args.required_lemmas, firstTestableStep: args.first_testable_step, killCondition: args.kill_condition, status: args.status, createdByWorkstreamId: args.created_by_workstream_id ?? args.workstream_id }) : createProofRoute({ workspaceId, targetNodeId: args.target_node_id, method: args.method, plan: args.plan, killCondition: args.kill_condition, userId })
    case "log_proof_attempt": return args.project_id ? runtime.createProofAttempt({ workspaceId, projectId: args.project_id, claimId: args.claim_id ?? args.target_node_id, routeId: args.route_id ?? args.route_node_id, workstreamId: args.workstream_id, bodyMarkdown: args.body_markdown ?? args.summary, status: args.status ?? args.result, gapSummary: args.gap_summary ?? args.failure_reason }) : logProofAttempt({ workspaceId, targetNodeId: args.target_node_id, routeNodeId: args.route_node_id, summary: args.summary, result: args.result, failureReason: args.failure_reason, newGaps: args.new_gaps, userId })
    case "create_proof_attempt": return runtime.createProofAttempt({ workspaceId, projectId: args.project_id, claimId: args.claim_id, routeId: args.route_id, workstreamId: args.workstream_id, bodyMarkdown: args.body_markdown, status: args.status, gapSummary: args.gap_summary })
    case "create_gap": return args.project_id ? runtime.createGap({ workspaceId, projectId: args.project_id, claimId: args.claim_id ?? args.target_node_id, proofAttemptId: args.proof_attempt_id, routeId: args.route_id, title: args.title ?? args.statement?.slice?.(0, 72) ?? "Gap", descriptionMarkdown: args.description_markdown ?? args.statement, severity: args.severity, status: args.status, suggestedResolution: args.suggested_resolution }) : createGap({ workspaceId, targetNodeId: args.target_node_id, statement: args.statement, severity: args.severity, possibleResolutions: args.possible_resolutions ?? [], userId })
    case "create_task": return args.project_id ? runtime.createWorkstream({ workspaceId, projectId: args.project_id, goalId: args.goal_id, title: args.title, kind: args.workflow_type ?? args.workflow, priority: args.priority, targetObjectId: args.target_node_id, instructions: args.instructions }) : createTask({ workspaceId, targetNodeId: args.target_node_id, targetSection: args.target_section, workflowType: args.workflow_type ?? args.workflow, title: args.title, priority: args.priority, instructions: args.instructions, userId })
    case "get_next_task": return getNextTask(workspaceId, args.target_node_id)
    case "claim_task": return claimTask(workspaceId, args.task_id, userId, args.claimed_session_id, args.workflow)
    case "heartbeat_task": return heartbeatTask(workspaceId, args.task_id, args.workflow, args.claimed_session_id)
    case "complete_task": return completeTask(workspaceId, args.task_id, args.outcome_summary, args.claimed_session_id)
    case "release_task": return releaseTask(workspaceId, args.task_id, args.claimed_session_id)
    case "snooze_task": return snoozeTask(workspaceId, args.task_id, args.reason, args.until)
    case "archive_node": return archiveNode({ workspaceId, nodeId: args.node_id, reason: args.reason, userId })
    case "complete_workflow": return args.workstream_id ? runtime.completeWorkstream({ workspaceId, workstreamId: args.workstream_id }) : { ok: false, deprecated: true, message: "complete_workflow is deprecated in Maff v2. Create or submit a WorkstreamReport, record ReviewRound approval, then call complete_workstream." }
    case "rebuild_index": return rebuildIndex(workspaceId, userId)
    case "rebuild_quartz_site": return rebuildQuartz(workspaceId, userId)
    case "get_quartz_site_status": return quartzStatus(workspaceId)
    case "create_formalization_target": return args.project_id ? runtime.createFormalizationTarget({ workspaceId, projectId: args.project_id, claimId: args.claim_id, proofAttemptId: args.proof_attempt_id, statementMarkdown: args.statement_markdown ?? args.theorem_statement, theoremStub: args.theorem_stub, requiredDefinitions: args.required_definitions, feasibility: args.feasibility ?? args.lean_feasibility, status: args.status }) : createFormalizationTarget({ workspaceId, informalProofId: args.informal_proof_id, leanFeasibility: args.lean_feasibility, requiredDefinitions: args.required_definitions, theoremStub: args.theorem_stub, userId })
    case "create_lean_project": return createLeanProject({ workspaceId, projectName: args.project_name })
    case "create_lean_stub": return createLeanStub({ workspaceId, formalizationTargetId: args.formalization_target_id, theoremStatement: args.theorem_statement, imports: args.imports, userId })
    case "lean_check": return leanCheck({ workspaceId, leanTheoremId: args.lean_theorem_id, leanFileId: args.lean_file_id, userId })
    case "lean_goal": return leanGoal({ workspaceId, leanFileId: args.lean_file_id, position: args.position })
    case "create_counterexample": return args.project_id ? runtime.createCounterexample({ workspaceId, projectId: args.project_id, claimId: args.claim_id ?? args.target_node_id, title: args.title, constructionMarkdown: args.construction_markdown ?? args.construction, status: args.status, verificationArtifactId: args.verification_artifact_id }) : researchExtras.create_counterexample({ workspaceId, targetNodeId: args.target_node_id, construction: args.construction, explanation: args.explanation, artifacts: args.artifacts, userId })
    case "create_experiment": return args.project_id ? runtime.createExperiment({ workspaceId, projectId: args.project_id, workstreamId: args.workstream_id, title: args.title, hypothesisMarkdown: args.hypothesis_markdown ?? args.hypothesis, methodMarkdown: args.method_markdown ?? args.code_ref, resultMarkdown: args.result_markdown, reproducibility: args.reproducibility ?? args.parameters, status: args.status }) : researchExtras.create_experiment({ workspaceId, problemId: args.problem_id, title: args.title, hypothesis: args.hypothesis, codeRef: args.code_ref, parameters: args.parameters, userId })
    case "log_experiment_result": return researchExtras.log_experiment_result({ workspaceId, experimentId: args.experiment_id, resultSummary: args.result_summary, artifacts: args.artifacts, implications: args.implications, userId })
    case "create_literature_source": return researchExtras.create_literature_source({ workspaceId, title: args.title, authors: args.authors, year: args.year, citation: args.citation, relevance: args.relevance, notes: args.notes, userId })
    case "mark_claim_novelty": return researchExtras.mark_claim_novelty({ workspaceId, claimId: args.claim_id, noveltyStatus: args.novelty_status, evidence: args.evidence, userId })
    case "promote_to_theorem_candidate": return researchExtras.promote_to_theorem_candidate({ workspaceId, conjectureId: args.conjecture_id, theoremStatement: args.theorem_statement, reason: args.reason, userId })
    case "promote_to_informal_proof": return researchExtras.promote_to_informal_proof({ workspaceId, claimId: args.claim_id, proofNodeBody: args.proof_node_body, remainingCaveats: args.remaining_caveats, userId })
    case "pause_project": return researchExtras.pause_project({ workspaceId, nodeId: args.node_id, reason: args.reason, revivalTrigger: args.revival_trigger, userId })
    case "kill_project": return researchExtras.kill_project({ workspaceId, nodeId: args.node_id, reason: args.reason, salvageValue: args.salvage_value, userId })
    case "lean_search_mathlib": return leanExtras.lean_search_mathlib({ workspaceId, query: args.query })
    case "lean_multi_attempt": return leanExtras.lean_multi_attempt()
    case "log_lean_attempt": return leanExtras.log_lean_attempt({ workspaceId, formalizationTargetId: args.formalization_target_id, result: args.result, diagnostics: args.diagnostics, nextGap: args.next_gap, userId })
    case "mark_lean_verified": return args.lean_theorem_id ? runtime.markLeanVerified({ workspaceId, leanTheoremId: args.lean_theorem_id }) : leanExtras.mark_lean_verified({ workspaceId, leanTheoremNodeId: args.lean_theorem_node_id, fileRef: args.file_ref, theoremName: args.theorem_name, userId })
    case "create_assumption_entry": return leanExtras.create_assumption_entry({ workspaceId, statement: args.statement, reason: args.reason, status: args.status, userId })
    case "create_local_theorem_library_entry": return leanExtras.create_local_theorem_library_entry({ workspaceId, leanTheoremName: args.lean_theorem_name, statement: args.statement, proofFile: args.proof_file, userId })
    default: throw new Error(`Unknown tool: ${toolName}`)
  }
}

function contentResult(value: unknown) {
  return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] }
}

function resourceResult(uri: string, value: unknown) {
  return { contents: [{ uri, mimeType: "application/json", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] }
}

function toolForList(definition: ToolDef) {
  const securitySchemes = [{ type: "oauth2", scopes: [definition.scope] }]
  return {
    name: definition.name,
    description: definition.description,
    inputSchema: definition.inputSchema,
    input_schema: definition.inputSchema,
    securitySchemes,
    _meta: { securitySchemes }
  }
}

export function mcpToolsListResult() {
  return { tools: toolDefinitions.map(toolForList) }
}

export async function mcpHandler(req: Request, res: Response) {
  try {
    if (!req.auth) return res.status(401).json({ error: "missing_token" })
    const { id, method, params } = req.body ?? {}
    const ctx: ToolContext = {
      userId: req.auth.user.id,
      claimsScope: req.auth.claims.scope,
      permissions: req.auth.claims.permissions,
      aud: req.auth.claims.aud,
      sub: req.auth.claims.sub,
      azp: typeof req.auth.claims.azp === "string" ? req.auth.claims.azp : undefined,
      clientId: typeof req.auth.claims.client_id === "string" ? req.auth.claims.client_id : undefined
    }
    const resourceCtx = { userId: req.auth.user.id, claims: req.auth.claims }
    if (method === "initialize") return res.json({ jsonrpc: "2.0", id, result: { protocolVersion: "2024-11-05", serverInfo: { name: "Maff", version: mcpServerVersion }, capabilities: { tools: { listChanged: true }, resources: {}, prompts: {} } } })
    if (method === "tools/list") return res.json({ jsonrpc: "2.0", id, result: mcpToolsListResult() })
    if (method === "tools/call") return res.json({ jsonrpc: "2.0", id, result: contentResult(await callTool(params.name, params.arguments ?? {}, ctx)) })
    if (method === "resources/list") return res.json({ jsonrpc: "2.0", id, result: await listResources(resourceCtx) })
    if (method === "resources/read") return res.json({ jsonrpc: "2.0", id, result: resourceResult(params.uri, await readResource(params.uri, resourceCtx)) })
    if (method === "prompts/list") {
      const prompts = await listPrompts()
      return res.json({ jsonrpc: "2.0", id, result: { prompts: prompts.map((name) => ({ name, description: `Maff workflow prompt: ${name}` })) } })
    }
    if (method === "prompts/get") {
      const text = await getPrompt(params.name)
      return res.json({ jsonrpc: "2.0", id, result: { description: `Maff workflow prompt: ${params.name}`, messages: [{ role: "user", content: { type: "text", text } }] } })
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
