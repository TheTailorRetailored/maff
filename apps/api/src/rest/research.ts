import type { Router } from "express"
import { requireUser } from "../auth/auth0.js"
import { requireWorkspaceRole } from "../auth/permissions.js"
import * as runtime from "../research/runtime.js"
import { asyncHandler } from "./asyncHandler.js"

export function registerResearchRuntimeRoutes(router: Router) {
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
    res.status(201).json(await runtime.createWorkstream({ workspaceId: req.params.id, projectId: req.params.projectId, goalId: req.body.goalId, parentWorkstreamId: req.body.parentWorkstreamId, title: req.body.title, kind: req.body.kind, coordinatorRole: req.body.coordinatorRole, priority: req.body.priority, targetObjectType: req.body.targetObjectType, targetObjectId: req.body.targetObjectId, instructions: req.body.instructions, allowedWrites: req.body.allowedWrites, forbiddenActions: req.body.forbiddenActions, successCriteria: req.body.successCriteria, reviewPolicy: req.body.reviewPolicy }))
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
    res.status(201).json(await runtime.recordReviewRound({ workspaceId: req.params.id, workstreamId: req.params.workstreamId, reportId: req.body.reportId, targetObjectType: req.body.targetObjectType, targetObjectId: req.body.targetObjectId, reviewerRole: req.body.reviewerRole, verdict: req.body.verdict, issues: req.body.issues, requiredChanges: req.body.requiredChanges, checkedRefs: req.body.checkedRefs, bodyMarkdown: req.body.bodyMarkdown, createdByAgentRunId: req.body.createdByAgentRunId }))
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
}
