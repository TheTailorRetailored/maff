import { AuthProvider } from "react-oidc-context"
import type { ReactNode } from "react"

const scope = "openid profile email offline_access maff:read maff:write maff:review"

export function MaffAuthProvider({ children }: { children: ReactNode }) {
  const redirectUri = import.meta.env.VITE_OIDC_REDIRECT_URI
  const postLogoutRedirectUri = import.meta.env.VITE_OIDC_POST_LOGOUT_REDIRECT_URI
  if (!redirectUri || !postLogoutRedirectUri) throw new Error("Exact OIDC callback and logout URLs must be configured")
  return (
    <AuthProvider
      authority={import.meta.env.VITE_OIDC_ISSUER}
      client_id={import.meta.env.VITE_OIDC_CLIENT_ID}
      redirect_uri={redirectUri}
      post_logout_redirect_uri={postLogoutRedirectUri}
      scope={scope}
      response_type="code"
      disablePKCE={false}
      automaticSilentRenew
      onSigninCallback={() => window.history.replaceState({}, document.title, window.location.pathname)}
    >
      {children}
    </AuthProvider>
  )
}
