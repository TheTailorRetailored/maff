export const scopes = {
  maffAccess: "maff:access",
  maffAdmin: "maff:admin"
} as const

export function hasScope(scopeText: string | undefined, required: string) {
  return (scopeText ?? "").split(/\s+/).includes(required)
}

export function hasPermission(input: { scopeText?: string; permissions?: string[]; required: string }) {
  return hasScope(input.scopeText, input.required) || (input.permissions ?? []).includes(input.required)
}
