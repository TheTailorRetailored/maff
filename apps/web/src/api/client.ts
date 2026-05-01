import { useAuth0 } from "@auth0/auth0-react"

const baseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001/api"

export type Workspace = { id: string; slug: string; name: string; type: string }
export type NodeIndex = { nodeId: string; title: string; type: string; status: string; area?: string; bodyPreview: string; metadata: Record<string, unknown> }
export type TaskIndex = { id: string; nodeId: string; targetNodeId?: string; workflow: string; priority: number; status: string }

export function useApi() {
  const { getAccessTokenSilently } = useAuth0()
  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await getAccessTokenSilently({
      authorizationParams: {
        audience: import.meta.env.VITE_AUTH0_AUDIENCE,
        scope: "openid profile email offline_access maff:access"
      }
    })
    const res = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...(init.headers ?? {}) }
    })
    if (!res.ok) throw new Error(await res.text())
    return res.json()
  }
  return { request }
}
