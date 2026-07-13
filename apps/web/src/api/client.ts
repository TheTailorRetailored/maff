import { useAuth } from "react-oidc-context"

const baseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001/api"

export type Workspace = { id: string; slug: string; name: string; type: string }
export type Project = { id: string; workspaceId: string; slug: string; title: string; area?: string; statement: string; status: string; coordinatorSummary?: string; updatedAt: string }
export type ProjectGoal = { id: string; projectId: string; title: string; statement: string; status: string; priority: number; successCriteria: unknown[]; updatedAt: string }
export type Workstream = { id: string; projectId: string; goalId?: string; title: string; kind: string; coordinatorRole: string; status: string; priority: number; instructions: string; targetObjectType?: string; targetObjectId?: string; reportId?: string; escalationMessage?: string; updatedAt: string }
export type AgentRun = { id: string; workstreamId: string; role: string; status: string; model?: string; sessionId: string; outputSummary?: string; startedAt: string; finishedAt?: string }
export type WorkstreamReport = { id: string; workstreamId: string; title: string; status: string; bodyMarkdown: string; linkedObjectRefs: unknown[]; artifactRefs: unknown[]; updatedAt: string; submittedAt?: string }
export type ReviewRound = { id: string; workstreamId: string; reportId?: string; reviewerRole: string; verdict: string; reviewType: string; scoped_status?: string; targetVersion?: string; scope: unknown; inspectedArtifactIds: unknown[]; checkedObligationIds: unknown[]; parentMathReopenable: boolean; priorApprovalsEvidenceOnly: boolean; independence: string; issues: unknown[]; requiredChanges: unknown[]; bodyMarkdown: string; createdAt: string }
export type SubmissionReadiness = { submission_ready: boolean; status: string; reasons: string[]; gates: Record<string, { satisfied: boolean; review_ids?: string[] }>; stale_review_references: unknown[]; missing_gate_references: string[]; blocking_object_references: unknown[] }
export type ManuscriptVersion = { id: string; artifactId: string; version: number; contentHash: string; isCanonical: boolean }
export type Claim = { id: string; title: string; statementMarkdown: string; kind: string; status: string; updatedAt: string }
export type Gap = { id: string; title: string; descriptionMarkdown: string; severity: string; status: string; updatedAt: string }
export type ResearchDelta = { id: string; projectId?: string; title: string; summaryMarkdown: string; whatChangedMarkdown: string; mainlineEffectMarkdown?: string; reusableIdeasMarkdown?: string; blockersMarkdown?: string; nextMoveMarkdown?: string; confidence?: string; createdAt: string }
export type Mechanism = { id: string; projectId?: string; title: string; slug: string; status: string; maturity: string; portabilityScore?: number; descriptionMarkdown: string; coreIdeaMarkdown?: string; updatedAt: string }
export type SpinoutCandidate = { id: string; originProjectId?: string; promotedProjectId?: string; title: string; slug: string; status: string; statementSketchMarkdown: string; whyInterestingMarkdown?: string; cheapestNextTestMarkdown?: string; promotedProject?: Project; updatedAt: string }
export type AssumptionRegime = { id: string; projectId?: string; title: string; slug: string; status: string; descriptionMarkdown: string; formalStatementMarkdown?: string; updatedAt: string }
export type TheoremContract = { id: string; projectId: string; title: string; slug: string; status: string; theoremStatementMarkdown: string; assumptionsMarkdown?: string; knownBlockersMarkdown?: string; currentBestVersionMarkdown?: string; confidence?: string; updatedAt: string }
export type FrontierSnapshot = { id: string; projectId?: string; title: string; snapshotMarkdown: string; strongestCurrentTheoremMarkdown?: string; strongestConditionalTheoremMarkdown?: string; activeBlockersMarkdown?: string; activeMechanismsMarkdown?: string; spinoutsMarkdown?: string; recommendedNextMovesMarkdown?: string; source?: string; createdAt: string }
export type ResearchArtifact = { id: string; projectId?: string; title: string; slug: string; kind: string; status: string; descriptionMarkdown?: string; contentMarkdown?: string; filePath?: string; url?: string; updatedAt: string }
export type ResearchFrontier = { latestSnapshot?: FrontierSnapshot | null; contracts: TheoremContract[]; mechanisms: Mechanism[]; spinouts: SpinoutCandidate[]; assumptionRegimes: AssumptionRegime[]; recentDeltas: ResearchDelta[]; artifacts: ResearchArtifact[] }
export type ProjectHealth = { epoch?: { number: number; substantiveActionCount: number } | null; metrics: { frontier_delta_rate: number; gap_reopen_rate: number; blocked_workstream_fraction: number; review_debt: number }; circuit_breakers: { strategic_review_queued: boolean; downstream_paused: boolean }; branches: Array<{ id: string; title: string; state: string }> }
export type ControlRoom = { project: Project; canonical_working_paper?: ManuscriptVersion | null; readiness?: SubmissionReadiness; project_health?: ProjectHealth; workstream_dependency_states?: Array<{ workstream_id: string; satisfied: boolean; blocking_prerequisite_ids: string[] }>; goals_by_status: Record<string, ProjectGoal[]>; workstreams_by_status: Record<string, Workstream[]>; needs_review: Workstream[]; blocked_or_escalated: Workstream[]; recent_agent_runs: AgentRun[]; key_claims: Claim[]; open_gaps: Gap[]; recent_reviews: ReviewRound[]; suggested_next_assignment?: Workstream | null; frontier?: ResearchFrontier }

export function useApi() {
  const auth = useAuth()
  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = auth.user?.access_token
    if (!token) throw new Error("OIDC access token is unavailable; sign in again")
    const res = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...(init.headers ?? {}) }
    })
    if (!res.ok) throw new Error(await res.text())
    return res.json()
  }
  return { request }
}
