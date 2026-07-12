export const scopes = {
  maffRead: "maff:read",
  maffWrite: "maff:write",
  maffReview: "maff:review",
  maffAdmin: "maff:admin"
} as const

export const clientRoles = {
  reader: "reader",
  contributor: "contributor",
  reviewer: "reviewer",
  serviceAdmin: "service-admin"
} as const

export const advertisedScopes = [scopes.maffRead, scopes.maffWrite, scopes.maffReview, scopes.maffAdmin] as const

export function hasScope(scopeText: string | undefined, required: string) {
  return (scopeText ?? "").split(/\s+/).includes(required)
}

export function hasPermission(input: { scopeText?: string; required: string }) {
  return hasScope(input.scopeText, input.required)
}

export function rolesForClient(resourceAccess: unknown, roleClientId: string) {
  if (!roleClientId || !resourceAccess || typeof resourceAccess !== "object") return []
  const entry = (resourceAccess as Record<string, unknown>)[roleClientId]
  if (!entry || typeof entry !== "object") return []
  const roles = (entry as { roles?: unknown }).roles
  return Array.isArray(roles) ? roles.filter((role): role is string => typeof role === "string") : []
}

export function hasClientRole(input: { resourceAccess?: unknown; roleClientId: string; requiredScope: string }) {
  const granted = new Set(rolesForClient(input.resourceAccess, input.roleClientId))
  return acceptedClientRolesForScope(input.requiredScope).some((role) => granted.has(role))
}

export function acceptedClientRolesForScope(requiredScope: string) {
  const allowedByScope: Record<string, string[]> = {
    [scopes.maffRead]: [clientRoles.reader, clientRoles.contributor, clientRoles.reviewer, clientRoles.serviceAdmin],
    [scopes.maffWrite]: [clientRoles.contributor, clientRoles.serviceAdmin],
    [scopes.maffReview]: [clientRoles.reviewer, clientRoles.serviceAdmin],
    [scopes.maffAdmin]: [clientRoles.serviceAdmin]
  }
  return allowedByScope[requiredScope] ?? []
}

export function hasBearerAuthorization(input: { scopeText?: string; resourceAccess?: unknown; roleClientId: string; required: string }) {
  return hasPermission(input) && hasClientRole({ resourceAccess: input.resourceAccess, roleClientId: input.roleClientId, requiredScope: input.required })
}
