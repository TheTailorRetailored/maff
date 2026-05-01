import { useEffect, useState } from "react"
import { useApi, type NodeIndex } from "../api/client"
import { NodeCard } from "../components/NodeCard"
import { WorkspacePicker } from "../components/WorkspacePicker"

export function Workspace({ workspaceId, setWorkspaceId, onOpenNode }: { workspaceId: string; setWorkspaceId: (id: string) => void; onOpenNode: (id: string) => void }) {
  const { request } = useApi()
  const [nodes, setNodes] = useState<NodeIndex[]>([])
  const [title, setTitle] = useState("")
  const [type, setType] = useState("Problem")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const refresh = () => {
    if (!workspaceId) return Promise.resolve()
    setLoading(true)
    setError("")
    return request<NodeIndex[]>(`/workspaces/${workspaceId}/nodes?limit=100`)
      .then(setNodes)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false))
  }
  useEffect(() => { void refresh() }, [workspaceId])

  async function createNode() {
    if (!title.trim()) return
    try {
      setError("")
      const metadata = type === "Claim"
        ? { status: "active", claim_kind: "conjecture", claim_status: "idea", role: "main_result", proof_status: "none", lean_status: "not_started" }
        : { status: "seed" }
      await request(`/workspaces/${workspaceId}/nodes`, { method: "POST", body: JSON.stringify({ title, type, metadata }) })
      setTitle("")
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <section className="page">
      <header><h1>Workspace</h1><WorkspacePicker value={workspaceId} onChange={setWorkspaceId} /></header>
      <div className="toolbar">
        <button disabled={!workspaceId} onClick={() => request(`/workspaces/${workspaceId}/reindex`, { method: "POST" }).then(refresh).catch((err) => setError(err instanceof Error ? err.message : String(err)))}>Reindex</button>
        <button disabled={!workspaceId} onClick={() => request(`/workspaces/${workspaceId}/quartz/rebuild`, { method: "POST" }).catch((err) => setError(err instanceof Error ? err.message : String(err)))}>Rebuild Quartz</button>
        <select value={type} onChange={(e) => setType(e.target.value)}><option>Problem</option><option>Claim</option><option>Definition</option><option>Paper</option><option>KnownResult</option><option>Experiment</option><option>FormalizationTarget</option></select>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New node title" />
        <button disabled={!workspaceId} onClick={createNode}>New Node</button>
      </div>
      {!workspaceId && <p className="notice">Choose a workspace to view its graph nodes.</p>}
      {loading && <p className="notice">Loading nodes...</p>}
      {error && <p className="notice error">Could not load workspace data: {error}</p>}
      {!loading && !error && workspaceId && nodes.length === 0 && <p className="notice">No indexed nodes in this workspace yet. If ChatGPT just created one, click Reindex.</p>}
      <div className="cards">{nodes.map((node) => <NodeCard key={node.nodeId} node={node} onOpen={onOpenNode} />)}</div>
    </section>
  )
}
