import { useEffect, useState } from "react"
import { useApi, type TaskIndex } from "../api/client"
import { MarkdownRenderer } from "../components/MarkdownRenderer"
import { TaskCard } from "../components/TaskCard"

export function NodeView({ workspaceId, nodeId }: { workspaceId: string; nodeId: string; onOpenNode: (id: string) => void }) {
  const { request } = useApi()
  const [node, setNode] = useState<{ metadata: Record<string, unknown>; body: string; path: string } | null>(null)
  const [section, setSection] = useState("Decision log")
  const [content, setContent] = useState("")
  const [status, setStatus] = useState("")
  const [tasks, setTasks] = useState<TaskIndex[]>([])
  const refresh = () => {
    if (!workspaceId || !nodeId) return Promise.resolve()
    return Promise.all([
      request<any>(`/workspaces/${workspaceId}/nodes/${nodeId}`),
      request<TaskIndex[]>(`/workspaces/${workspaceId}/tasks?targetNodeId=${encodeURIComponent(nodeId)}`)
    ]).then(([n, nodeTasks]) => { setNode(n); setStatus(String(n.metadata.status ?? n.metadata.claim_status ?? "")); setTasks(nodeTasks) })
  }
  useEffect(() => { void refresh() }, [workspaceId, nodeId])
  if (!workspaceId || !nodeId) return <section className="page"><h1>Node</h1><p>Select a node from a workspace or graph.</p></section>
  if (!node) return <section className="page"><h1>Node</h1><p>Loading...</p></section>
  return (
    <section className="page">
      <header><h1>{String(node.metadata.title ?? node.metadata.id)}</h1><span>{node.path}</span></header>
      <div className="grid two">
        <section>
          <MarkdownRenderer body={node.body} />
        </section>
        <aside className="panel">
          <h2>Metadata</h2>
          <pre>{JSON.stringify(node.metadata, null, 2)}</pre>
          <h2>Attached Tasks</h2>
          <div className="stack">
            {tasks.length === 0 && <p className="notice">No attached tasks.</p>}
            {tasks.map((task) => <TaskCard key={task.id} task={task} />)}
          </div>
          <div className="toolbar compact">
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              {["seed", "active", "lit_checked", "route_active", "proof_candidate", "informally_proved", "formalizing", "lean_verified", "paused", "killed", "open", "closed"].map((s) => <option key={s}>{s}</option>)}
            </select>
            <button onClick={() => request(`/workspaces/${workspaceId}/nodes/${nodeId}/status`, { method: "POST", body: JSON.stringify({ status, reason: "Updated from web UI" }) }).then(refresh)}>Set</button>
          </div>
          <h2>Append</h2>
          <input value={section} onChange={(e) => setSection(e.target.value)} />
          <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={8} />
          <button onClick={() => request(`/workspaces/${workspaceId}/nodes/${nodeId}/append`, { method: "POST", body: JSON.stringify({ section, content }) }).then(() => { setContent(""); refresh() })}>Append</button>
        </aside>
      </div>
    </section>
  )
}
