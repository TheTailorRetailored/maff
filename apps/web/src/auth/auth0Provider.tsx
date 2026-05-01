import { Auth0Provider } from "@auth0/auth0-react"
import type { ReactNode } from "react"

export function MaffAuthProvider({ children }: { children: ReactNode }) {
  return (
    <Auth0Provider
      domain={import.meta.env.VITE_AUTH0_DOMAIN}
      clientId={import.meta.env.VITE_AUTH0_CLIENT_ID}
      cacheLocation="localstorage"
      useRefreshTokens
      authorizationParams={{
        redirect_uri: window.location.origin,
        audience: import.meta.env.VITE_AUTH0_AUDIENCE,
        scope: "openid profile email offline_access graph:read graph:write node:create node:update attempt:write experiment:write formalization:run publish:run workspace:admin"
      }}
    >
      {children}
    </Auth0Provider>
  )
}
