import { useEffect, useState } from "react"
import { useApi, type ControlRoom, type Project, type Workspace, type Workstream } from "../api/client"
import { StatusBadge } from "../components/StatusBadge"

export function Dashboard({ onOpenWorkspace, onOpenProject, onOpenWorkstream }: { onOpenWorkspace: (id: string) => void; onOpenProject: (projectId: string, workspaceId: string) => void; onOpenWorkstream: (workstreamId: string, workspaceId: string) => void }) {
  const { request } = useApi()
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [projects, setProjects] = useState<Array<Project & { workspaceName: string }>>([])
  const [needsReview, setNeedsReview] = useState<Array<{ workspaceId: string; project: Project; workstream: Workstream }>>([])
  const [blocked, setBlocked] = useState<Array<{ workspaceId: string; project: Project; workstream: Workstream }>>([])
  const [suggested, setSuggested] = useState<Array<{ workspaceId: string; project: Project; workstream: Workstream }>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError("")
      try {
        const ws = await request<Workspace[]>("/workspaces")
        if (cancelled) return
        setWorkspaces(ws)
        const loaded = await Promise.all(ws.map(async (w) => {
          const workspaceProjects = await request<Project[]>(`/workspaces/${w.id}/projects`)
          const rooms = await Promise.all(workspaceProjects.slice(0, 8).map((project) => request<ControlRoom>(`/workspaces/${w.id}/projects/${project.id}/control-room`)))
          return { workspace: w, projects: workspaceProjects, rooms }
        }))
        if (cancelled) return
        setProjects(loaded.flatMap((item) => item.projects.map((project) => ({ ...project, workspaceName: item.workspace.name }))))
        setNeedsReview(loaded.flatMap((item) => item.rooms.flatMap((room) => room.needs_review.map((workstream) => ({ workspaceId: item.workspace.id, project: room.project, workstream })))))
        setBlocked(loaded.flatMap((item) => item.rooms.flatMap((room) => room.blocked_or_escalated.map((workstream) => ({ workspaceId: item.workspace.id, project: room.project, workstream })))))
        setSuggested(loaded.flatMap((item) => item.rooms.flatMap((room) => room.suggested_next_assignment ? [{ workspaceId: item.workspace.id, project: room.project, workstream: room.suggested_next_assignment }] : [])))
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [])

  return (
    <section className="page">
      <header><h1>Dashboard</h1></header>
      {loading && <p className="notice">Loading projects and workstream state...</p>}
      {error && <p className="notice error">Could not load Maff data: {error}</p>}
      <div className="grid two">
        <section>
          <h2>Workspaces</h2>
          {!loading && !error && workspaces.length === 0 && <p className="notice">No workspaces are available for this login yet.</p>}
          <div className="stack">{workspaces.map((w) => <button className="workspace-row" key={w.id} onClick={() => onOpenWorkspace(w.id)}><strong>{w.name}</strong><span>{w.slug}</span></button>)}</div>
        </section>
        <section>
          <h2>Suggested Assignments</h2>
          {!loading && !error && suggested.length === 0 && <p className="notice">No ready workstreams found.</p>}
          <div className="stack">{suggested.map(({ workspaceId, project, workstream }) => <button className="task-card" key={`${workspaceId}-${workstream.id}`} onClick={() => onOpenWorkstream(workstream.id, workspaceId)}><div><strong>{workstream.title}</strong><span>{project.title} · {workstream.coordinatorRole}</span></div><StatusBadge status={workstream.status} /></button>)}</div>
        </section>
      </div>
      <section>
        <h2>Projects</h2>
        {!loading && !error && projects.length === 0 && <p className="notice">No v2 projects yet. Create one from Projects.</p>}
        <div className="cards">{projects.map((project) => <button key={project.id} className="node-card" onClick={() => onOpenProject(project.id, project.workspaceId)}><strong>{project.title}</strong><StatusBadge status={project.status} /><span>{project.workspaceName} · {project.area || project.slug}</span><p>{project.coordinatorSummary || project.statement}</p></button>)}</div>
      </section>
      <div className="grid two">
        <section>
          <h2>Needs Review</h2>
          <div className="stack">{needsReview.map(({ workspaceId, project, workstream }) => <button className="task-card" key={`${workspaceId}-${workstream.id}`} onClick={() => onOpenWorkstream(workstream.id, workspaceId)}><div><strong>{workstream.title}</strong><span>{project.title}</span></div><StatusBadge status={workstream.status} /></button>)}</div>
        </section>
        <section>
          <h2>Blocked Or Escalated</h2>
          <div className="stack">{blocked.map(({ workspaceId, project, workstream }) => <button className="task-card" key={`${workspaceId}-${workstream.id}`} onClick={() => onOpenWorkstream(workstream.id, workspaceId)}><div><strong>{workstream.title}</strong><span>{project.title}</span></div><StatusBadge status={workstream.status} /></button>)}</div>
        </section>
      </div>
    </section>
  )
}
