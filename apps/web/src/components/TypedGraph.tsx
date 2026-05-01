import cytoscape from "cytoscape"
import { useEffect, useRef } from "react"
import type { NodeIndex } from "../api/client"

export function TypedGraph({ nodes, edges, onOpenNode }: { nodes: NodeIndex[]; edges: any[]; onOpenNode: (id: string) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!ref.current) return
    const cy = cytoscape({
      container: ref.current,
      elements: [
        ...nodes.map((n) => ({ data: { id: n.nodeId, label: n.title, type: n.type } })),
        ...edges.filter((e) => e.targetNodeId).map((e) => ({ data: { id: e.id, source: e.sourceNodeId, target: e.targetNodeId, label: e.edgeType } }))
      ],
      style: [
        { selector: "node", style: { label: "data(label)", "background-color": "#0f766e", color: "#111827", "font-size": "10px", "text-wrap": "wrap", "text-max-width": "120px" } },
        { selector: "edge", style: { width: 1, "line-color": "#94a3b8", "target-arrow-color": "#94a3b8", "target-arrow-shape": "triangle", "curve-style": "bezier" } }
      ],
      layout: { name: "cose", animate: false }
    })
    cy.on("tap", "node", (evt) => onOpenNode(evt.target.id()))
    return () => cy.destroy()
  }, [nodes, edges])
  return <div className="graph-canvas" ref={ref} />
}
