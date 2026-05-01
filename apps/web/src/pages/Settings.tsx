import { useEffect, useState } from "react"
import { useApi } from "../api/client"

export function SettingsPage() {
  const { request } = useApi()
  const [debug, setDebug] = useState("")
  useEffect(() => { request("/auth/debug-token").then((r) => setDebug(JSON.stringify(r, null, 2))).catch((e) => setDebug(String(e))) }, [])
  return <section className="page"><header><h1>Settings</h1></header><pre>{debug}</pre></section>
}
