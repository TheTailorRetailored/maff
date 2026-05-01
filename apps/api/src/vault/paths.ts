import path from "node:path"
import { config } from "../config.js"

export function slugify(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100) || "node"
}

export function typeFolder(type: string) {
  const map: Record<string, string> = {
    TheoremCandidate: "TheoremCandidates",
    ProofRoute: "ProofRoutes",
    ProofAttempt: "ProofAttempts",
    KnownResult: "KnownResults",
    InformalProof: "InformalProofs",
    FormalizationTarget: "FormalizationTargets",
    LeanTheorem: "LeanTheorems",
    FormalizationGap: "FormalizationGaps",
    PausedProject: "PausedProjects",
    KilledProject: "KilledProjects"
  }
  return map[type] ?? `${type}s`
}

export function workspaceRoot(workspaceSlug: string) {
  return path.resolve(config.dataDir, "workspaces", workspaceSlug)
}

export function vaultRoot(workspaceSlug: string) {
  return path.join(workspaceRoot(workspaceSlug), "vault")
}

export function assertInsideRoot(root: string, candidate: string) {
  const resolvedRoot = path.resolve(root)
  const resolvedCandidate = path.resolve(candidate)
  if (resolvedCandidate !== resolvedRoot && !resolvedCandidate.startsWith(resolvedRoot + path.sep)) {
    throw new Error("Path escapes workspace root")
  }
  return resolvedCandidate
}

export const assertInside = assertInsideRoot

export function nodePath(workspaceSlug: string, type: string, title: string) {
  const root = vaultRoot(workspaceSlug)
  const file = path.join(root, typeFolder(type), `${title.replace(/[<>:"/\\|?*]/g, "-")}.md`)
  return assertInsideRoot(root, file)
}

export function backupPath(workspaceSlug: string, relativePath: string) {
  const root = workspaceRoot(workspaceSlug)
  return assertInsideRoot(root, path.join(root, ".backups", `${Date.now()}-${relativePath.replace(/[\\/]/g, "__")}`))
}
