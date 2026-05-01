import { spawn } from "node:child_process"
import { assertInside, workspaceRoot } from "./leanProject.js"

function run(command: string, args: string[], cwd: string, timeoutMs = 120000) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: process.platform === "win32" })
    let stdout = ""
    let stderr = ""
    const timer = setTimeout(() => {
      child.kill("SIGKILL")
      reject(new Error("Lean check timed out"))
    }, timeoutMs)
    child.stdout.on("data", (d) => { stdout += d })
    child.stderr.on("data", (d) => { stderr += d })
    child.on("exit", (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
  })
}

export async function checkLean(workspaceSlug: string, filePath: string) {
  const root = workspaceRoot(workspaceSlug)
  const file = assertInside(root, filePath)
  const result = await run("lake", ["env", "lean", file], root)
  const output = `${result.stdout}\n${result.stderr}`
  return {
    success: result.code === 0,
    diagnostics: output.split(/\r?\n/).filter(Boolean),
    hasSorry: /sorry/i.test(output),
    stdout: result.stdout,
    stderr: result.stderr
  }
}

