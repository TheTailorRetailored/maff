import type { Router } from "express"
import path from "node:path"
import { pipeline } from "node:stream/promises"
import { z } from "zod"
import { requireUser } from "../auth/oidc.js"
import { requireWorkspaceRole } from "../auth/permissions.js"
import * as runtime from "../research/runtime.js"
import { asyncHandler } from "./asyncHandler.js"
import { openZipEntry } from "../artifacts/storage.js"

const optionalText = z.string().min(1).optional()
const confidence = z.enum(["low", "medium", "high"]).optional()
const listQuery = z.object({
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid().optional(),
  status: optionalText,
  kind: optionalText,
  sourceType: optionalText,
  sourceId: optionalText,
  targetType: optionalText,
  targetId: optionalText,
  limit: z.coerce.number().int().positive().max(200).optional()
})
const baseWrite = z.object({ workspaceId: z.string().uuid(), projectId: z.string().uuid().optional() }).passthrough()
const idParams = z.object({ id: z.string().uuid() })

function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  return schema.parse(value)
}

async function requireQueryRole(userId: string, query: unknown, role: "viewer" | "editor") {
  const parsed = parse(listQuery, query)
  await requireWorkspaceRole(userId, parsed.workspaceId, role)
  return parsed
}

async function requireBodyRole(userId: string, body: unknown, role: "viewer" | "editor") {
  const parsed = parse(baseWrite, body)
  await requireWorkspaceRole(userId, parsed.workspaceId, role)
  return parsed
}

