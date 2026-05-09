import { Check, Plus } from "lucide-react"
import { useEffect, useState } from "react"
import { useApi, type ControlRoom, type ProjectGoal, type Workstream } from "../api/client"
import { StatusBadge } from "../components/StatusBadge"
import { WorkspacePicker } from "../components/WorkspacePicker"

function flat<T>(record: Record<string, T[]> | undefined) {
  return Object.entries(record ?? {}).flatMap(([status, items]) => items.map((item) => ({ status, item })))
}

export function ProjectControlRoom({ workspaceId, setWorkspaceId, projectId, onOpenWorkstream }: { workspaceId: string; setWorkspaceId: (id: string) => void; projectId: string; onOpenWorkstream: (id: string) => void }) {
  const { request } = useApi()
  const [room, setRoom] = useState<ControlRoom | null>(null)
  const [goalTitle, setGoalTitle] = useState("")
  const [goalStatement, setGoalStatement] = useState("")
  const [workstreamTitle, setWorkstreamTitle] = useState("")
  const [workstreamKind, setWorkstreamKind] = useState("proof_route_generation")
  const [instructions, setInstructions] = useState("")
  const [goalId, setGoalId] = useState("")
  const [error, setError] = useState("")

  async function refresh() {
    if (!workspaceId || !projectId) return
    setError("")
    try {
      const next = await request<ControlRoom>(`/workspaces/${workspaceId}/projects/${projectId}/control-room`)
      setRoom(next)
      const approved = flat<ProjectGoal>(next.goals_by_status).find(({ item }) => ["approved", "active"].includes(item.status))?.item
      if (approved && !goalId) setGoalId(approved.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  useEffect(() => { void refresh() }, [workspaceId, projectId])

  async function proposeGoal() {
    await request(`/workspaces/${workspaceId}/projects/${projectId}/goals`, { method: "POST", body: JSON.stringify({ title: goalTitle, statement: goalStatement, successCriteria: ["Route generation report reviewed"] }) })
    setGoalTitle("")
    setGoalStatement("")
    await refresh()
  }

  async function approveGoal(id: string) {
    await request(`/workspaces/${workspaceId}/goals/${id}/approve`, { method: "POST" })
    await refresh()
  }

  function defaultInstructions(kind: string) {
    if (kind === "literature_review") return "Translate the goal/claim into alternate terminology, create Paper and KnownResult objects, distinguish direct collisions from adjacent inspiration, and submit novelty evidence without marking novelty settled."
    if (kind === "gap_analysis") return "Convert vague blockers into explicit Gap objects, rank severity, propose the smallest next step for each gap, and submit a report for hostile review."
    if (kind === "lean_check") return "Run Lean checks on the target LeanTheorem, update check state, record diagnostics, and enforce no sorry/no axiom/no temporary assumptions before verification."
    return "Create at least one Claim and at least two ProofRoute objects, including a disproof/counterexample route. Submit a report for hostile review."
  }

  async function createSpecialistWorkstream() {
    await request(`/workspaces/${workspaceId}/projects/${projectId}/workstreams`, {
      method: "POST",
      body: JSON.stringify({
        goalId,
        title: workstreamTitle || workstreamKind.replace(/_/g, " "),
        kind: workstreamKind,
        instructions: instructions || defaultInstructions(workstreamKind)
      })
    })
    setWorkstreamTitle("")
    setInstructions("")
    await refresh()
  }

  const goals = flat<ProjectGoal>(room?.goals_by_status)
  const workstreams = flat<Workstream>(room?.workstreams_by_status)

  return (
    <section className="page">
      <header><h1>Project Control Room</h1><WorkspacePicker value={workspaceId} onChange={setWorkspaceId} /></header>
      {error && <p className="notice error">{error}</p>}
      {!room && <p className="notice">Open a project to see its control room.</p>}
      {room && (
        <>
          <section className="panel">
            <h2>{room.project.title}</h2>
            <p>{room.project.coordinatorSummary || room.project.statement}</p>
            {room.suggested_next_assignment && <button onClick={() => onOpenWorkstream(room.suggested_next_assignment!.id)}>Suggested: {room.suggested_next_assignment.title}</button>}
          </section>
          <div className="grid two">
            <section>
              <h2>Goals</h2>
              <div className="stack">
                {goals.map(({ item }) => (
                  <div className="task-card" key={item.id}>
                    <div><strong>{item.title}</strong><span>{item.statement}</span></div>
                    <span className="row-actions"><StatusBadge status={item.status} />{item.status === "proposed" && <button onClick={() => approveGoal(item.id)} title="Approve goal"><Check size={16} /></button>}</span>
                  </div>
                ))}
              </div>
              <div className="panel form-grid compact-form">
                <input value={goalTitle} onChange={(e) => setGoalTitle(e.target.value)} placeholder="Goal title" />
                <textarea value={goalStatement} onChange={(e) => setGoalStatement(e.target.value)} placeholder="Goal statement" rows={3} />
                <button onClick={proposeGoal} disabled={!goalTitle.trim() || !goalStatement.trim()}><Plus size={16} /> Propose Goal</button>
              </div>
            </section>
            <section>
              <h2>Needs Review</h2>
              <div className="stack">{room.needs_review.map((w) => <button className="link-button" key={w.id} onClick={() => onOpenWorkstream(w.id)}>{w.title}<StatusBadge status={w.status} /></button>)}</div>
              <h2>Blocked</h2>
              <div className="stack">{room.blocked_or_escalated.map((w) => <button className="link-button" key={w.id} onClick={() => onOpenWorkstream(w.id)}>{w.title}<StatusBadge status={w.status} /></button>)}</div>
            </section>
          </div>
          <section>
            <h2>Workstreams</h2>
            <div className="cards">{workstreams.map(({ item }) => <button className="node-card" key={item.id} onClick={() => onOpenWorkstream(item.id)}><strong>{item.title}</strong><StatusBadge status={item.status} /><span>{item.coordinatorRole} · {item.kind}</span><p>{item.instructions}</p></button>)}</div>
          </section>
          <section className="panel form-grid">
            <select value={goalId} onChange={(e) => setGoalId(e.target.value)}>
              <option value="">Approved goal</option>
              {goals.filter(({ item }) => ["approved", "active"].includes(item.status)).map(({ item }) => <option key={item.id} value={item.id}>{item.title}</option>)}
            </select>
            <select value={workstreamKind} onChange={(e) => setWorkstreamKind(e.target.value)}>
              <option value="proof_route_generation">Proof route generation</option>
              <option value="literature_review">Literature review</option>
              <option value="gap_analysis">Gap analysis</option>
              <option value="lean_check">Lean check</option>
            </select>
            <input value={workstreamTitle} onChange={(e) => setWorkstreamTitle(e.target.value)} placeholder="Workstream title" />
            <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Instructions" rows={3} />
            <button onClick={createSpecialistWorkstream} disabled={!goalId}><Plus size={16} /> Create Workstream</button>
          </section>
          <div className="grid two">
            <section><h2>Key Claims</h2><div className="stack">{room.key_claims.map((claim) => <div className="task-card" key={claim.id}><div><strong>{claim.title}</strong><span>{claim.statementMarkdown}</span></div><StatusBadge status={claim.status} /></div>)}</div></section>
            <section><h2>Open Gaps</h2><div className="stack">{room.open_gaps.map((gap) => <div className="task-card" key={gap.id}><div><strong>{gap.title}</strong><span>{gap.descriptionMarkdown}</span></div><StatusBadge status={gap.status} /></div>)}</div></section>
          </div>
        </>
      )}
    </section>
  )
}
