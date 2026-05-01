import fs from "node:fs/promises"
import path from "node:path"
import { config } from "../config.js"

export async function readTextIfExists(filePath: string) {
  try {
    return await fs.readFile(filePath, "utf8")
  } catch {
    return null
  }
}

export async function listMarkdownFiles(root = config.skillsDir) {
  async function walk(dir: string): Promise<string[]> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      const nested = await Promise.all(entries.map((entry) => {
        const p = path.join(dir, entry.name)
        if (entry.isDirectory()) return walk(p)
        return Promise.resolve(entry.name.endsWith(".md") ? [p] : [])
      }))
      return nested.flat()
    } catch {
      return []
    }
  }
  return walk(root)
}

export async function loadSkill(pathParts: string[]) {
  const file = path.resolve(config.skillsDir, ...pathParts)
  const root = path.resolve(config.skillsDir)
  if (!file.startsWith(root)) throw new Error("Skill path escapes skills root")
  return readTextIfExists(file.endsWith(".md") ? file : `${file}.md`)
}

