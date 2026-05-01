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

function checkStartupConfig() {
  const problems: string[] = []
  if (!config.auth0.audience) problems.push("AUTH0_AUDIENCE is empty")
  if (config.auth0.audience && !config.auth0.audience.endsWith("/mcp")) problems.push("AUTH0_AUDIENCE should end with /mcp for MCP protected-resource tokens")
  if (!config.auth0.issuer.startsWith("https://")) problems.push("AUTH0_ISSUER must start with https://")
  if (config.auth0.issuer && !config.auth0.issuer.endsWith("/")) problems.push("AUTH0_ISSUER must end with /")
  if (process.env.NODE_ENV === "production" && !config.publicBaseUrl.startsWith("https://")) problems.push("PUBLIC_BASE_URL must start with https:// in production")
  if (problems.length) {
    const message = `Maff Auth0 configuration problem(s): ${problems.join("; ")}`
    if (process.env.NODE_ENV === "production") throw new Error(message)
    console.warn(message)
  }
}

app.get("/healthz", (_req, res) => res.json({ ok: true, name: "Maff" }))
app.get("/.well-known/oauth-protected-resource", (_req, res) => res.json(oauthProtectedResource()))
app.get("/.well-known/oauth-protected-resource/mcp", (_req, res) => res.json(oauthProtectedResource()))
app.use("/api", apiRouter())
app.post("/mcp", requireAuth(), mcpHandler)
app.get("/sites/:workspaceSlug/*", requireAuth(), asyncHandler(serveQuartzSite))

app.use((err: Error & { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(err.status ?? 500).json({ error: err.message })
})

checkStartupConfig()
startJobRunner()
app.listen(config.port, () => {
  console.log(`Maff API listening on ${config.port}`)
})
