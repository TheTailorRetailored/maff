import { useEffect, useState } from "react"
import { useApi, type NodeIndex } from "../api/client"
import { NodeCard } from "../components/NodeCard"
import { WorkspacePicker } from "../components/WorkspacePicker"

export function Workspace({ workspaceId, setWorkspaceId, onOpenNode }: { workspaceId: string; setWorkspaceId: (id: string) => void; onOpenNode: (id: string) => void }) {
  const { request } = useApi()
  const [nodes, setNodes] = useState<NodeIndex[]>([])
  const [title, setTitle] = useState("")
  const [type, setType] = useState("Problem")

  const refresh = () => {
    if (!workspaceId) return Promise.resolve()
    return request<NodeIndex[]>(`/workspaces/${workspaceId}/nodes?limit=100`).then(setNodes)
  }
  useEffect(() => { void refresh() }, [workspaceId])

  async function createNode() {
    if (!title.trim()) return
    await request(`/workspaces/${workspaceId}/nodes`, { method: "POST", body: JSON.stringify({ title, type, metadata: { status: type === "Task" ? "open" : "seed" }, body: `# ${type}: ${title}\n\n## Statement\n\n` }) })
    setTitle("")
    refresh()
  }

  return (
    <section className="page">
      <header><h1>Workspace</h1><WorkspacePicker value={workspaceId} onChange={setWorkspaceId} /></header>
      <div className="toolbar">
        <button onClick={() => request(`/workspaces/${workspaceId}/reindex`, { method: "POST" }).then(refresh)}>Reindex</button>
        <button onClick={() => request(`/workspaces/${workspaceId}/quartz/rebuild`, { method: "POST" })}>Rebuild Quartz</button>
        <select value={type} onChange={(e) => setType(e.target.value)}><option>Problem</option><option>Conjecture</option><option>ProofRoute</option><option>Gap</option><option>Task</option><option>FormalizationTarget</option></select>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New node title" />
        <button onClick={createNode}>New Node</button>
      </div>
      <div className="cards">{nodes.map((node) => <NodeCard key={node.nodeId} node={node} onOpen={onOpenNode} />)}</div>
    </section>
  )
}
