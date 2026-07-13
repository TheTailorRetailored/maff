import { useAuth } from "react-oidc-context"
import { BookOpen, CheckSquare, ClipboardList, GitBranch, Home, LogOut, Network, Settings, Sigma, TerminalSquare } from "lucide-react"
import { useEffect, useState } from "react"
import { Dashboard } from "./pages/Dashboard"
import { Skills } from "./pages/Skills"
import { LeanJobs } from "./pages/LeanJobs"
import { SettingsPage } from "./pages/Settings"
import { Projects } from "./pages/Projects"
import { ProjectControlRoom } from "./pages/ProjectControlRoom"
import { WorkstreamView } from "./pages/WorkstreamView"
import { ReportView } from "./pages/ReportView"
import { ReviewQueue } from "./pages/ReviewQueue"
import { ObjectGraph } from "./pages/ObjectGraph"
import { AgentRunView } from "./pages/AgentRunView"
import { ResearchFrontier } from "./pages/ResearchFrontier"

type Page = "dashboard" | "projects" | "control" | "frontier" | "workstream" | "report" | "agentRun" | "reviews" | "objectGraph" | "skills" | "lean" | "settings"

export function App() {
  const auth = useAuth()
  const { isAuthenticated, isLoading, user } = auth
  const [page, setPage] = useState<Page>("dashboard")
  const [workspaceId, setWorkspaceId] = useState<string>("")
  const [projectId, setProjectId] = useState<string>("")
  const [workstreamId, setWorkstreamId] = useState<string>("")
  const [reportId, setReportId] = useState<string>("")

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    if (params.get("workspace")) setWorkspaceId(params.get("workspace")!)
    if (params.get("project")) {
      setProjectId(params.get("project")!)
      setPage("control")
    }
    if (params.get("workstream")) {
      setWorkstreamId(params.get("workstream")!)
      setPage("workstream")
    }
  }, [])

  if (isLoading) return <main className="center">Loading Maff...</main>
  if (!isAuthenticated) {
    return (
      <main className="login">
        <section>
          <h1>Maff</h1>
          <p>Private mathematical research graph, vault, MCP, Quartz, and Lean workbench.</p>
          <button onClick={() => auth.signinRedirect()}>Log in</button>
        </section>
      </main>
    )
  }

  const nav = [
    ["dashboard", Home, "Dashboard"],
    ["projects", BookOpen, "Projects"],
    ["control", ClipboardList, "Control"],
    ["frontier", GitBranch, "Frontier"],
    ["reviews", CheckSquare, "Reviews"],
    ["objectGraph", Network, "Objects"],
    ["skills", Sigma, "Skills"],
    ["lean", TerminalSquare, "Lean"],
    ["settings", Settings, "Settings"]
  ] as const

  return (
    <div className="shell">
      <aside>
        <div className="brand">Maff</div>
        {nav.map(([id, Icon, label]) => (
          <button key={id} className={page === id ? "active" : ""} onClick={() => setPage(id)} title={label}>
            <Icon size={18} />
            <span>{label}</span>
          </button>
        ))}
        <button className="logout" onClick={() => auth.signoutRedirect()} title="Log out">
          <LogOut size={18} />
          <span>{String(user?.profile.email ?? "Log out")}</span>
        </button>
      </aside>
      <main>
        {page === "dashboard" && <Dashboard onOpenWorkspace={(id) => { setWorkspaceId(id); setPage("projects") }} onOpenProject={(id, wid) => { setWorkspaceId(wid); setProjectId(id); setPage("control") }} onOpenWorkstream={(id, wid) => { setWorkspaceId(wid); setWorkstreamId(id); setPage("workstream") }} />}
        {page === "projects" && <Projects workspaceId={workspaceId} setWorkspaceId={setWorkspaceId} onOpenProject={(id) => { setProjectId(id); setPage("control") }} />}
        {page === "control" && <ProjectControlRoom workspaceId={workspaceId} setWorkspaceId={setWorkspaceId} projectId={projectId} onOpenWorkstream={(id) => { setWorkstreamId(id); setPage("workstream") }} />}
        {page === "frontier" && <ResearchFrontier workspaceId={workspaceId} setWorkspaceId={setWorkspaceId} projectId={projectId} onOpenProject={(id) => { setProjectId(id); setPage("control") }} />}
        {page === "workstream" && <WorkstreamView workspaceId={workspaceId} workstreamId={workstreamId} onOpenReport={(id) => { setReportId(id); setPage("report") }} />}
        {page === "report" && <ReportView workspaceId={workspaceId} reportId={reportId} />}
        {page === "agentRun" && <AgentRunView />}
        {page === "reviews" && <ReviewQueue workspaceId={workspaceId} setWorkspaceId={setWorkspaceId} onOpenWorkstream={(id) => { setWorkstreamId(id); setPage("workstream") }} />}
        {page === "objectGraph" && <ObjectGraph workspaceId={workspaceId} setWorkspaceId={setWorkspaceId} />}
        {page === "skills" && <Skills />}
        {page === "lean" && <LeanJobs workspaceId={workspaceId} setWorkspaceId={setWorkspaceId} />}
        {page === "settings" && <SettingsPage />}
      </main>
    </div>
  )
}
