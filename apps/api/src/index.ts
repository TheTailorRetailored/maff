import cors from "cors"
import express from "express"
import { apiRouter, oauthProtectedResource, serveQuartzSite } from "./rest/routes.js"
import { requireAuth } from "./auth/auth0.js"
import { config } from "./config.js"
import { mcpHandler } from "./mcp/server.js"
import { startJobRunner } from "./jobs/jobRunner.js"
import { asyncHandler } from "./rest/asyncHandler.js"

const app = express()
app.use(cors({
  origin(origin, callback) {
    if (!origin || config.corsOrigins.includes(origin)) return callback(null, true)
    return callback(new Error("CORS origin not allowed"))
  },
  credentials: true
}))
app.use(express.json({ limit: "5mb" }))

app.get("/healthz", (_req, res) => res.json({ ok: true, name: "Maff" }))
app.get("/.well-known/oauth-protected-resource", (_req, res) => res.json(oauthProtectedResource()))
app.get("/.well-known/oauth-protected-resource/mcp", (_req, res) => res.json(oauthProtectedResource()))
app.use("/api", apiRouter())
app.post("/mcp", requireAuth(), mcpHandler)
app.get("/sites/:workspaceSlug/*", requireAuth(), asyncHandler(serveQuartzSite))

app.use((err: Error & { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(err.status ?? 500).json({ error: err.message })
})

startJobRunner()
app.listen(config.port, () => {
  console.log(`Maff API listening on ${config.port}`)
})
