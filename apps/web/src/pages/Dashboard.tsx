import { useEffect, useState } from "react"
import { useApi, type NodeIndex, type TaskIndex, type Workspace } from "../api/client"
import { NodeCard } from "../components/NodeCard"
import { TaskCard } from "../components/TaskCard"

export function Dashboard({ onOpenWorkspace, onOpenNode }: { onOpenWorkspace: (id: string) => void; onOpenNode: (id: string, workspaceId: string) => void }) {
  const { request } = useApi()
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [recent, setRecent] = useState<Record<string, NodeIndex[]>>({})
  const [tasks, setTasks] = useState<Record<string, TaskIndex[]>>({})
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
          const [nodes, workspaceTasks] = await Promise.all([
            request<NodeIndex[]>(`/workspaces/${w.id}/nodes?limit=6`),
            request<TaskIndex[]>(`/workspaces/${w.id}/tasks`)
          ])
          return { workspaceId: w.id, nodes, tasks: workspaceTasks.slice(0, 5) }
        }))
        if (cancelled) return
        setRecent(Object.fromEntries(loaded.map((item) => [item.workspaceId, item.nodes])))
        setTasks(Object.fromEntries(loaded.map((item) => [item.workspaceId, item.tasks])))
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [])

  const workspaceById = new Map(workspaces.map((w) => [w.id, w]))
  const allTasks = Object.entries(tasks).flatMap(([wid, list]) => list.map((task) => ({ wid, task })))
  const allNodes = Object.entries(recent).flatMap(([wid, nodes]) => nodes.map((node) => ({ wid, node })))

  return (
    <section className="page">
      <header><h1>Dashboard</h1></header>
      {loading && <p className="notice">Loading workspaces, nodes, and tasks...</p>}
      {error && <p className="notice error">Could not load Maff data: {error}</p>}
      <div className="grid two">
        <section>
          <h2>Workspaces</h2>
          {!loading && !error && workspaces.length === 0 && <p className="notice">No workspaces are available for this login yet.</p>}
          <div className="stack">{workspaces.map((w) => <button className="workspace-row" key={w.id} onClick={() => onOpenWorkspace(w.id)}><strong>{w.name}</strong><span>{w.slug}</span></button>)}</div>
        </section>
        <section>
          <h2>Active Tasks</h2>
          {!loading && !error && allTasks.length === 0 && <p className="notice">No tasks are indexed yet.</p>}
          <div className="stack">{allTasks.map(({ wid, task }) => <div key={task.id} className="stack-item"><small>{workspaceById.get(wid)?.name ?? wid}</small><TaskCard task={task} /></div>)}</div>
        </section>
      </div>
      <section>
        <h2>Recent Nodes</h2>
        {!loading && !error && allNodes.length === 0 && <p className="notice">No indexed nodes yet. Open a workspace and click Reindex if nodes were created outside the web UI.</p>}
        <div className="cards">{allNodes.map(({ wid, node }) => <div key={`${wid}-${node.nodeId}`} className="card-wrap"><small>{workspaceById.get(wid)?.name ?? wid}</small><NodeCard node={node} onOpen={(id) => onOpenNode(id, wid)} /></div>)}</div>
      </section>
    </section>
  )
}
