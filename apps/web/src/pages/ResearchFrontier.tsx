import { GitBranch, Plus, Rocket } from "lucide-react"
import { useEffect, useState } from "react"
import { useApi, type AssumptionRegime, type FrontierSnapshot, type Mechanism, type ResearchArtifact, type ResearchDelta, type SpinoutCandidate, type TheoremContract } from "../api/client"
import { MarkdownRenderer } from "../components/MarkdownRenderer"
import { StatusBadge } from "../components/StatusBadge"
import { WorkspacePicker } from "../components/WorkspacePicker"

type Tab = "map" | "mechanisms" | "spinouts" | "deltas" | "artifacts"

function firstText(...values: Array<string | undefined>) {
  return values.find((value) => value && value.trim()) ?? ""
}

function MiniMarkdown({ value }: { value?: string }) {
  if (!value) return null
  return <MarkdownRenderer body={value.length > 700 ? `${value.slice(0, 700)}...` : value} />
}

export function ResearchFrontier({ workspaceId, setWorkspaceId, projectId, onOpenProject }: { workspaceId: string; setWorkspaceId: (id: string) => void; projectId: string; onOpenProject: (id: string) => void }) {
  const { request } = useApi()
  const [tab, setTab] = useState<Tab>("map")
  const [snapshot, setSnapshot] = useState<FrontierSnapshot | null>(null)
  const [contracts, setContracts] = useState<TheoremContract[]>([])
  const [mechanisms, setMechanisms] = useState<Mechanism[]>([])
  const [spinouts, setSpinouts] = useState<SpinoutCandidate[]>([])
  const [regimes, setRegimes] = useState<AssumptionRegime[]>([])
  const [deltas, setDeltas] = useState<ResearchDelta[]>([])
  const [artifacts, setArtifacts] = useState<ResearchArtifact[]>([])
  const [quickTitle, setQuickTitle] = useState("")
  const [quickText, setQuickText] = useState("")
  const [error, setError] = useState("")

  const qs = workspaceId ? `workspaceId=${workspaceId}${projectId ? `&projectId=${projectId}` : ""}` : ""

  async function refresh() {
    if (!workspaceId) return
    setError("")
    try {
      const [latest, nextContracts, nextMechanisms, nextSpinouts, nextRegimes, nextDeltas, nextArtifacts] = await Promise.all([
        request<FrontierSnapshot | null>(`/research/frontier/latest?${qs}`),
        request<TheoremContract[]>(`/research/contracts?${qs}`),
        request<Mechanism[]>(`/research/mechanisms?${qs}`),
        request<SpinoutCandidate[]>(`/research/spinouts?${qs}`),
        request<AssumptionRegime[]>(`/research/assumptions?${qs}`),
        request<ResearchDelta[]>(`/research/deltas?${qs}&limit=25`),
        request<ResearchArtifact[]>(`/research/artifacts?${qs}`)
      ])
      setSnapshot(latest)
      setContracts(nextContracts)
      setMechanisms(nextMechanisms)
      setSpinouts(nextSpinouts)
      setRegimes(nextRegimes)
      setDeltas(nextDeltas)
      setArtifacts(nextArtifacts)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  useEffect(() => { void refresh() }, [workspaceId, projectId])

  async function createDelta() {
    await request("/research/deltas", { method: "POST", body: JSON.stringify({ workspaceId, projectId: projectId || undefined, title: quickTitle, summaryMarkdown: quickText, whatChangedMarkdown: quickText, sourceType: "manual" }) })
    setQuickTitle("")
    setQuickText("")
    await refresh()
  }

  async function promote(id: string) {
    const spinout = await request<SpinoutCandidate>(`/research/spinouts/${id}/promote`, { method: "POST", body: JSON.stringify({ workspaceId }) })
    if (spinout.promotedProjectId) onOpenProject(spinout.promotedProjectId)
    await refresh()
  }

  const tabs: Array<[Tab, string]> = [["map", "Map"], ["mechanisms", "Mechanisms"], ["spinouts", "Spinouts"], ["deltas", "Deltas"], ["artifacts", "Artifacts"]]

  return (
    <section className="page">
      <header>
        <h1>Research Frontier</h1>
        <WorkspacePicker value={workspaceId} onChange={setWorkspaceId} />
      </header>
      {error && <p className="notice error">{error}</p>}
      <nav className="tabs">{tabs.map(([id, label]) => <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{label}</button>)}</nav>

      {tab === "map" && (
        <>
          <section className="panel frontier-hero">
            <div>
              <h2>{snapshot?.title ?? "No frontier snapshot yet"}</h2>
              <MiniMarkdown value={snapshot?.snapshotMarkdown ?? "Create a snapshot or run legacy distillation to compress the current research state."} />
            </div>
            <div className="frontier-metrics">
              <span>{contracts.length}<small>contracts</small></span>
              <span>{mechanisms.length}<small>mechanisms</small></span>
              <span>{spinouts.length}<small>spinouts</small></span>
            </div>
          </section>
          <div className="grid two">
            <section><h2>Best theorem currently visible</h2><MiniMarkdown value={firstText(snapshot?.strongestCurrentTheoremMarkdown, snapshot?.strongestConditionalTheoremMarkdown, contracts[0]?.currentBestVersionMarkdown, contracts[0]?.theoremStatementMarkdown)} /></section>
            <section><h2>Current blockers</h2><MiniMarkdown value={firstText(snapshot?.activeBlockersMarkdown, contracts[0]?.knownBlockersMarkdown)} /></section>
            <section><h2>Reusable mechanisms</h2><div className="stack">{mechanisms.slice(0, 6).map((m) => <div className="task-card" key={m.id}><div><strong>{m.title}</strong><span>{m.descriptionMarkdown}</span></div><StatusBadge status={m.status} /></div>)}</div></section>
            <section><h2>Next promising moves</h2><MiniMarkdown value={snapshot?.recommendedNextMovesMarkdown} /></section>
          </div>
          <section className="panel form-grid compact-form">
            <input value={quickTitle} onChange={(e) => setQuickTitle(e.target.value)} placeholder="What changed" />
            <textarea value={quickText} onChange={(e) => setQuickText(e.target.value)} placeholder="Research delta" rows={3} />
            <button onClick={createDelta} disabled={!workspaceId || !quickTitle.trim()}><Plus size={16} /> Add Delta</button>
          </section>
        </>
      )}

      {tab === "mechanisms" && <section><h2>Mechanisms</h2><div className="cards">{mechanisms.map((m) => <article className="node-card" key={m.id}><strong>{m.title}</strong><StatusBadge status={m.status} /><span>{m.maturity}{m.portabilityScore !== undefined ? ` · portability ${m.portabilityScore}` : ""}</span><MiniMarkdown value={firstText(m.coreIdeaMarkdown, m.descriptionMarkdown)} /></article>)}</div></section>}
      {tab === "spinouts" && <section><h2>Possible spinouts</h2><div className="cards">{spinouts.map((s) => <article className="node-card" key={s.id}><strong>{s.title}</strong><StatusBadge status={s.status} /><MiniMarkdown value={firstText(s.statementSketchMarkdown, s.whyInterestingMarkdown, s.cheapestNextTestMarkdown)} />{s.status !== "promoted" && <button onClick={() => promote(s.id)}><Rocket size={16} /> Promote</button>}</article>)}</div></section>}
      {tab === "deltas" && <section><h2>Recent research deltas</h2><div className="stack">{deltas.map((d) => <article className="task-card" key={d.id}><div><strong>{d.title}</strong><span>{new Date(d.createdAt).toLocaleString()}</span><MiniMarkdown value={firstText(d.whatChangedMarkdown, d.summaryMarkdown)} /></div>{d.confidence && <StatusBadge status={d.confidence} />}</article>)}</div></section>}
      {tab === "artifacts" && <section><h2>Artifacts</h2><div className="cards">{artifacts.map((a) => <article className="node-card" key={a.id}><strong>{a.title}</strong><StatusBadge status={a.status} /><span>{a.kind}</span><MiniMarkdown value={firstText(a.descriptionMarkdown, a.contentMarkdown)} />{a.url && <a href={a.url}>Open URL</a>}{a.filePath && <span>{a.filePath}</span>}</article>)}</div></section>}
      {tab === "map" && regimes.length > 0 && <section><h2>Assumption regimes</h2><div className="cards">{regimes.map((r) => <article className="node-card" key={r.id}><strong>{r.title}</strong><StatusBadge status={r.status} /><MiniMarkdown value={firstText(r.formalStatementMarkdown, r.descriptionMarkdown)} /></article>)}</div></section>}
      {tab === "map" && <section><h2>Active theorem contracts</h2><div className="cards">{contracts.map((c) => <article className="node-card" key={c.id}><strong>{c.title}</strong><StatusBadge status={c.status} /><MiniMarkdown value={firstText(c.currentBestVersionMarkdown, c.theoremStatementMarkdown)} /></article>)}</div></section>}
      <p className="notice subtle"><GitBranch size={14} /> Frontier records are additive; old workstreams and reports remain intact.</p>
    </section>
  )
}
