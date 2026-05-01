export const scopes = {
  graphRead: "graph:read",
  graphWrite: "graph:write",
  nodeCreate: "node:create",
  nodeUpdate: "node:update",
  attemptWrite: "attempt:write",
  experimentWrite: "experiment:write",
  formalizationRun: "formalization:run",
  publishRun: "publish:run",
  workspaceAdmin: "workspace:admin"
} as const

export function hasScope(scopeText: string | undefined, required: string) {
  return (scopeText ?? "").split(/\s+/).includes(required)
}