export function registerResearchRuntimeRoutes(router: Router) {
  router.get("/artifacts", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    const query = parse(z.object({ workspaceId: z.string().uuid(), projectId: z.string().uuid().optional(), workstreamId: z.string().uuid().optional(), researchArtifactId: z.string().uuid().optional(), manuscriptVersionId: z.string().uuid().optional() }), req.query)
    await requireWorkspaceRole(user.id, query.workspaceId, "viewer")
    res.json(await runtime.listArtifacts(query))
  }))
  router.get("/artifacts/:id", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    const query = parse(z.object({ workspaceId: z.string().uuid() }), req.query)
    await requireWorkspaceRole(user.id, query.workspaceId, "viewer")
    res.json(await runtime.getArtifact(query.workspaceId, parse(idParams, req.params).id))
  }))
  router.post("/artifacts/from-path", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    const body = parse(baseWrite.extend({ projectId: z.string().uuid(), workstreamId: z.string().uuid().optional(), researchArtifactId: z.string().uuid().optional(), path: z.string().min(1), title: z.string().min(1), kind: optionalText, mimeType: optionalText, createdByAgentRunId: z.string().uuid().optional() }), req.body)
    await requireWorkspaceRole(user.id, body.workspaceId, "editor")
    res.status(201).json(await runtime.createArtifactFromPath(body as any))
  }))
  router.get("/artifacts/:id/content", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    const query = parse(z.object({ workspaceId: z.string().uuid() }), req.query)
    await requireWorkspaceRole(user.id, query.workspaceId, "viewer")
    const stored = await runtime.getArtifactStorageFile(query.workspaceId, parse(idParams, req.params).id)
    res.type(stored.artifact.mimeType ?? "application/octet-stream")
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(stored.artifact.originalFilename ?? stored.artifact.title)}`)
    res.setHeader("Digest", `sha-256=${Buffer.from(stored.artifact.sha256!, "hex").toString("base64")}`)
    await pipeline((await import("node:fs")).createReadStream(stored.file), res)
  }))
  router.get("/artifacts/:id/archive", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    const query = parse(z.object({ workspaceId: z.string().uuid() }), req.query)
    await requireWorkspaceRole(user.id, query.workspaceId, "viewer")
    res.json(await runtime.listArtifactArchive(query.workspaceId, parse(idParams, req.params).id))
  }))
  router.get("/artifacts/:id/archive-entry", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    const query = parse(z.object({ workspaceId: z.string().uuid(), path: z.string().min(1) }), req.query)
    await requireWorkspaceRole(user.id, query.workspaceId, "viewer")
    const artifactId = parse(idParams, req.params).id
    const stored = await runtime.getArtifactStorageFile(query.workspaceId, artifactId)
    const selected = await openZipEntry(stored.artifact.storageKey!, query.path)
    res.type(runtimeMimeForArchiveEntry(query.path))
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(query.path))}`)
    res.setHeader("Content-Length", String(selected.entry.uncompressedSize))
    await pipeline(selected.stream, res)
  }))
  router.post("/artifacts/:id/manuscript-links", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    const body = parse(z.object({ workspaceId: z.string().uuid(), manuscriptVersionId: z.string().uuid(), role: z.string().min(1) }), req.body)
    await requireWorkspaceRole(user.id, body.workspaceId, "editor")
    res.status(201).json(await runtime.attachArtifactToManuscriptVersion({ workspaceId: body.workspaceId, artifactId: parse(idParams, req.params).id, manuscriptVersionId: body.manuscriptVersionId, role: body.role }))
  }))
  router.get("/research/deltas", asyncHandler(async (req, res) => {
    const query = await requireQueryRole(requireUser(req).id, req.query, "viewer")
    res.json(await runtime.listResearchDeltas(query))
  }))
  router.get("/research/deltas/:id", asyncHandler(async (req, res) => {
    const query = await requireQueryRole(requireUser(req).id, req.query, "viewer")
    res.json(await runtime.getResearchDelta(query.workspaceId, parse(idParams, req.params).id))
  }))
  router.post("/research/deltas", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    const body = await requireBodyRole(user.id, req.body, "editor")
    res.status(201).json(await runtime.createResearchDelta({ ...body, createdByUserId: user.id }))
  }))
  router.patch("/research/deltas/:id", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    const body = await requireBodyRole(user.id, req.body, "editor")
    res.json(await runtime.updateResearchDelta({ workspaceId: body.workspaceId, id: parse(idParams, req.params).id, patch: req.body }))
  }))

  router.get("/research/mechanisms", asyncHandler(async (req, res) => {
    const query = await requireQueryRole(requireUser(req).id, req.query, "viewer")
    res.json(await runtime.listMechanisms(query))
  }))
  router.get("/research/mechanisms/:id", asyncHandler(async (req, res) => {
    const query = await requireQueryRole(requireUser(req).id, req.query, "viewer")
    res.json(await runtime.getMechanism(query.workspaceId, parse(idParams, req.params).id))
  }))
  router.post("/research/mechanisms", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    const body = parse(baseWrite.extend({ title: z.string().min(1), descriptionMarkdown: optionalText, coreIdeaMarkdown: optionalText }), req.body)
    await requireWorkspaceRole(user.id, body.workspaceId, "editor")
    res.status(201).json(await runtime.createMechanism({ ...body, createdByUserId: user.id }))
  }))
  router.patch("/research/mechanisms/:id", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    const body = await requireBodyRole(user.id, req.body, "editor")
    res.json(await runtime.updateMechanism({ workspaceId: body.workspaceId, id: parse(idParams, req.params).id, patch: req.body }))
  }))

  router.get("/research/spinouts", asyncHandler(async (req, res) => {
    const query = await requireQueryRole(requireUser(req).id, req.query, "viewer")
    res.json(await runtime.listSpinoutCandidates(query))
  }))
  router.get("/research/spinouts/:id", asyncHandler(async (req, res) => {
    const query = await requireQueryRole(requireUser(req).id, req.query, "viewer")
    res.json(await runtime.getSpinoutCandidate(query.workspaceId, parse(idParams, req.params).id))
  }))
  router.post("/research/spinouts", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    const body = parse(baseWrite.extend({ title: z.string().min(1), statementSketchMarkdown: optionalText }), req.body)
    await requireWorkspaceRole(user.id, body.workspaceId, "editor")
    res.status(201).json(await runtime.createSpinoutCandidate({ ...body, createdByUserId: user.id }))
  }))
  router.patch("/research/spinouts/:id", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    const body = await requireBodyRole(user.id, req.body, "editor")
    res.json(await runtime.updateSpinoutCandidate({ workspaceId: body.workspaceId, id: parse(idParams, req.params).id, patch: req.body }))
  }))
  router.post("/research/spinouts/:id/promote", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    const body = await requireBodyRole(user.id, req.body, "editor")
    res.json(await runtime.promoteSpinoutCandidate({ workspaceId: body.workspaceId, id: parse(idParams, req.params).id, userId: user.id }))
  }))

  router.get("/research/assumptions", asyncHandler(async (req, res) => {
    const query = await requireQueryRole(requireUser(req).id, req.query, "viewer")
    res.json(await runtime.listAssumptionRegimes(query))
  }))
  router.get("/research/assumptions/:id", asyncHandler(async (req, res) => {
    const query = await requireQueryRole(requireUser(req).id, req.query, "viewer")
    res.json(await runtime.getAssumptionRegime(query.workspaceId, parse(idParams, req.params).id))
  }))
  router.post("/research/assumptions", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    const body = parse(baseWrite.extend({ title: z.string().min(1), descriptionMarkdown: optionalText, formalStatementMarkdown: optionalText }), req.body)
    await requireWorkspaceRole(user.id, body.workspaceId, "editor")
    res.status(201).json(await runtime.createAssumptionRegime({ ...body, createdByUserId: user.id }))
  }))
  router.patch("/research/assumptions/:id", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    const body = await requireBodyRole(user.id, req.body, "editor")
    res.json(await runtime.updateAssumptionRegime({ workspaceId: body.workspaceId, id: parse(idParams, req.params).id, patch: req.body }))
  }))

  router.get("/research/contracts", asyncHandler(async (req, res) => {
    const query = await requireQueryRole(requireUser(req).id, req.query, "viewer")
    res.json(await runtime.listTheoremContracts(query))
  }))
  router.get("/research/contracts/:id", asyncHandler(async (req, res) => {
    const query = await requireQueryRole(requireUser(req).id, req.query, "viewer")
    res.json(await runtime.getTheoremContract(query.workspaceId, parse(idParams, req.params).id))
  }))
  router.post("/research/contracts", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    const body = parse(baseWrite.extend({ projectId: z.string().uuid(), title: z.string().min(1), theoremStatementMarkdown: optionalText, confidence }), req.body)
    await requireWorkspaceRole(user.id, body.workspaceId, "editor")
    res.status(201).json(await runtime.createTheoremContract({ ...body, createdByUserId: user.id }))
  }))
  router.patch("/research/contracts/:id", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    const body = await requireBodyRole(user.id, req.body, "editor")
    res.json(await runtime.updateTheoremContract({ workspaceId: body.workspaceId, id: parse(idParams, req.params).id, patch: req.body }))
  }))

  router.get("/research/frontier/latest", asyncHandler(async (req, res) => {
    const query = await requireQueryRole(requireUser(req).id, req.query, "viewer")
    res.json(await runtime.getLatestFrontierSnapshot(query))
  }))
  router.get("/research/frontier", asyncHandler(async (req, res) => {
    const query = await requireQueryRole(requireUser(req).id, req.query, "viewer")
    res.json(await runtime.listFrontierSnapshots(query))
  }))
  router.post("/research/frontier", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    const body = parse(baseWrite.extend({ title: z.string().min(1), snapshotMarkdown: z.string().optional() }), req.body)
    await requireWorkspaceRole(user.id, body.workspaceId, "editor")
    res.status(201).json(await runtime.createFrontierSnapshot({ ...body, createdByUserId: user.id }))
  }))

  router.get("/research/artifacts", asyncHandler(async (req, res) => {
    const query = await requireQueryRole(requireUser(req).id, req.query, "viewer")
    res.json(await runtime.listResearchArtifacts(query))
  }))
  router.get("/research/artifacts/:id", asyncHandler(async (req, res) => {
    const query = await requireQueryRole(requireUser(req).id, req.query, "viewer")
    res.json(await runtime.getResearchArtifact(query.workspaceId, parse(idParams, req.params).id))
  }))
  router.post("/research/artifacts", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    const body = parse(baseWrite.extend({ title: z.string().min(1) }), req.body)
    await requireWorkspaceRole(user.id, body.workspaceId, "editor")
    res.status(201).json(await runtime.createResearchArtifact({ ...body, createdByUserId: user.id }))
  }))
  router.patch("/research/artifacts/:id", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    const body = await requireBodyRole(user.id, req.body, "editor")
    res.json(await runtime.updateResearchArtifact({ workspaceId: body.workspaceId, id: parse(idParams, req.params).id, patch: req.body }))
  }))

  router.get("/research/links", asyncHandler(async (req, res) => {
    const query = await requireQueryRole(requireUser(req).id, req.query, "viewer")
    res.json(await runtime.listResearchLinks(query))
  }))
  router.post("/research/links", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    const body = parse(baseWrite.extend({ sourceType: z.string().min(1), sourceId: z.string().min(1), relationType: z.string().min(1), targetType: z.string().min(1), targetId: z.string().min(1), confidence }), req.body)
    await requireWorkspaceRole(user.id, body.workspaceId, "editor")
    res.status(201).json(await runtime.createResearchLink({ ...body, createdByUserId: user.id }))
  }))
  router.delete("/research/links/:id", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    const body = await requireBodyRole(user.id, req.body, "editor")
    res.json(await runtime.deleteResearchLink({ workspaceId: body.workspaceId, id: parse(idParams, req.params).id }))
  }))

  router.get("/research/context", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    res.json(await runtime.getMyMaffContext({
      userId: user.id,
      workspaceRef: typeof req.query.workspace === "string" ? req.query.workspace : undefined,
      project: typeof req.query.project === "string" ? req.query.project : undefined
    }))
  }))

  router.post("/research/claim-next-assignment", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    res.json(await runtime.claimNextAssignment({
      userId: user.id,
      workspaceRef: req.body.workspace,
      project: req.body.project,
      role: req.body.role,
      kind: req.body.kind,
      sessionId: req.body.sessionId,
      model: req.body.model,
      leaseMinutes: req.body.leaseMinutes,
      startRun: req.body.startRun
    }))
  }))

  router.post("/research/claim-next-review", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    res.json(await runtime.claimNextReview({
      userId: user.id,
      workspaceRef: req.body.workspace,
      project: req.body.project,
      sessionId: req.body.sessionId,
      model: req.body.model,
      leaseMinutes: req.body.leaseMinutes,
      startRun: req.body.startRun
    }))
  }))

  router.get("/workspaces/:id/projects", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    await requireWorkspaceRole(user.id, req.params.id, "viewer")
    res.json(await runtime.listProjects(req.params.id))
  }))

  router.post("/workspaces/:id/projects", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    await requireWorkspaceRole(user.id, req.params.id, "editor")
    res.status(201).json(await runtime.createProject({ workspaceId: req.params.id, title: req.body.title, area: req.body.area, statement: req.body.statement, slug: req.body.slug, userId: user.id }))
  }))

  router.get("/workspaces/:id/projects/:projectId", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    await requireWorkspaceRole(user.id, req.params.id, "viewer")
    res.json(await runtime.getProject(req.params.id, req.params.projectId))
  }))

  router.get("/workspaces/:id/projects/:projectId/control-room", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    await requireWorkspaceRole(user.id, req.params.id, "viewer")
    res.json(await runtime.getProjectControlRoom(req.params.id, req.params.projectId))
  }))

  router.patch("/workspaces/:id/projects/:projectId/summary", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    await requireWorkspaceRole(user.id, req.params.id, "editor")
    res.json(await runtime.updateProjectSummary({ workspaceId: req.params.id, projectId: req.params.projectId, coordinatorSummary: req.body.coordinatorSummary }))
  }))

  router.get("/workspaces/:id/projects/:projectId/goals", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    await requireWorkspaceRole(user.id, req.params.id, "viewer")
    res.json(await runtime.listProjectGoals(req.params.id, req.params.projectId))
  }))

  router.post("/workspaces/:id/projects/:projectId/goals", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    await requireWorkspaceRole(user.id, req.params.id, "editor")
    res.status(201).json(await runtime.proposeProjectGoal({ workspaceId: req.params.id, projectId: req.params.projectId, title: req.body.title, statement: req.body.statement, priority: req.body.priority, successCriteria: req.body.successCriteria, dependencies: req.body.dependencies }))
  }))

  router.patch("/workspaces/:id/goals/:goalId", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    await requireWorkspaceRole(user.id, req.params.id, "editor")
    res.json(await runtime.updateProjectGoal({ workspaceId: req.params.id, goalId: req.params.goalId, patch: req.body, userId: user.id }))
  }))

  router.post("/workspaces/:id/goals/:goalId/approve", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    await requireWorkspaceRole(user.id, req.params.id, "editor")
    res.json(await runtime.approveProjectGoal({ workspaceId: req.params.id, goalId: req.params.goalId, userId: user.id }))
  }))

  router.get("/workspaces/:id/projects/:projectId/workstreams", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    await requireWorkspaceRole(user.id, req.params.id, "viewer")
    res.json(await runtime.listWorkstreams({ workspaceId: req.params.id, projectId: req.params.projectId, status: typeof req.query.status === "string" ? req.query.status : undefined }))
  }))

  router.post("/workspaces/:id/projects/:projectId/workstreams", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    await requireWorkspaceRole(user.id, req.params.id, "editor")
    res.status(201).json(await runtime.createWorkstream({ workspaceId: req.params.id, projectId: req.params.projectId, goalId: req.body.goalId, parentWorkstreamId: req.body.parentWorkstreamId, title: req.body.title, kind: req.body.kind, coordinatorRole: req.body.coordinatorRole, priority: req.body.priority, targetObjectType: req.body.targetObjectType, targetObjectId: req.body.targetObjectId, instructions: req.body.instructions, allowedWrites: req.body.allowedWrites, forbiddenActions: req.body.forbiddenActions, successCriteria: req.body.successCriteria, reviewPolicy: req.body.reviewPolicy, dependencyWorkstreamIds: req.body.dependencyWorkstreamIds }))
  }))

  router.get("/workspaces/:id/workstreams/:workstreamId", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    await requireWorkspaceRole(user.id, req.params.id, "viewer")
    res.json(await runtime.getWorkstream(req.params.id, req.params.workstreamId))
  }))

  router.post("/workspaces/:id/workstreams/:workstreamId/claim", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    await requireWorkspaceRole(user.id, req.params.id, "editor")
    res.json(await runtime.claimAgentAssignment({ workspaceId: req.params.id, workstreamId: req.params.workstreamId, sessionId: req.body.sessionId, userId: user.id, leaseMinutes: req.body.leaseMinutes }))
  }))

  router.get("/workspaces/:id/workstreams/:workstreamId/briefing", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    await requireWorkspaceRole(user.id, req.params.id, "viewer")
    res.json(await runtime.getAgentBriefing(req.params.id, req.params.workstreamId))
  }))

  router.post("/workspaces/:id/workstreams/:workstreamId/runs", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    await requireWorkspaceRole(user.id, req.params.id, "editor")
    res.status(201).json(await runtime.startAgentRun({ workspaceId: req.params.id, workstreamId: req.params.workstreamId, sessionId: req.body.sessionId, model: req.body.model }))
  }))

  router.post("/workspaces/:id/workstreams/:workstreamId/report", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    await requireWorkspaceRole(user.id, req.params.id, "editor")
    res.json(await runtime.createOrUpdateWorkstreamReport({ workspaceId: req.params.id, workstreamId: req.params.workstreamId, title: req.body.title, bodyMarkdown: req.body.bodyMarkdown, uncertaintyNotes: req.body.uncertaintyNotes, linkedObjectRefs: req.body.linkedObjectRefs, artifactRefs: req.body.artifactRefs }))
  }))

  router.post("/workspaces/:id/workstreams/:workstreamId/report/submit", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    await requireWorkspaceRole(user.id, req.params.id, "editor")
    res.json(await runtime.submitWorkstreamReport({ workspaceId: req.params.id, workstreamId: req.params.workstreamId, title: req.body.title, bodyMarkdown: req.body.bodyMarkdown, uncertaintyNotes: req.body.uncertaintyNotes, linkedObjectRefs: req.body.linkedObjectRefs, artifactRefs: req.body.artifactRefs }))
  }))

  router.post("/workspaces/:id/workstreams/:workstreamId/reviews", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    await requireWorkspaceRole(user.id, req.params.id, "editor")
    res.status(201).json(await runtime.recordReviewRound({ workspaceId: req.params.id, workstreamId: req.params.workstreamId, reportId: req.body.reportId, targetObjectType: req.body.targetObjectType, targetObjectId: req.body.targetObjectId, reviewerRole: req.body.reviewerRole, verdict: req.body.verdict, reviewType: req.body.reviewType, targetVersion: req.body.targetVersion, scope: req.body.scope, inspectedArtifactIds: req.body.inspectedArtifactIds, checkedObligationIds: req.body.checkedObligationIds, parentMathReopenable: req.body.parentMathReopenable, priorApprovalsEvidenceOnly: req.body.priorApprovalsEvidenceOnly, independence: req.body.independence, obligationChecks: req.body.obligationChecks, issues: req.body.issues, requiredChanges: req.body.requiredChanges, checkedRefs: req.body.checkedRefs, bodyMarkdown: req.body.bodyMarkdown, createdByAgentRunId: req.body.createdByAgentRunId }))
  }))

  router.get("/workspaces/:id/workstreams/:workstreamId/reviews", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    await requireWorkspaceRole(user.id, req.params.id, "viewer")
    res.json(await runtime.listReviewRounds(req.params.id, req.params.workstreamId))
  }))

  router.post("/workspaces/:id/workstreams/:workstreamId/complete", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    await requireWorkspaceRole(user.id, req.params.id, "editor")
    res.json(await runtime.completeWorkstream({ workspaceId: req.params.id, workstreamId: req.params.workstreamId }))
  }))

  router.get("/workspaces/:id/reports/:reportId", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    await requireWorkspaceRole(user.id, req.params.id, "viewer")
    res.json(await runtime.getReport(req.params.id, req.params.reportId))
  }))

  router.post("/workspaces/:id/objects/search", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    await requireWorkspaceRole(user.id, req.params.id, "viewer")
    res.json(await runtime.searchResearchObjects({ workspaceId: req.params.id, projectId: req.body.projectId, query: req.body.query, type: req.body.type }))
  }))

  router.get("/workspaces/:id/objects/graph", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    await requireWorkspaceRole(user.id, req.params.id, "viewer")
    res.json(await runtime.getObjectGraph({ workspaceId: req.params.id, projectId: typeof req.query.projectId === "string" ? req.query.projectId : undefined }))
  }))

  router.get("/workspaces/:id/projects/:projectId/health", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    await requireWorkspaceRole(user.id, req.params.id, "viewer")
    res.json(await runtime.getProjectHealth(req.params.id, req.params.projectId))
  }))

  router.post("/workspaces/:id/projects/:projectId/manuscripts", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    await requireWorkspaceRole(user.id, req.params.id, "editor")
    res.status(201).json(await runtime.createManuscriptVersion({ workspaceId: req.params.id, projectId: req.params.projectId, artifactId: req.body.artifactId, parentArtifactIds: req.body.parentArtifactIds, claimIds: req.body.claimIds, theoremFingerprint: req.body.theoremFingerprint, citationFingerprint: req.body.citationFingerprint }))
  }))
  router.get("/workspaces/:id/manuscripts/:manuscriptVersionId", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    await requireWorkspaceRole(user.id, req.params.id, "viewer")
    res.json(await runtime.getManuscriptVersion(req.params.id, req.params.manuscriptVersionId))
  }))

  router.post("/workspaces/:id/manuscripts/:manuscriptVersionId/citation-metadata-repair", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    await requireWorkspaceRole(user.id, req.params.id, "editor")
    const body = parse(z.object({
      projectId: z.string().uuid(), expectedContentHash: z.string().regex(/^[a-f0-9]{64}$/), expectedOldCitationFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
      sourceArtifactId: z.string().uuid(), sourceArtifactSha256: z.string().regex(/^[a-f0-9]{64}$/), pdfArtifactId: z.string().uuid(), pdfArtifactSha256: z.string().regex(/^[a-f0-9]{64}$/),
      actorAgentRunId: z.string().uuid(), mode: z.enum(["source_bundle", "explicit_map"]).optional(), citations: z.array(z.object({ key: z.string().min(1), bibitem_latex: z.string().min(1) })).optional(),
      expectedNewCitationFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(), idempotencyKey: z.string().min(1).max(200).optional()
    }), req.body)
    res.json(await runtime.repairExactVersionCitationMetadata({ workspaceId: req.params.id, manuscriptVersionId: req.params.manuscriptVersionId, ...body }))
  }))

  router.post("/workspaces/:id/manuscripts/:manuscriptVersionId/promote", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    await requireWorkspaceRole(user.id, req.params.id, "editor")
    res.json(await runtime.promoteManuscriptVersion({ workspaceId: req.params.id, manuscriptVersionId: req.params.manuscriptVersionId }))
  }))

  router.post("/workspaces/:id/manuscripts/:manuscriptVersionId/freeze", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    await requireWorkspaceRole(user.id, req.params.id, "editor")
    res.json(await runtime.setManuscriptFreeze({ workspaceId: req.params.id, manuscriptVersionId: req.params.manuscriptVersionId, level: req.body.level }))
  }))

  router.post("/workspaces/:id/projects/:projectId/external-reviews", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    await requireWorkspaceRole(user.id, req.params.id, "editor")
    res.status(201).json(await runtime.importExternalReview({ workspaceId: req.params.id, projectId: req.params.projectId, manuscriptVersionId: req.body.manuscriptVersionId, theoremOrArtifactRef: req.body.theoremOrArtifactRef, originalReviewText: req.body.originalReviewText, originalReviewUri: req.body.originalReviewUri, provenance: req.body.provenance, reviewerIdentity: req.body.reviewerIdentity, independenceStatement: req.body.independenceStatement, reviewScope: req.body.reviewScope, verdict: req.body.verdict, issues: req.body.issues, requiredChanges: req.body.requiredChanges }))
  }))

  router.post("/workspaces/:id/projects/:projectId/strategic-reviews", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    await requireWorkspaceRole(user.id, req.params.id, "editor")
    res.status(201).json(await runtime.createStrategicReviewRound({ workspaceId: req.params.id, projectId: req.params.projectId, verdict: req.body.verdict, reviewerIndependence: req.body.reviewerIndependence, whatChangedMarkdown: req.body.whatChangedMarkdown, loopDiagnosisMarkdown: req.body.loopDiagnosisMarkdown, blockerStructureMarkdown: req.body.blockerStructureMarkdown, alternativesMarkdown: req.body.alternativesMarkdown, branchAllocation: req.body.branchAllocation, nextMoves: req.body.nextMoves, probabilityEstimates: req.body.probabilityEstimates, metrics: req.body.metrics }))
  }))

  router.post("/workspaces/:id/projects/:projectId/branches", asyncHandler(async (req, res) => {
    const user = requireUser(req)
    await requireWorkspaceRole(user.id, req.params.id, "editor")
    res.status(201).json(await runtime.createProjectBranch({ workspaceId: req.params.id, projectId: req.params.projectId, title: req.body.title, state: req.body.state, rationaleMarkdown: req.body.rationaleMarkdown, targetObjectType: req.body.targetObjectType, targetObjectId: req.body.targetObjectId }))
  }))
}

function runtimeMimeForArchiveEntry(filename: string) {
  const extension = path.extname(filename).toLowerCase()
  return ({ ".tex": "application/x-tex", ".bib": "application/x-bibtex", ".pdf": "application/pdf", ".json": "application/json", ".txt": "text/plain", ".md": "text/markdown" } as Record<string, string>)[extension] ?? "application/octet-stream"
}
