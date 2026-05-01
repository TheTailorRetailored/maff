import { useAuth0 } from "@auth0/auth0-react"

const baseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001/api"

export type Workspace = { id: string; slug: string; name: string; type: string }
export type NodeIndex = { nodeId: string; title: string; type: string; status: string; area?: string; bodyPreview: string; metadata: Record<string, unknown> }
export type TaskIndex = { id: string; nodeId: string; targetNodeId?: string; targetSection?: string; workflow: string; title?: string; instructions?: string; priority: number; status: string; claimedSessionId?: string; leaseExpiresAt?: string; completedAt?: string }

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
