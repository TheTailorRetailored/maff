import fs from "node:fs/promises"
import path from "node:path"
import { config } from "../config.js"
import { assertInsideRoot } from "../vault/paths.js"

export async function listPrompts() {
  try {
    const files = await fs.readdir(config.promptsDir)
    return files.filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, ""))
  } catch {
    return []
  }
}

export async function getPrompt(name: string) {
  const safe = name.replace(/[^a-zA-Z0-9_-]/g, "")
  const root = path.resolve(config.promptsDir)
  return fs.readFile(assertInsideRoot(root, path.join(root, `${safe}.md`)), "utf8")
}
