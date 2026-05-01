import { config } from "../config.js"

async function post(path: string, body: unknown) {
  const res = await fetch(`${config.leanWorkerUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  })
  if (!res.ok) throw new Error(`Lean worker failed: ${res.status} ${await res.text()}`)
  return res.json()
}

export const leanClient = {
  createProject: (input: { workspaceSlug: string; projectName: string }) => post("/lean/project/create", input),
  createStub: (input: { workspaceSlug: string; filePath: string; imports?: string[]; theoremStatement: string }) => post("/lean/stub/create", input),
  check: (input: { workspaceSlug: string; filePath: string }) => post("/lean/check", input),
  goal: (input: { workspaceSlug: string; filePath: string; line: number; column: number }) => post("/lean/goal", input)
}

