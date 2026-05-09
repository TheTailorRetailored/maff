import { useEffect, useState } from "react"
import { useApi, type ReviewRound, type WorkstreamReport } from "../api/client"
import { MarkdownRenderer } from "../components/MarkdownRenderer"
import { StatusBadge } from "../components/StatusBadge"

type ReportDetail = WorkstreamReport & { reviews: ReviewRound[]; workstream: { title: string; status: string } }

export function ReportView({ workspaceId, reportId }: { workspaceId: string; reportId: string }) {
  const { request } = useApi()
  const [report, setReport] = useState<ReportDetail | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!workspaceId || !reportId) return
    request<ReportDetail>(`/workspaces/${workspaceId}/reports/${reportId}`).then(setReport).catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [workspaceId, reportId])

  return (
    <section className="page">
      {error && <p className="notice error">{error}</p>}
      {!report && <p className="notice">Open a report from a workstream.</p>}
      {report && (
        <>
          <header><h1>{report.title}</h1><StatusBadge status={report.status} /></header>
          <MarkdownRenderer body={report.bodyMarkdown} />
          <h2>Review History</h2>
          <div className="stack">{report.reviews.map((review) => <div className="task-card" key={review.id}><div><strong>{review.reviewerRole}</strong><span>{review.bodyMarkdown}</span></div><StatusBadge status={review.verdict} /></div>)}</div>
        </>
      )}
    </section>
  )
}
