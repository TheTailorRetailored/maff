import { useState } from "react"
import { useApi } from "../api/client"
import { WorkspacePicker } from "../components/WorkspacePicker"

export function LeanJobs({ workspaceId, setWorkspaceId }: { workspaceId: string; setWorkspaceId: (id: string) => void }) {
  const { request } = useApi()
  const [projectName, setProjectName] = useState("ResearchGraph")
  const [result, setResult] = useState("")
  return (
    <section className="page">
      <header><h1>Lean</h1><WorkspacePicker value={workspaceId} onChange={setWorkspaceId} /></header>
      <div className="toolbar">
        <input value={projectName} onChange={(e) => setProjectName(e.target.value)} />
        <button onClick={() => request(`/workspaces/${workspaceId}/lean/project`, { method: "POST", body: JSON.stringify({ projectName }) }).then((r) => setResult(JSON.stringify(r, null, 2)))}>Create Project</button>
      </div>
      <pre>{result}</pre>
    </section>
  )
}

