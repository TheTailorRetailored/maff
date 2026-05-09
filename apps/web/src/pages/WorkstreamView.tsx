import { Check, ClipboardCheck, Play, Send } from "lucide-react"
import { useEffect, useState } from "react"
import { useApi, type ReviewRound, type Workstream, type WorkstreamReport } from "../api/client"
import { MarkdownRenderer } from "../components/MarkdownRenderer"
import { StatusBadge } from "../components/StatusBadge"

type WorkstreamDetail = Workstream & { reports: WorkstreamReport[]; reviews: ReviewRound[]; agentRuns: unknown[]; messages: unknown[]; artifacts: unknown[]; project: { title: string }; goal?: { title: string } }

export function WorkstreamView({ workspaceId, workstreamId, onOpenReport }: { workspaceId: string; workstreamId: string; onOpenReport: (id: string) => void }) {
  const { request } = useApi()
  const [detail, setDetail] = useState<WorkstreamDetail | null>(null)
  const [briefing, setBriefing] = useState<Record<string, unknown> | null>(null)
  const [reportBody, setReportBody] = useState("")
  const [reviewBody, setReviewBody] = useState("")
  const [error, setError] = useState("")

  async function refresh() {
    if (!workspaceId || !workstreamId) return
    try {
      setError("")
      const next = await request<WorkstreamDetail>(`/workspaces/${workspaceId}/workstreams/${workstreamId}`)
      setDetail(next)
      setReportBody(next.reports[0]?.bodyMarkdown ?? "")
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  useEffect(() => { void refresh() }, [workspaceId, workstreamId])

  async function claim() {
    const result = await request<{ briefing: Record<string, unknown> }>(`/workspaces/${workspaceId}/workstreams/${workstreamId}/claim`, { method: "POST", body: JSON.stringify({ sessionId: crypto.randomUUID() }) })
    setBriefing(result.briefing)
    await refresh()
  }

  async function startRun() {
    const result = await request<{ briefing: Record<string, unknown> }>(`/workspaces/${workspaceId}/workstreams/${workstreamId}/runs`, { method: "POST", body: JSON.stringify({ sessionId: crypto.randomUUID(), model: "chat-agent" }) })
    setBriefing(result.briefing)
    await refresh()
  }

  async function submitReport() {
    await request(`/workspaces/${workspaceId}/workstreams/${workstreamId}/report/submit`, { method: "POST", body: JSON.stringify({ title: `${detail?.title ?? "Workstream"} report`, bodyMarkdown: reportBody || "Report pending.", uncertaintyNotes: [], linkedObjectRefs: [], artifactRefs: [] }) })
    await refresh()
  }

  async function review(verdict: string) {
    await request(`/workspaces/${workspaceId}/workstreams/${workstreamId}/reviews`, { method: "POST", body: JSON.stringify({ reportId: detail?.reportId, verdict, bodyMarkdown: reviewBody || `${verdict} review`, issues: verdict === "approved" ? [] : ["Reviewer requested revision"], requiredChanges: verdict === "approved" ? [] : ["Address review notes"], checkedRefs: [] }) })
    setReviewBody("")
    await refresh()
  }

  async function complete() {
    await request(`/workspaces/${workspaceId}/workstreams/${workstreamId}/complete`, { method: "POST" })
    await refresh()
  }

  async function leanCheck() {
    if (!detail?.targetObjectId) return
    await request(`/workspaces/${workspaceId}/lean/check`, { method: "POST", body: JSON.stringify({ leanTheoremId: detail.targetObjectId }) })
    await refresh()
  }

  async function markLeanVerified() {
    if (!detail?.targetObjectId) return
    await request(`/workspaces/${workspaceId}/lean/verify`, { method: "POST", body: JSON.stringify({ leanTheoremId: detail.targetObjectId }) })
    await refresh()
  }

  if (!workstreamId) return <section className="page"><p className="notice">Open a workstream from a control room.</p></section>
  return (
    <section className="page">
      {error && <p className="notice error">{error}</p>}
      {detail && (
        <>
          <header><h1>{detail.title}</h1><StatusBadge status={detail.status} /></header>
          <div className="toolbar">
            <button onClick={claim}><ClipboardCheck size={16} /> Claim</button>
            <button onClick={startRun}><Play size={16} /> Start Run</button>
            <button onClick={submitReport}><Send size={16} /> Submit Report</button>
            <button onClick={() => review("needs_revision")}>Request Revision</button>
            <button onClick={() => review("approved")}><Check size={16} /> Approve</button>
            <button onClick={complete}>Complete</button>
            {detail.targetObjectType === "LeanTheorem" && <button onClick={leanCheck}>Lean Check</button>}
            {detail.targetObjectType === "LeanTheorem" && <button onClick={markLeanVerified}>Mark Lean Verified</button>}
          </div>
          <div className="grid two">
            <section className="panel">
              <h2>Brief</h2>
              <p><strong>{detail.coordinatorRole}</strong> · {detail.kind}</p>
              <p>{detail.instructions}</p>
              {detail.targetObjectType && <p><small>Target: {detail.targetObjectType}:{detail.targetObjectId}</small></p>}
              <small>{detail.project.title}{detail.goal ? ` · ${detail.goal.title}` : ""}</small>
            </section>
            <section className="panel">
              <h2>Review</h2>
              <textarea value={reviewBody} onChange={(e) => setReviewBody(e.target.value)} rows={5} placeholder="Review notes" />
            </section>
          </div>
          {briefing && <pre>{JSON.stringify(briefing, null, 2)}</pre>}
          <section>
            <h2>Report</h2>
            <textarea value={reportBody} onChange={(e) => setReportBody(e.target.value)} rows={10} placeholder="Workstream report markdown" />
            {detail.reports[0] && <button onClick={() => onOpenReport(detail.reports[0].id)}>Open Report</button>}
          </section>
          <div className="grid two">
            <section><h2>Reviews</h2><div className="stack">{detail.reviews.map((review) => <div className="task-card" key={review.id}><div><strong>{review.reviewerRole}</strong><span>{review.bodyMarkdown}</span></div><StatusBadge status={review.verdict} /></div>)}</div></section>
            <section><h2>Rendered Report</h2>{reportBody ? <MarkdownRenderer body={reportBody} /> : <p className="notice">No report text yet.</p>}</section>
          </div>
        </>
      )}
    </section>
  )
}
