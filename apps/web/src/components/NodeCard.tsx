import type { NodeIndex } from "../api/client"
import { StatusBadge } from "./StatusBadge"

export function NodeCard({ node, onOpen }: { node: NodeIndex; onOpen: (id: string) => void }) {
  return (
    <button className="node-card" onClick={() => onOpen(node.nodeId)}>
      <strong>{node.title}</strong>
      <span>{node.type}{node.area ? ` / ${node.area}` : ""}</span>
      <StatusBadge status={node.status} />
      <p>{node.bodyPreview}</p>
    </button>
  )
}

