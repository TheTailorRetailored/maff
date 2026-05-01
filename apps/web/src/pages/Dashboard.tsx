import { useEffect, useState } from "react"
import { useApi, type NodeIndex, type TaskIndex, type Workspace } from "../api/client"
import { NodeCard } from "../components/NodeCard"
import { TaskCard } from "../components/TaskCard"

export function Dashboard({ onOpenWorkspace, onOpenNode }: { onOpenWorkspace: (id: string) => void; onOpenNode: (id: string, workspaceId: string) => void }) {
  const { request } = useApi()
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [recent, setRecent] = useState<Record<string, NodeIndex[]>>({})
  const [tasks, setTasks] = useState<Record<string, TaskIndex[]>>({})

  useEffect(() => {
    request<Workspace[]>("/workspaces").then(async (ws) => {
      setWorkspaces(ws)
      for (const w of ws) {
        request<NodeIndex[]>(`/workspaces/${w.id}/nodes?limit=6`).then((n) => setRecent((r) => ({ ...r, [w.id]: n })))
        request<TaskIndex[]>(`/workspaces/${w.id}/tasks`).then((t) => setTasks((r) => ({ ...r, [w.id]: t.slice(0, 5) })))
      }
    })
  }, [])

  return (
    <section className="page">
      <header><h1>Dashboard</h1></header>
      <div className="grid two">
        <section>
          <h2>Workspaces</h2>
          <div className="stack">{workspaces.map((w) => <button className="workspace-row" key={w.id} onClick={() => onOpenWorkspace(w.id)}><strong>{w.name}</strong><span>{w.slug}</span></button>)}</div>
        </section>
        <section>
          <h2>Active Tasks</h2>
          <div className="stack">{Object.entries(tasks).flatMap(([wid, list]) => list.map((t) => <TaskCard key={t.id} task={t} />))}</div>
        </section>
      </div>
      <section>
        <h2>Recent Nodes</h2>
        <div className="cards">{Object.entries(recent).flatMap(([wid, nodes]) => nodes.map((n) => <NodeCard key={`${wid}-${n.nodeId}`} node={n} onOpen={(id) => onOpenNode(id, wid)} />))}</div>
      </section>
    </section>
  )
}

