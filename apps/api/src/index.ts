import cors from "cors"
import express from "express"
import { apiRouter, oauthProtectedResource, serveQuartzSite } from "./rest/routes.js"
import { requireAuth } from "./auth/oidc.js"
import { config, productionOidc } from "./config.js"
import { mcpHandler, mcpServerVersion } from "./mcp/server.js"
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
  if (!config.oidc.audience) problems.push("OIDC_AUDIENCE is empty")
  if (!config.oidc.roleClientId) problems.push("OIDC_ROLE_CLIENT_ID is empty")
  if (!config.oidc.issuer.startsWith("https://")) problems.push("OIDC_ISSUER must start with https://")
  if (config.oidc.issuer.endsWith("/")) problems.push("OIDC_ISSUER must not have a trailing slash")
  if (process.env.NODE_ENV === "production" && config.oidc.issuer !== productionOidc.issuer) problems.push(`OIDC_ISSUER must equal ${productionOidc.issuer} in production`)
  if (process.env.NODE_ENV === "production" && config.oidc.audience !== productionOidc.audience) problems.push(`OIDC_AUDIENCE must equal ${productionOidc.audience} in production`)
  if (process.env.NODE_ENV === "production" && !config.publicBaseUrl.startsWith("https://")) problems.push("PUBLIC_BASE_URL must start with https:// in production")
  if (problems.length) {
    const message = `Maff OIDC configuration problem(s): ${problems.join("; ")}`
    if (process.env.NODE_ENV === "production") throw new Error(message)
    console.warn(message)
  }
}

app.get("/healthz", (_req, res) => res.json({ ok: true, name: "Maff", mcpServerVersion }))
app.get("/.well-known/oauth-protected-resource", (_req, res) => res.json(oauthProtectedResource()))
app.get("/.well-known/oauth-protected-resource/mcp", (_req, res) => res.json(oauthProtectedResource()))
app.get("/.well-known/oauth-protected-resource/mcp-0-6-3", (_req, res) => res.json(oauthProtectedResource()))
app.use("/api", apiRouter())
app.post("/mcp", requireAuth(), mcpHandler)
app.post("/mcp-0-6-3", requireAuth(), mcpHandler)
app.get("/sites/:workspaceSlug/*", requireAuth(), asyncHandler(serveQuartzSite))

app.use((err: Error & { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(err.status ?? 500).json({ error: err.message })
})

checkStartupConfig()
startJobRunner()
app.listen(config.port, () => {
  console.log(`Maff API listening on ${config.port}`)
})
