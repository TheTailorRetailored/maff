import fs from "node:fs/promises"
import path from "node:path"
import { config } from "../config.js"

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
  return fs.readFile(path.join(config.promptsDir, `${safe}.md`), "utf8")
}
