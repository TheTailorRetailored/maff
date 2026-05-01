import type { TaskIndex } from "../api/client"
import { StatusBadge } from "./StatusBadge"

export function TaskCard({ task, onComplete }: { task: TaskIndex; onComplete?: (id: string) => void }) {
  return (
    <div className="task-card">
      <div>
        <strong>{task.workflow}</strong>
        <span>Priority {task.priority}</span>
      </div>
      <StatusBadge status={task.status} />
      {onComplete && <button onClick={() => onComplete(task.id)}>Complete</button>}
    </div>
  )
}

