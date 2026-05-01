import { useEffect, useState } from "react"
import { useApi, type NodeIndex } from "../api/client"
import { TypedGraph } from "../components/TypedGraph"
import { WorkspacePicker } from "../components/WorkspacePicker"

export function GraphView({ workspaceId, setWorkspaceId, onOpenNode }: { workspaceId: string; setWorkspaceId: (id: string) => void; onOpenNode: (id: string) => void }) {
  const { request } = useApi()
  const [graph, setGraph] = useState<{ nodes: NodeIndex[]; edges: any[] }>({ nodes: [], edges: [] })
  useEffect(() => { if (workspaceId) request<any>(`/workspaces/${workspaceId}/graph`).then(setGraph) }, [workspaceId])
  return <section className="page"><header><h1>Graph</h1><WorkspacePicker value={workspaceId} onChange={setWorkspaceId} /></header><TypedGraph nodes={graph.nodes} edges={graph.edges} onOpenNode={onOpenNode} /></section>
}

