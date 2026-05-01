import express from "express"
import { checkLean } from "./leanCheck.js"
import { unsupportedGoal } from "./diagnostics.js"
import { createProject, writeLeanStub } from "./leanProject.js"

const app = express()
app.use(express.json({ limit: "2mb" }))

app.get("/healthz", (_req, res) => res.json({ ok: true }))

app.post("/lean/project/create", async (req, res, next) => {
  try { res.json(await createProject(req.body.workspaceSlug, req.body.projectName)) } catch (error) { next(error) }
})

app.post("/lean/stub/create", async (req, res, next) => {
  try {
    await createProject(req.body.workspaceSlug, "ResearchGraph")
    res.json(await writeLeanStub(req.body.workspaceSlug, req.body.filePath, req.body.imports ?? ["Mathlib"], req.body.theoremStatement))
  } catch (error) { next(error) }
})

app.post("/lean/check", async (req, res, next) => {
  try { res.json(await checkLean(req.body.workspaceSlug, req.body.filePath)) } catch (error) { next(error) }
})

app.post("/lean/goal", (_req, res) => res.json(unsupportedGoal()))

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(400).json({ error: err.message })
})

app.listen(8765, () => console.log("Maff Lean worker listening on 8765"))

