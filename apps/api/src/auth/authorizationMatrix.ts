import type { WorkspaceRole } from "@prisma/client"
import { acceptedClientRolesForScope, scopes } from "./scopes.js"

export type AuthorizationRequirement = {
  scope: string
  clientRoles: string[]
  workspaceRole: WorkspaceRole | "route-specific" | "none"
}

export function restAuthorizationRequirement(method: string, path: string): AuthorizationRequirement {
  const mutation = !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase())
  const reviewMutation = mutation && /(?:claim-next-review|\/reviews(?:\/|$)|\/manuscripts\/[^/]+\/(?:promote|freeze|citation-metadata-repair)$|\/external-reviews$|\/strategic-reviews$)/i.test(path)
  const scope = mutation ? (reviewMutation ? scopes.maffReview : scopes.maffWrite) : scopes.maffRead
  return { scope, clientRoles: acceptedClientRolesForScope(scope), workspaceRole: path.includes("/workspaces/") || path.startsWith("/research/") ? "route-specific" : "none" }
}
