import { useEffect, useState } from "react"
import { useApi, type Project } from "../api/client"
import { StatusBadge } from "../components/StatusBadge"
import { WorkspacePicker } from "../components/WorkspacePicker"

type ObjectGraphData = { nodes: Array<{ id: string; type: string; title?: string; status?: string; statementMarkdown?: string; descriptionMarkdown?: string }>; edges: Array<{ id: string; sourceType: string; sourceId: string; targetType: string; targetId: string; edgeType: string }> }

export function ObjectGraph({ workspaceId, setWorkspaceId }: { workspaceId: string; setWorkspaceId: (id: string) => void }) {
  const { request } = useApi()
  const [projects, setProjects] = useState<Project[]>([])
  const [projectId, setProjectId] = useState("")
  const [graph, setGraph] = useState<ObjectGraphData>({ nodes: [], edges: [] })
  const [error, setError] = useState("")

  useEffect(() => {
    if (!workspaceId) return
    request<Project[]>(`/workspaces/${workspaceId}/projects`).then((items) => { setProjects(items); if (!projectId && items[0]) setProjectId(items[0].id) }).catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [workspaceId])

  useEffect(() => {
    if (!workspaceId) return
    const qs = projectId ? `?projectId=${projectId}` : ""
    request<ObjectGraphData>(`/workspaces/${workspaceId}/objects/graph${qs}`).then(setGraph).catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [workspaceId, projectId])

  return (
    <section className="page">
      <header>
        <h1>Object Graph</h1>
        <div className="toolbar compact">
          <WorkspacePicker value={workspaceId} onChange={setWorkspaceId} />
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)}><option value="">All projects</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}</select>
        </div>
      </header>
      {error && <p className="notice error">{error}</p>}
      <div className="grid two">
        <section><h2>Typed Nodes</h2><div className="cards">{graph.nodes.map((node) => <div className="node-card" key={`${node.type}-${node.id}`}><strong>{node.title ?? node.id}</strong><StatusBadge status={node.status ?? node.type} /><span>{node.type}</span><p>{node.statementMarkdown ?? node.descriptionMarkdown ?? ""}</p></div>)}</div></section>
        <section><h2>Edges</h2><div className="stack">{graph.edges.map((edge) => <div className="task-card" key={edge.id}><div><strong>{edge.edgeType}</strong><span>{edge.sourceType}:{edge.sourceId.slice(0, 8)} {"->"} {edge.targetType}:{edge.targetId.slice(0, 8)}</span></div></div>)}</div></section>
      </div>
    </section>
  )
}
