import assert from "node:assert/strict"
import path from "node:path"
import { readFileSync, readdirSync } from "node:fs"
import { createLocalJWKSet, exportJWK, generateKeyPair, jwtVerify, SignJWT } from "jose"
import { assertInsideRoot } from "./vault/paths.js"
import { dumpMarkdown, parseMarkdown } from "./vault/parser.js"
import { extractWikilinks } from "./vault/wikilinks.js"
import { emailMatchesRequiredDomain, jwksUriForIssuer, userEmailUpdateData, verifySignedJwt } from "./auth/oidc.js"
import { restAuthorizationRequirement } from "./auth/authorizationMatrix.js"
import { productionOidc } from "./config.js"
import { advertisedScopes, hasBearerAuthorization, hasPermission, rolesForClient, scopes } from "./auth/scopes.js"
import { callTool, compactToolResult, contentResult, expectedMcpToolCount, formatResearchArtifact, mcpAuthorizationMatrix, mcpServerVersion, mcpToolsListResult, structuredContentForTool, toolDefinitions } from "./mcp/server.js"
import { normalizedObligationCheckStatus, reviewEvidenceMatch } from "./research/readiness.js"
import { validateReviewEvidence } from "./research/integrity.js"
import { sourcePreservingCompilationFiles, validateSourcePreservingBuildLog } from "./research/paperBuilder.js"

const root = path.resolve("tmp-workspace")
assert.equal(assertInsideRoot(root, path.join(root, "vault", "A.md")), path.resolve(root, "vault", "A.md"))
assert.throws(() => assertInsideRoot(root, path.resolve(root, "..", "escape.md")), /escapes/)
assert.deepEqual(extractWikilinks("See [[Problem - A]] and [[Lemma|alias]]."), ["Problem - A", "Lemma"])

