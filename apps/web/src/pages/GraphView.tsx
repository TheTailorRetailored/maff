import { useEffect, useState } from "react"
import { useApi, type NodeIndex } from "../api/client"
import { TypedGraph } from "../components/TypedGraph"
import { WorkspacePicker } from "../components/WorkspacePicker"

export function GraphView({ workspaceId, setWorkspaceId, onOpenNode }: { workspaceId: string; setWorkspaceId: (id: string) => void; onOpenNode: (id: string) => void }) {
  const { request } = useApi()
  const [graph, setGraph] = useState<{ nodes: NodeIndex[]; edges: any[] }>({ nodes: [], edges: [] })
  const [toggles, setToggles] = useState<Record<string, boolean>>({})
  useEffect(() => {
    if (!workspaceId) return
    const query = new URLSearchParams(Object.entries(toggles).filter(([, enabled]) => enabled).map(([key]) => [key, "true"]))
    request<any>(`/workspaces/${workspaceId}/graph${query.size ? `?${query}` : ""}`).then(setGraph)
  }, [workspaceId, toggles])
  const options = [
    ["showKilled", "Killed"],
    ["showRouteNodes", "Routes"],
    ["showProofAttempts", "Attempts"],
    ["showGapNodes", "Gaps"],
    ["showBodyWikilinks", "Body links"],
    ["showContextEdges", "Context"]
  ] as const
  return (
    <section className="page">
      <header><h1>Graph</h1><WorkspacePicker value={workspaceId} onChange={setWorkspaceId} /></header>
      <div className="toolbar compact">
        {options.map(([key, label]) => <label className="check" key={key}><input type="checkbox" checked={Boolean(toggles[key])} onChange={(e) => setToggles((t) => ({ ...t, [key]: e.target.checked }))} /> {label}</label>)}
      </div>
      <TypedGraph nodes={graph.nodes} edges={graph.edges} onOpenNode={onOpenNode} />
    </section>
  )
}
