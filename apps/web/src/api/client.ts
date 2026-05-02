import { useAuth0 } from "@auth0/auth0-react"

const baseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001/api"

export type Workspace = { id: string; slug: string; name: string; type: string }
export type NodeIndex = { nodeId: string; title: string; type: string; status: string; area?: string; bodyPreview: string; metadata: Record<string, unknown> }
export type TaskIndex = { id: string; nodeId: string; targetNodeId?: string; targetSection?: string; workflow: string; title?: string; instructions?: string; priority: number; status: string; claimedSessionId?: string; leaseExpiresAt?: string; snoozedUntil?: string; completedAt?: string }
export type ProblemSummary = { id: string; title: string; short_title: string; status: string; active_claim_count: number; open_task_count: number; updated_at: string; next_recommended_workflow: string }
export type GraphNode = { id: string; nodeId?: string; title: string; short_title?: string; type: string; status: string; depth?: number; importance?: number; metadata?: Record<string, unknown> }
export type GraphEdge = { id?: string; source?: string; target?: string; sourceNodeId?: string; targetNodeId?: string; edge_type?: string; edgeType?: string; label?: string; weight?: number }
export type ProblemGraph = { problem?: { id: string; title: string; short_title?: string; status: string }; nodes: GraphNode[]; edges: GraphEdge[]; layout_hint?: { mode: string; root_node_id?: string; selected_node_id?: string | null } }

const apiAuthorizationParams = {
  audience: import.meta.env.VITE_AUTH0_AUDIENCE,
  scope: "openid profile email maff:access"
}

function isRefreshTokenError(error: unknown) {
  const text = error instanceof Error ? error.message : String(error)
  return text.toLowerCase().includes("missing refresh token")
}

export function useApi() {
  const { getAccessTokenSilently, loginWithRedirect } = useAuth0()
  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let token: string
    try {
      token = await getAccessTokenSilently({ authorizationParams: apiAuthorizationParams })
    } catch (error) {
      if (isRefreshTokenError(error)) {
        await loginWithRedirect({
          appState: { returnTo: window.location.pathname + window.location.search },
          authorizationParams: {
            ...apiAuthorizationParams,
            scope: "openid profile email offline_access maff:access",
            prompt: "login"
          }
        })
      }
      throw error
    }
    const res = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...(init.headers ?? {}) }
    })
    if (!res.ok) throw new Error(await res.text())
    return res.json()
  }
  return { request }
}
