import { useEffect, useState } from "react"
import { useApi, type ControlRoom, type Project, type Workstream } from "../api/client"
import { StatusBadge } from "../components/StatusBadge"
import { WorkspacePicker } from "../components/WorkspacePicker"

export function ReviewQueue({ workspaceId, setWorkspaceId, onOpenWorkstream }: { workspaceId: string; setWorkspaceId: (id: string) => void; onOpenWorkstream: (id: string) => void }) {
  const { request } = useApi()
  const [items, setItems] = useState<Array<{ project: Project; workstream: Workstream }>>([])
  const [error, setError] = useState("")

  useEffect(() => {
    if (!workspaceId) return
    async function load() {
      try {
        const projects = await request<Project[]>(`/workspaces/${workspaceId}/projects`)
        const rooms = await Promise.all(projects.map((project) => request<ControlRoom>(`/workspaces/${workspaceId}/projects/${project.id}/control-room`)))
        setItems(rooms.flatMap((room) => room.needs_review.map((workstream) => ({ project: room.project, workstream }))))
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    }
    void load()
  }, [workspaceId])

  return (
    <section className="page">
      <header><h1>Review Queue</h1><WorkspacePicker value={workspaceId} onChange={setWorkspaceId} /></header>
      {error && <p className="notice error">{error}</p>}
      {items.length === 0 && <p className="notice">No reports need review.</p>}
      <div className="stack">{items.map(({ project, workstream }) => <button className="task-card" key={workstream.id} onClick={() => onOpenWorkstream(workstream.id)}><div><strong>{workstream.title}</strong><span>{project.title} · {workstream.coordinatorRole}</span></div><StatusBadge status={workstream.status} /></button>)}</div>
    </section>
  )
}
