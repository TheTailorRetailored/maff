import { BookOpen, CheckSquare, Home, Network, Settings, Sigma, TerminalSquare } from "lucide-react"

const nav = [
  [Home, "Dashboard"], [BookOpen, "Projects"], [CheckSquare, "Reviews"],
  [Network, "Objects"], [Sigma, "Skills"], [TerminalSquare, "Lean"], [Settings, "Settings"]
] as const

export function DemoApp() {
  return (
    <div className="shell demo-shell">
      <aside>
        <div className="brand">Maff</div>
        {nav.map(([Icon, label], index) => <button key={label} className={index === 0 ? "active" : ""} type="button"><Icon size={18} /><span>{label}</span></button>)}
        <div className="demo-identity">Synthetic demo</div>
      </aside>
      <main>
        <section className="page demo-page">
          <header><div><p className="eyebrow">Research overview</p><h1>Dashboard</h1></div><span className="demo-pill">Read-only demo</span></header>
          <div className="demo-stats">
            <div><strong>1</strong><span>active project</span></div><div><strong>4</strong><span>claims</span></div>
            <div><strong>2</strong><span>open routes</span></div><div><strong>1</strong><span>review pending</span></div>
          </div>
          <div className="grid two">
            <section className="demo-panel"><p className="eyebrow">Active project</p><h2>Finite Difference Stability</h2><p>Determine when the explicit centred scheme for the one-dimensional heat equation is stable.</p><div className="demo-meta"><span>Numerical analysis</span><span className="status active">active</span></div></section>
            <section className="demo-panel"><p className="eyebrow">Suggested assignment</p><h2>Check the endpoint r = 1/2</h2><p>Verify the Fourier-mode argument at the boundary and record any equality cases.</p><div className="demo-meta"><span>Proof attempt</span><span className="status seed">ready</span></div></section>
          </div>
          <section className="demo-panel graph-preview">
            <div><p className="eyebrow">Claim graph</p><h2>Current dependency slice</h2></div>
            <div className="demo-graph" aria-label="Synthetic claim dependency graph"><span className="graph-node definition">Amplification<br />factor</span><span className="graph-edge">→</span><span className="graph-node claim">CFL condition<br />is sufficient</span><span className="graph-edge">→</span><span className="graph-node review">Endpoint<br />review</span></div>
          </section>
        </section>
      </main>
    </div>
  )
}
