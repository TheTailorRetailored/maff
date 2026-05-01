import { useEffect, useState } from "react"
import { useApi, type TaskIndex } from "../api/client"
import { TaskCard } from "../components/TaskCard"
import { WorkspacePicker } from "../components/WorkspacePicker"

export function Tasks({ workspaceId, setWorkspaceId }: { workspaceId: string; setWorkspaceId: (id: string) => void }) {
  const { request } = useApi()
  const [tasks, setTasks] = useState<TaskIndex[]>([])
  const refresh = () => {
    if (!workspaceId) return Promise.resolve()
    return request<TaskIndex[]>(`/workspaces/${workspaceId}/tasks`).then(setTasks)
  }
  useEffect(() => { void refresh() }, [workspaceId])
  return <section className="page"><header><h1>Tasks</h1><WorkspacePicker value={workspaceId} onChange={setWorkspaceId} /></header><div className="stack">{tasks.map((t) => <TaskCard key={t.id} task={t} onComplete={(id) => request(`/workspaces/${workspaceId}/tasks/${id}/complete`, { method: "POST", body: JSON.stringify({ outcomeSummary: "Completed from web UI" }) }).then(refresh)} />)}</div></section>
}
