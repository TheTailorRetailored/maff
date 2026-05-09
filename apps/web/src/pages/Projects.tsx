import { Plus } from "lucide-react"
import { useEffect, useState } from "react"
import { useApi, type Project } from "../api/client"
import { StatusBadge } from "../components/StatusBadge"
import { WorkspacePicker } from "../components/WorkspacePicker"

export function Projects({ workspaceId, setWorkspaceId, onOpenProject }: { workspaceId: string; setWorkspaceId: (id: string) => void; onOpenProject: (id: string) => void }) {
  const { request } = useApi()
  const [projects, setProjects] = useState<Project[]>([])
  const [title, setTitle] = useState("")
  const [area, setArea] = useState("")
  const [statement, setStatement] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  async function refresh() {
    if (!workspaceId) return
    setLoading(true)
    setError("")
    try {
      setProjects(await request<Project[]>(`/workspaces/${workspaceId}/projects`))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void refresh() }, [workspaceId])

  async function createProject() {
    if (!title.trim() || !statement.trim()) return
    try {
      const project = await request<Project>(`/workspaces/${workspaceId}/projects`, { method: "POST", body: JSON.stringify({ title, area, statement }) })
      setTitle("")
      setArea("")
      setStatement("")
      onOpenProject(project.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <section className="page">
      <header><h1>Projects</h1><WorkspacePicker value={workspaceId} onChange={setWorkspaceId} /></header>
      {error && <p className="notice error">{error}</p>}
      <section className="panel form-grid">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Project title" />
        <input value={area} onChange={(e) => setArea(e.target.value)} placeholder="Area" />
        <textarea value={statement} onChange={(e) => setStatement(e.target.value)} placeholder="Project statement" rows={3} />
        <button disabled={!workspaceId || !title.trim() || !statement.trim()} onClick={createProject}><Plus size={16} /> Create Project</button>
      </section>
      {loading && <p className="notice">Loading projects...</p>}
      <div className="cards">
        {projects.map((project) => (
          <button key={project.id} className="node-card" onClick={() => onOpenProject(project.id)}>
            <strong>{project.title}</strong>
            <StatusBadge status={project.status} />
            <span>{project.area || project.slug}</span>
            <p>{project.statement}</p>
          </button>
        ))}
      </div>
    </section>
  )
}
