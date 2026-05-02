import { useEffect, useState } from "react"
import { useApi, type ProblemGraph, type ProblemSummary } from "../api/client"
import { TypedGraph } from "../components/TypedGraph"
import { WorkspacePicker } from "../components/WorkspacePicker"

export function GraphView({ workspaceId, setWorkspaceId, onOpenNode }: { workspaceId: string; setWorkspaceId: (id: string) => void; onOpenNode: (id: string) => void }) {
  const { request } = useApi()
  const [problems, setProblems] = useState<ProblemSummary[]>([])
  const [problemId, setProblemId] = useState("")
  const [graph, setGraph] = useState<ProblemGraph>({ nodes: [], edges: [] })
  const [toggles, setToggles] = useState<Record<string, boolean>>({})
  const [layoutMode, setLayoutMode] = useState<"dag" | "radial" | "force">("dag")
  const [selectedNodeId, setSelectedNodeId] = useState("")
  const [graphAction, setGraphAction] = useState("")

  useEffect(() => {
    if (!workspaceId) return
    request<ProblemSummary[]>(`/workspaces/${workspaceId}/problems`).then((items) => {
      setProblems(items)
      setProblemId((current) => current || items[0]?.id || "")
    })
  }, [workspaceId])

  useEffect(() => {
    if (!workspaceId || !problemId) return
    const query = new URLSearchParams([
      ["mode", layoutMode === "radial" ? "neighborhood" : layoutMode === "force" ? "exploratory" : "claim_graph"],
      ...Object.entries(toggles).filter(([, enabled]) => enabled).map(([key]) => [key, "true"] as [string, string])
    ])
    if (selectedNodeId) query.set("selectedNodeId", selectedNodeId)
    request<ProblemGraph>(`/workspaces/${workspaceId}/problems/${problemId}/graph?${query}`).then((result) => {
      setGraph(result)
      setSelectedNodeId((current) => current || result.layout_hint?.root_node_id || "")
    })
  }, [workspaceId, problemId, toggles, layoutMode])

  const options = [
    ["includeArchived", "Archived/killed"],
    ["includeTasks", "Tasks"],
    ["includeRoutes", "Routes"],
    ["includeAttempts", "Attempts"],
    ["includeGaps", "Gaps"],
    ["includeBodyWikilinks", "Body links"]
  ] as const
  const selectedProblem = problems.find((problem) => problem.id === problemId)
  return (
    <section className="page">
      <header><h1>Graph</h1><WorkspacePicker value={workspaceId} onChange={setWorkspaceId} /></header>
      <div className="toolbar compact">
        <select value={problemId} onChange={(e) => { setProblemId(e.target.value); setSelectedNodeId("") }}>
          <option value="">Choose problem</option>
          {problems.map((problem) => <option key={problem.id} value={problem.id}>{problem.short_title || problem.title}</option>)}
        </select>
        <select value={layoutMode} onChange={(e) => setLayoutMode(e.target.value as "dag" | "radial" | "force")}>
          <option value="dag">DAG</option>
          <option value="radial">Radial</option>
          <option value="force">Force</option>
        </select>
        <select value={selectedNodeId} onChange={(e) => setSelectedNodeId(e.target.value)}>
          <option value="">Center node</option>
          {graph.nodes.map((node) => <option key={node.id} value={node.id}>{node.short_title || node.title}</option>)}
        </select>
        <button onClick={() => setGraphAction(`fit:${Date.now()}`)}>Fit to graph</button>
        <button onClick={() => setGraphAction(`center:${Date.now()}`)}>Center selected</button>
        <button onClick={() => setGraphAction(`relayout:${Date.now()}`)}>Re-layout</button>
        {options.map(([key, label]) => <label className="check" key={key}><input type="checkbox" checked={Boolean(toggles[key])} onChange={(e) => setToggles((t) => ({ ...t, [key]: e.target.checked }))} /> {label}</label>)}
      </div>
      {!problemId && <div className="cards">{problems.map((problem) => <button className="node-card" key={problem.id} onClick={() => setProblemId(problem.id)}><strong>{problem.short_title || problem.title}</strong><span>{problem.status}</span><p>{problem.active_claim_count} active claims / {problem.open_task_count} open tasks</p><p>{problem.next_recommended_workflow}</p></button>)}</div>}
      {problemId && selectedProblem && <p className="notice">{selectedProblem.short_title || selectedProblem.title}: {selectedProblem.active_claim_count} active claims, {selectedProblem.open_task_count} open tasks.</p>}
      {problemId && <TypedGraph nodes={graph.nodes} edges={graph.edges} onOpenNode={(id) => { setSelectedNodeId(id); onOpenNode(id) }} layoutMode={layoutMode} selectedNodeId={selectedNodeId} graphAction={graphAction} />}
    </section>
  )
}
