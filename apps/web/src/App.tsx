import { useAuth0 } from "@auth0/auth0-react"
import { BookOpen, CheckSquare, GitBranch, Home, LogOut, Settings, Sigma, TerminalSquare } from "lucide-react"
import { useEffect, useState } from "react"
import { Dashboard } from "./pages/Dashboard"
import { Workspace } from "./pages/Workspace"
import { NodeView } from "./pages/NodeView"
import { GraphView } from "./pages/GraphView"
import { Tasks } from "./pages/Tasks"
import { Skills } from "./pages/Skills"
import { LeanJobs } from "./pages/LeanJobs"
import { SettingsPage } from "./pages/Settings"

type Page = "dashboard" | "workspace" | "node" | "graph" | "tasks" | "skills" | "lean" | "settings"

export function App() {
  const { isAuthenticated, isLoading, loginWithRedirect, logout, user } = useAuth0()
  const [page, setPage] = useState<Page>("dashboard")
  const [workspaceId, setWorkspaceId] = useState<string>("")
  const [nodeId, setNodeId] = useState<string>("")

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    if (params.get("workspace")) setWorkspaceId(params.get("workspace")!)
    if (params.get("node")) {
      setNodeId(params.get("node")!)
      setPage("node")
    }
  }, [])

  if (isLoading) return <main className="center">Loading Maff...</main>
  if (!isAuthenticated) {
    return (
      <main className="login">
        <section>
          <h1>Maff</h1>
          <p>Private mathematical research graph, vault, MCP, Quartz, and Lean workbench.</p>
          <button onClick={() => loginWithRedirect()}>Log in</button>
        </section>
      </main>
    )
  }

  const nav = [
    ["dashboard", Home, "Dashboard"],
    ["workspace", BookOpen, "Workspace"],
    ["graph", GitBranch, "Graph"],
    ["tasks", CheckSquare, "Tasks"],
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
        <button className="logout" onClick={() => logout({ logoutParams: { returnTo: window.location.origin } })} title="Log out">
          <LogOut size={18} />
          <span>{user?.email ?? "Log out"}</span>
        </button>
      </aside>
      <main>
        {page === "dashboard" && <Dashboard onOpenWorkspace={(id) => { setWorkspaceId(id); setPage("workspace") }} onOpenNode={(id, wid) => { setWorkspaceId(wid); setNodeId(id); setPage("node") }} />}
        {page === "workspace" && <Workspace workspaceId={workspaceId} setWorkspaceId={setWorkspaceId} onOpenNode={(id) => { setNodeId(id); setPage("node") }} />}
        {page === "node" && <NodeView workspaceId={workspaceId} nodeId={nodeId} onOpenNode={setNodeId} />}
        {page === "graph" && <GraphView workspaceId={workspaceId} setWorkspaceId={setWorkspaceId} onOpenNode={(id) => { setNodeId(id); setPage("node") }} />}
        {page === "tasks" && <Tasks workspaceId={workspaceId} setWorkspaceId={setWorkspaceId} />}
        {page === "skills" && <Skills />}
        {page === "lean" && <LeanJobs workspaceId={workspaceId} setWorkspaceId={setWorkspaceId} />}
        {page === "settings" && <SettingsPage />}
      </main>
    </div>
  )
}

