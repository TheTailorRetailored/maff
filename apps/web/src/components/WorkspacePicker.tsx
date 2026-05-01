import { useEffect, useState } from "react"
import { useApi, type Workspace } from "../api/client"

export function WorkspacePicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { request } = useApi()
  const [items, setItems] = useState<Workspace[]>([])
  const [error, setError] = useState("")
  useEffect(() => {
    request<Workspace[]>("/workspaces")
      .then((ws) => { setItems(ws); if (!value && ws[0]) onChange(ws[0].id) })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [])
  return (
    <span className="picker">
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{error ? "Workspace load failed" : "Choose workspace"}</option>
        {items.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
      </select>
      {error && <small>{error}</small>}
    </span>
  )
}
