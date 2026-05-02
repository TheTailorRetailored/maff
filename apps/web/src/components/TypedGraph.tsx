import cytoscape from "cytoscape"
import { useEffect, useRef } from "react"
import type { GraphEdge, GraphNode, NodeIndex } from "../api/client"

type Props = {
  nodes: Array<NodeIndex | GraphNode>
  edges: GraphEdge[]
  onOpenNode: (id: string) => void
  layoutMode?: "dag" | "radial" | "force"
  selectedNodeId?: string
  graphAction?: string
}

function nodeId(node: NodeIndex | GraphNode) {
  return "id" in node ? node.id : node.nodeId
}

function nodeLabel(node: NodeIndex | GraphNode) {
  if ("short_title" in node && node.short_title) return node.short_title
  return node.title
}

function edgeSource(edge: GraphEdge) {
  return edge.source ?? edge.sourceNodeId
}

function edgeTarget(edge: GraphEdge) {
  return edge.target ?? edge.targetNodeId
}

export function TypedGraph({ nodes, edges, onOpenNode, layoutMode = "force", selectedNodeId, graphAction }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const cyRef = useRef<cytoscape.Core | null>(null)
  useEffect(() => {
    if (!ref.current) return
    const layoutName = layoutMode === "dag" ? "breadthfirst" : layoutMode === "radial" ? "circle" : "cose"
    const cy = cytoscape({
      container: ref.current,
      elements: [
        ...nodes.map((n) => ({ data: { id: nodeId(n), label: nodeLabel(n), fullTitle: n.title, type: n.type, depth: "depth" in n ? n.depth : 1 } })),
        ...edges.filter((e) => edgeSource(e) && edgeTarget(e)).map((e, index) => ({ data: { id: e.id ?? `${edgeSource(e)}-${edgeTarget(e)}-${index}`, source: edgeSource(e), target: edgeTarget(e), label: e.label ?? e.edge_type ?? e.edgeType } }))
      ],
      style: [
        { selector: "node", style: { label: "data(label)", "background-color": "#0f766e", color: "#111827", "font-size": "10px", "text-wrap": "wrap", "text-max-width": "120px", width: 34, height: 34 } },
        { selector: 'node[type = "Problem"]', style: { "background-color": "#1d4ed8", width: 46, height: 46, "font-weight": "bold" } },
        { selector: 'node[type = "Claim"]', style: { "background-color": "#0f766e" } },
        { selector: "edge", style: { width: 1.5, "line-color": "#94a3b8", "target-arrow-color": "#94a3b8", "target-arrow-shape": "triangle", "curve-style": "bezier", label: "data(label)", "font-size": "8px", color: "#475569" } },
        { selector: ":selected", style: { "border-width": 3, "border-color": "#f59e0b" } }
      ],
      layout: layoutName === "breadthfirst"
        ? { name: "breadthfirst", directed: true, spacingFactor: 1.25, animate: false }
        : layoutName === "circle"
          ? { name: "circle", animate: false }
          : { name: "cose", animate: false, nodeOverlap: 20 }
    })
    cyRef.current = cy
    cy.on("tap", "node", (evt) => onOpenNode(evt.target.id()))
    cy.ready(() => {
      if (selectedNodeId && cy.getElementById(selectedNodeId).length) {
        cy.getElementById(selectedNodeId).select()
        cy.center(cy.getElementById(selectedNodeId))
        cy.zoom(Math.min(cy.zoom(), 1.3))
      } else {
        cy.fit(undefined, 36)
      }
    })
    return () => {
      cy.destroy()
      cyRef.current = null
    }
  }, [nodes, edges, layoutMode])

  useEffect(() => {
    const cy = cyRef.current
    if (!cy || !graphAction) return
    if (graphAction.startsWith("fit:")) cy.fit(undefined, 36)
    if (graphAction.startsWith("center:") && selectedNodeId && cy.getElementById(selectedNodeId).length) cy.center(cy.getElementById(selectedNodeId))
    if (graphAction.startsWith("relayout:")) {
      const name = layoutMode === "dag" ? "breadthfirst" : layoutMode === "radial" ? "circle" : "cose"
      cy.layout(name === "breadthfirst" ? { name, directed: true, spacingFactor: 1.25, animate: true } : { name, animate: true }).run()
    }
  }, [graphAction, selectedNodeId, layoutMode])

  return <div className="graph-canvas" ref={ref} />
}