const cleanCompilationFiles = sourcePreservingCompilationFiles({
  "main.tex": Buffer.from("tex"),
  "references.bib": Buffer.from("bib"),
  "figure.pdf": Buffer.from("figure"),
  "main.bbl": Buffer.from("stale"),
  "latexmkrc": Buffer.from("$bibtex = 'bibtex'"),
  "build/main.aux": Buffer.from("stale")
})
assert.deepEqual(Object.keys(cleanCompilationFiles).sort(), ["figure.pdf", "main.tex", "references.bib"])
assert.deepEqual(validateSourcePreservingBuildLog("Output written on main.pdf."), { ok: true })
assert.throws(() => validateSourcePreservingBuildLog("Package biblatex Warning: Empty bibliography.\nPackage biblatex Warning: Please (re)run Biber on the file"), /empty bibliography, Biber rerun required/)

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
assert.deepEqual(userEmailUpdateData(undefined), {})
assert.deepEqual(userEmailUpdateData("lachlanjbridges@gmail.com"), { email: "lachlanjbridges@gmail.com", displayName: "lachlanjbridges@gmail.com" })
assert.equal(emailMatchesRequiredDomain("researcher@notexample.com", "example.com"), false)
assert.deepEqual(advertisedScopes, ["maff:read", "maff:write", "maff:review", "maff:admin"])
assert.deepEqual(productionOidc, { issuer: "https://auth.lachlanbridges.com/realms/bridges", audience: "https://maff.lachlanbridges.com/mcp" })
assert.equal(hasPermission({ scopeText: "maff:read", required: scopes.maffRead }), true)
assert.equal(hasPermission({ scopeText: "maff:access", required: scopes.maffRead }), false)
const maffRoles = (roles: string[]) => ({ maff: { roles } })
assert.deepEqual(rolesForClient({ unrelated: { roles: ["service-admin"] } }, "maff"), [])
assert.equal(hasBearerAuthorization({ scopeText: "maff:read", resourceAccess: maffRoles([]), roleClientId: "maff", required: scopes.maffRead }), false, "scope without role must fail")
assert.equal(hasBearerAuthorization({ scopeText: "", resourceAccess: maffRoles(["reader"]), roleClientId: "maff", required: scopes.maffRead }), false, "role without scope must fail")
assert.equal(hasBearerAuthorization({ scopeText: "maff:read", resourceAccess: { unrelated: { roles: ["reader", "service-admin"] } }, roleClientId: "maff", required: scopes.maffRead }), false, "unrelated client roles must fail")
assert.equal(hasBearerAuthorization({ scopeText: "maff:admin", resourceAccess: maffRoles(["reader"]), roleClientId: "maff", required: scopes.maffAdmin }), false, "realm or reader roles must not imply administration")
assert.equal(hasBearerAuthorization({ scopeText: "maff:write", resourceAccess: maffRoles(["contributor"]), roleClientId: "maff", required: scopes.maffReview }), false, "write credentials must not review")
assert.equal(hasBearerAuthorization({ scopeText: "maff:review", resourceAccess: maffRoles(["reviewer"]), roleClientId: "maff", required: scopes.maffAdmin }), false, "review credentials must not administer")
assert.equal(hasBearerAuthorization({ scopeText: "maff:review", resourceAccess: maffRoles(["reviewer"]), roleClientId: "maff", required: scopes.maffReview }), true)
assert.equal(jwksUriForIssuer("https://auth.lachlanbridges.com/realms/bridges").href, "https://auth.lachlanbridges.com/realms/bridges/protocol/openid-connect/certs")
assert.throws(() => jwksUriForIssuer("https://auth.lachlanbridges.com/realms/bridges/"), /trailing slash/)
const { privateKey, publicKey } = await generateKeyPair("RS256")
const validJwt = await new SignJWT({ scope: "maff:read" }).setProtectedHeader({ alg: "RS256", kid: "smoke" }).setSubject("synthetic-user").setIssuer("https://auth.lachlanbridges.com/realms/bridges").setAudience("https://maff.lachlanbridges.com/mcp").setIssuedAt().setExpirationTime("5m").sign(privateKey)
await verifySignedJwt(validJwt, publicKey, "https://auth.lachlanbridges.com/realms/bridges", "https://maff.lachlanbridges.com/mcp")
const auth0Jwt = await new SignJWT({ scope: "maff:read maff:write maff:review" }).setProtectedHeader({ alg: "RS256", kid: "smoke" }).setSubject("synthetic-user").setIssuer("https://synthetic-tenant.auth0.test/").setAudience("https://maff.lachlanbridges.com/mcp").setExpirationTime("5m").sign(privateKey)
await assert.rejects(() => verifySignedJwt(auth0Jwt, publicKey, productionOidc.issuer, productionOidc.audience), /iss.*claim|issuer/, "an Auth0-issued token must fail after direct cutover")
await assert.rejects(() => verifySignedJwt(validJwt, publicKey, "https://auth.lachlanbridges.com/realms/bridges", "https://wrong.example/mcp"), /aud.*claim|audience/)
const hsJwt = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject("synthetic-user").setIssuer("https://auth.lachlanbridges.com/realms/bridges").setAudience("https://maff.lachlanbridges.com/mcp").setExpirationTime("5m").sign(new TextEncoder().encode("synthetic-test-secret-that-is-not-a-credential"))
await assert.rejects(() => verifySignedJwt(hsJwt, publicKey, "https://auth.lachlanbridges.com/realms/bridges", "https://maff.lachlanbridges.com/mcp"), /alg.*not allowed|algorithm/)
const futureJwt = await new SignJWT({}).setProtectedHeader({ alg: "RS256", kid: "smoke" }).setSubject("synthetic-user").setIssuer("https://auth.lachlanbridges.com/realms/bridges").setAudience("https://maff.lachlanbridges.com/mcp").setNotBefore("10m").setExpirationTime("20m").sign(privateKey)
await assert.rejects(() => verifySignedJwt(futureJwt, publicKey, "https://auth.lachlanbridges.com/realms/bridges", "https://maff.lachlanbridges.com/mcp"), /nbf.*claim|not active/)
const publicJwk = { ...(await exportJWK(publicKey)), kid: "smoke", alg: "RS256", use: "sig" }
const unknownKidJwt = await new SignJWT({}).setProtectedHeader({ alg: "RS256", kid: "unknown" }).setSubject("synthetic-user").setIssuer("https://auth.lachlanbridges.com/realms/bridges").setAudience("https://maff.lachlanbridges.com/mcp").setExpirationTime("5m").sign(privateKey)
await assert.rejects(() => jwtVerify(unknownKidJwt, createLocalJWKSet({ keys: [publicJwk] }), { algorithms: ["RS256"] }), /no applicable key|JWKS/)
assert.equal(restAuthorizationRequirement("GET", "/workspaces/w/projects").scope, scopes.maffRead)
assert.equal(restAuthorizationRequirement("POST", "/workspaces/w/projects").scope, scopes.maffWrite)
assert.equal(restAuthorizationRequirement("POST", "/workspaces/w/projects/p/external-reviews").scope, scopes.maffReview)
assert.equal(restAuthorizationRequirement("POST", "/workspaces/w/projects/p/manuscripts").scope, scopes.maffWrite)
const restRouteEntries = readdirSync("src/rest").filter((name) => name.endsWith(".ts")).flatMap((name) => {
  const source = readFileSync(path.join("src/rest", name), "utf8")
  return [...source.matchAll(/router\.(get|post|put|patch|delete)\("([^"]+)"/g)].map((match) => ({ method: match[1], path: match[2] }))
})
assert.equal(restRouteEntries.length, 89, "authenticated REST registry changed; review the authorization matrix intentionally")
for (const route of restRouteEntries) {
  const requirement = restAuthorizationRequirement(route.method, route.path)
  assert.ok(advertisedScopes.includes(requirement.scope as typeof advertisedScopes[number]), `unmapped REST scope for ${route.method} ${route.path}`)
  assert.ok(requirement.clientRoles.length > 0, `missing Maff client roles for ${route.method} ${route.path}`)
}

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

for (const name of ["get_manuscript", "update_manuscript", "build_manuscript", "revise_manuscript_source", "inspect_manuscript_build", "publish_manuscript", "create_proof_obligation", "get_integration_coverage", "compute_submission_readiness", "set_manuscript_freeze", "import_external_review", "create_strategic_review", "get_project_health", "create_project_branch"]) {
  assert.ok(toolDefinitions.some((tool) => tool.name === name), `missing modern MCP tool ${name}`)
}
assert.equal(toolDefinitions.length, expectedMcpToolCount, "MCP registry count changed; update the reviewed snapshot intentionally")
assert.equal(mcpAuthorizationMatrix().length, expectedMcpToolCount)
await assert.rejects(
  () => callTool("create_project", { workspace_id: "synthetic-workspace", title: "Denied", statement: "Denied" }, { userId: "synthetic-user", claimsScope: scopes.maffRead, resourceAccess: maffRoles(["reader"]) }),
  /Missing required scope maff:write/
)
await assert.rejects(
  () => callTool("record_review_round", { workspace_id: "synthetic-workspace" }, { userId: "synthetic-user", claimsScope: `${scopes.maffRead} ${scopes.maffWrite}`, resourceAccess: maffRoles(["contributor"]) }),
  /Missing required scope maff:review/
)

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

assert.equal(mcpServerVersion, "1.5.1-biber-validated")
assert.equal(normalizedObligationCheckStatus("passed"), "preserved")
assert.equal(normalizedObligationCheckStatus("preserved"), "preserved")
assert.equal(normalizedObligationCheckStatus("failed"), "failed")
const releaseCandidate = { id: "version-4", version: 4, contentHash: "content-4", theoremFingerprint: "theorem-4", citationFingerprint: "citations-shared" }
const priorCandidate = { id: "version-3", version: 3, contentHash: "content-3", theoremFingerprint: "theorem-3", citationFingerprint: "citations-shared" }
assert.deepEqual(reviewEvidenceMatch({ targetVersion: "4" }, releaseCandidate, [priorCandidate, releaseCandidate], "compile"), { accepted: true, basis: "exact_version", reason: null })
assert.deepEqual(reviewEvidenceMatch({ targetVersion: "version-3" }, releaseCandidate, [priorCandidate, releaseCandidate], "bibliography"), { accepted: true, basis: "citation_fingerprint", reason: null })
assert.equal(reviewEvidenceMatch({ targetVersion: "version-3" }, releaseCandidate, [priorCandidate, releaseCandidate], "proof_integration").accepted, false)
assert.deepEqual(reviewEvidenceMatch({ targetVersion: "version-3" }, releaseCandidate, [priorCandidate, releaseCandidate], "proof_integration", new Set(["version-3"])), { accepted: true, basis: "editorial_only_lineage", reason: null })
assert.equal(reviewEvidenceMatch({ targetVersion: "version-3" }, releaseCandidate, [priorCandidate, releaseCandidate], "editorial", new Set(["version-3"])).accepted, false, "editorial approval must not carry across the editorial repair it triggered")
assert.doesNotThrow(() => validateReviewEvidence({ reviewType: "end_to_end_mathematical", verdict: "approved", evidenceSections: [{ sectionType: "end_to_end_mathematical", conclusion: "holds", evidenceMarkdown: "Checked the boundary case directly.", attackCategories: ["boundary"] }] }))
assert.throws(() => validateReviewEvidence({ reviewType: "editorial", verdict: "approved", evidenceSections: [{ sectionType: "editorial", evidenceMarkdown: "Evidence without a conclusion." }] }), /conclusion and concrete evidence/i)
assert.throws(() => validateReviewEvidence({ reviewType: "end_to_end_mathematical", verdict: "approved", evidenceSections: [{ sectionType: "end_to_end_mathematical", conclusion: "holds", evidenceMarkdown: "Checked directly.", attackCategories: [] }] }), /arbitrary quota/i)
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

for (const name of ["get_research_artifact", "export_research_artifact_bundle", "get_manuscript", "update_manuscript", "build_manuscript", "inspect_manuscript_build", "publish_manuscript", "create_proof_obligation", "get_integration_coverage", "compute_submission_readiness"]) {
  assert.ok(toolsListNames.has(name), `tools/list missing ${name}`)
}
for (const name of ["record_object_contribution", "record_object_access", "submit_run_outcome", "ensure_project_actionable", "begin_project_import", "analyze_project_import", "preview_project_import", "commit_project_import", "run_project_graph_audit", "begin_repair_from_audit"]) {
  assert.ok(toolsListNames.has(name), `tools/list missing integrity tool ${name}`)
}
for (const name of ["get_artifact", "list_artifacts", "verify_artifact", "get_manuscript_version"]) {
  assert.ok(toolDefinitions.some((tool) => tool.name === name), `missing durable artifact tool ${name}`)
}
for (const name of ["create_artifact_from_path", "download_artifact", "list_artifact_archive", "read_artifact_archive_file", "attach_artifact_to_manuscript_version", "export_physical_artifacts", "create_manuscript_version", "promote_manuscript_version", "publish_manuscript_package", "surface_artifact"]) {
  assert.equal(toolsListNames.has(name), false, `${name} is internal and must not be exposed to agents`)
}
const createArtifactTool = toolsList.tools.find((tool) => tool.name === "create_artifact") as any
assert.deepEqual(createArtifactTool?._meta?.["openai/fileParams"], ["file"])
const createArtifactProps = createArtifactTool.inputSchema.properties as Record<string, unknown>
assert.ok(createArtifactProps.file, "create_artifact schema must advertise connector file upload")
assert.ok(createArtifactProps.expected_sha256, "create_artifact schema must advertise expected_sha256")
const createdArtifactResult = contentResult("create_artifact", compactToolResult("create_artifact", {
  id: "artifact-1",
  kind: "archive",
  title: "Bundle",
  uri: "maff-artifact://workspace/hash",
  originalFilename: "bundle.zip",
  mimeType: "application/zip",
  byteSize: 42,
  sha256: "a".repeat(64),
  storageStatus: "available",
  verification: { ok: true, status: "available", actualSha256: "a".repeat(64), actualByteSize: 42 },
  download: { uri: "https://maff.example/api/artifacts/artifact-1/content?workspaceId=workspace-1", name: "bundle.zip", mime_type: "application/zip", byte_size: 42, sha256: "a".repeat(64) },
  createdAt: new Date("2026-07-13T00:00:00.000Z")
}))
assert.equal((createdArtifactResult.structuredContent as any).verification.ok, true)
assert.equal((createdArtifactResult.structuredContent as any).download.uri.includes("/api/artifacts/artifact-1/content"), true)
assert.equal(createdArtifactResult.content[0].type, "text", "intermediate ingestion must not surface a user-visible file link")
const publicationResult = contentResult("publish_manuscript", { package_id: "package-1", final_pdf: { uri: "https://maff.example/api/artifacts/final/content", name: "paper.pdf", mime_type: "application/pdf" } })
assert.equal(publicationResult.content[0].type, "resource_link", "the final publication package must surface its PDF")
const archiveTextResult = contentResult("read_artifact_archive_file", {
  artifact_id: "artifact-1",
  entry_path: "main.tex",
  name: "main.tex",
  mime_type: "application/x-tex",
  byte_size: 12,
  sha256: "b".repeat(64),
  embedded_resource: { uri: "maff://artifacts/artifact-1/archive/main.tex", mime_type: "application/x-tex", text: "Exact source" }
})
assert.equal((archiveTextResult.structuredContent as any).embedded_resource, undefined)
assert.equal(archiveTextResult.content[0].type, "resource")
assert.equal((archiveTextResult.content[0] as any).resource.text, "Exact source")
assert.equal(archiveTextResult.content[1].type, "text")
assert.equal((archiveTextResult.content[1] as any).text, "Exact source")
const archivePdfResult = contentResult("read_artifact_archive_file", {
  artifact_id: "artifact-1",
  entry_path: "main.pdf",
  name: "main.pdf",
  mime_type: "application/pdf",
  byte_size: 4,
  sha256: "c".repeat(64),
  embedded_resource: { uri: "maff://artifacts/artifact-1/archive/main.pdf", mime_type: "application/pdf", blob: "JVBERg==" }
})
assert.equal(archivePdfResult.content[0].type, "resource")
assert.equal((archivePdfResult.content[0] as any).resource.blob, "JVBERg==")
const getResearchArtifactTool = toolDefinitions.find((tool) => tool.name === "get_research_artifact")
assert.ok(getResearchArtifactTool, "missing get_research_artifact")
assert.deepEqual((getResearchArtifactTool.inputSchema as { required?: string[] }).required, ["workspace_id", "artifact_id"])
assert.equal((getResearchArtifactTool.annotations as { readOnlyHint?: boolean }).readOnlyHint, true)
const exportResearchArtifactBundleTool = toolDefinitions.find((tool) => tool.name === "export_research_artifact_bundle")
assert.ok(exportResearchArtifactBundleTool, "missing export_research_artifact_bundle")
assert.equal((exportResearchArtifactBundleTool.annotations as { readOnlyHint?: boolean }).readOnlyHint, true)

const fullArtifactContent = "full body\nwith unicode: λ"
const fullArtifact = formatResearchArtifact({
  id: "artifact-1",
  workspaceId: "workspace-1",
  projectId: "project-1",
  title: "Long artifact",
  slug: "long-artifact",
  kind: "memo",
  status: "active",
  descriptionMarkdown: "Description",
  contentMarkdown: fullArtifactContent,
  filePath: "/research/long.md",
  url: "https://example.test/long",
  createdAt: new Date("2026-07-11T00:00:00.000Z"),
  updatedAt: new Date("2026-07-11T01:00:00.000Z")
})
assert.equal(fullArtifact.content_markdown, fullArtifactContent)
assert.equal(fullArtifact.content_hash, "f600297af1edcced95844657d28bc98cf4cf972bf73ead8f83f554f4b6cd26c5") // pragma: allowlist secret -- deterministic SHA-256 fixture
assert.equal("content_preview" in fullArtifact, false)
await assert.rejects(
  () => callTool("get_research_artifact", { workspace_id: "workspace-1", artifact_id: "artifact-1" }, { userId: "test-user", claimsScope: "" }),
  (error: any) => error.status === 403 && error.message === "Missing required scope maff:read"
)

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
    review_assignment_policy: { review_type: "proof_integration", target_object_id: "mv" },
    manuscript_inspection: { tool: "inspect_manuscript_build", build_id: "build", manuscript_version_id: "mv" },
    related_known_results: [{ id: "k1" }, { id: "k2" }]
  },
  agent_run: { id: "run", role: "HostileReviewer", status: "running", model: "gpt", sessionId: "sess", startedAt: "now" },
  review_assignment: {
    assignment: { id: "ra", workstreamId: "ws", reviewerRunId: "run", reviewType: "proof_integration", targetObjectType: "ManuscriptVersion", targetObjectId: "mv", targetHash: "hash", manuscriptVersionId: "mv", independence: "author_disjoint", permittedArtifactIds: ["artifact"], status: "claimed", leaseExpiresAt: "later", tokenHash: "must-not-leak" },
    submission_token: "one-use-token",
    eligibility: { eligible: true, independence: "author_disjoint" }
  },
  session_id: "sess"
}) as Record<string, any>
assert.equal(compactReviewClaim.assignment.report_id, "r")
assert.equal(compactReviewClaim.briefing.report.bodyMarkdown, undefined)
assert.equal(compactReviewClaim.briefing.report.body_markdown, "Very long body")
assert.deepEqual(compactReviewClaim.briefing.report.linked_object_refs, ["a"])
assert.equal(compactReviewClaim.briefing.related_known_result_count, 2)
assert.deepEqual(compactReviewClaim.briefing.related_known_results.map((item: any) => item.id), ["k1", "k2"])
assert.equal(compactReviewClaim.briefing.manuscript_inspection.build_id, "build")
assert.equal(compactReviewClaim.review_assignment.assignment.id, "ra")
assert.equal(compactReviewClaim.review_assignment.submission_token, "one-use-token")
assert.equal(compactReviewClaim.review_assignment.assignment.tokenHash, undefined)

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

for (const name of ["create_project", "create_research_delta", "list_research_deltas", "create_research_artifact", "list_research_artifacts", "create_spinout_candidate", "create_research_link", "list_research_links", "list_mechanisms", "list_assumption_regimes", "list_spinout_candidates", "list_theorem_contracts", "list_frontier_snapshots", "search_research_objects", "rebuild_quartz_site"]) {
  const descriptor = toolsList.tools.find((tool) => tool.name === name) as Record<string, any> | undefined
  assert.ok(descriptor?.outputSchema, `${name} must advertise outputSchema`)
  assert.ok(descriptor?.annotations, `${name} must advertise annotations`)
}
assert.equal((toolsList.tools.find((tool) => tool.name === "search_research_objects") as any).annotations.readOnlyHint, true)
assert.equal((toolsList.tools.find((tool) => tool.name === "rebuild_quartz_site") as any).annotations.idempotentHint, true)

console.log("Maff v2 smoke checks passed")
