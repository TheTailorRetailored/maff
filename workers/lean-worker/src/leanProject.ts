import fs from "node:fs/promises"
import path from "node:path"

const dataDir = process.env.LEAN_DATA_DIR ?? "./lean-workspaces"
const templateDir = path.resolve("./lean-template")

export function workspaceRoot(workspaceSlug: string) {
  const safe = workspaceSlug.replace(/[^a-zA-Z0-9_-]/g, "-")
  return path.resolve(dataDir, safe)
}

export function assertInside(root: string, filePath: string) {
  const resolved = path.resolve(root, filePath)
  if (resolved !== root && !resolved.startsWith(root + path.sep)) throw new Error("Path escapes Lean workspace")
  return resolved
}

export async function createProject(workspaceSlug: string, projectName: string) {
  const root = workspaceRoot(workspaceSlug)
  await fs.mkdir(root, { recursive: true })
  await fs.cp(templateDir, root, { recursive: true, force: false, errorOnExist: false })
  return { workspaceSlug, projectName, root }
}

export async function writeLeanStub(workspaceSlug: string, filePath: string, imports: string[], theoremStatement: string) {
  const root = workspaceRoot(workspaceSlug)
  const file = assertInside(root, filePath)
  await fs.mkdir(path.dirname(file), { recursive: true })
  const importText = imports.map((i) => `import ${i}`).join("\n")
  const body = `${importText}\n\nnamespace ResearchGraph\n\n${theoremStatement.includes(":=") ? theoremStatement : `${theoremStatement} := by\n  sorry`}\n\nend ResearchGraph\n`
  await fs.writeFile(file, body)
  return { filePath, file }
}

