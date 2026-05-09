import { useApi } from "../api/client"

export function AgentRunView() {
  void useApi
  return (
    <section className="page">
      <header><h1>Agent Run</h1></header>
      <p className="notice">Agent runs are visible inside each Workstream view for this milestone.</p>
    </section>
  )
}
